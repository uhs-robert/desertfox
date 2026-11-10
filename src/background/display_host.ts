// Publishes the mode and the which-key panel to the display host over one `connectNative` port, so a desktop shell can draw them.
// The wire format is the hand-off contract with the shell reader: three verbs, `mode`, `whichkey_show` and `whichkey_hide`.
// With `ui = quickshell` and the port up, the in-page mode badge and which-key panel stay off. A missing host or a dropped port gives them back.

import type { ModeIndicator, Ui } from "../shared/config.ts";
import type { Mode } from "../shared/command.ts";
import type { WhichKeyPanel } from "../shared/messages.ts";
import { mode_label } from "../content/ui/mode_label.ts";
import { set_badge_hidden } from "./display_ui.ts";

export const DISPLAY_HOST_NAME = "desertfox_display_host";

export type DisplayPort = {
  postMessage: (message: object) => void;
  disconnect: () => void;
  onMessage: { addListener: (listener: (message: unknown) => void) => void };
  onDisconnect: { addListener: (listener: () => void) => void };
};

export type DisplayWindow = { id: number; focused: boolean; fullscreen: boolean; private: boolean };

export type DisplayDeps = {
  connect: () => DisplayPort;
  read_settings: () => Promise<{ ui: Ui; mode_indicator: ModeIndicator }>;
  // The window Firefox focused last, or undefined without one.
  last_focused_window: () => Promise<DisplayWindow | undefined>;
  window_of: (window_id: number) => Promise<DisplayWindow | undefined>;
  active_tab_of: (window_id: number) => Promise<number | undefined>;
  recall_mode: (tab_id: number) => Promise<Mode>;
  // Tells every page to read its keymap again, which is how a page learns whether its in-page UI is on.
  refresh_pages: () => Promise<void>;
  // Runs `run` once after `delay_ms` and returns a cancel function.
  after: (run: () => void, delay_ms: number) => () => void;
  now_ms: () => number;
};

export const FIRST_RETRY_MS = 1000;
export const MAX_RETRY_MS = 60_000;
// A port that stayed up this long was healthy, so its drop starts the backoff over.
export const STABLE_MS = 10_000;
// Firefox has no event for a fullscreen change, so the window state is read at this interval while the port is up.
export const FULLSCREEN_POLL_MS = 1000;

type Snapshot = { mode: Mode; tab_id: number; window: DisplayWindow };

export function create_display_host(deps: DisplayDeps) {
  let ui: Ui = "browser";
  let mode_indicator: ModeIndicator = "always";
  let port: DisplayPort | undefined;
  // The host sends one message when it starts, and only then is the port trusted: a missing host drops the port at once and must not flash the in-page UI off and on.
  let ready = false;
  let up_since_ms = 0;
  let failures = 0;
  let cancel_retry: (() => void) | undefined;
  let cancel_poll: (() => void) | undefined;
  let focused_fullscreen = false;
  let whichkey_tab: number | undefined;
  // Publishes run one after another, so a slow lookup cannot let an older state land after a newer one.
  let queue: Promise<void> = Promise.resolve();

  const wants_port = () => ui === "quickshell";
  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch(() => undefined);
    return queue;
  };
  const sync_page_state = () => set_badge_hidden(ready && wants_port() && !focused_fullscreen);

  function send(message: object): void {
    if (!port || !ready) return;
    try {
      port.postMessage(message);
    } catch {
      dropped(port);
    }
  }

  async function snapshot_of(window: DisplayWindow | undefined): Promise<Snapshot | undefined> {
    if (!window) return undefined;
    const tab_id = await deps.active_tab_of(window.id);
    return tab_id === undefined ? undefined : { mode: await deps.recall_mode(tab_id), tab_id, window };
  }

  function mode_message({ mode, tab_id, window }: Snapshot): object {
    return { verb: "mode", id: mode, label: mode_label(mode, false, mode_indicator) ?? "", tab_id, window_id: window.id, fullscreen: window.fullscreen, private: window.private };
  }

  const hide_whichkey = () => {
    if (whichkey_tab === undefined) return;
    whichkey_tab = undefined;
    send({ verb: "whichkey_hide" });
  };

  async function publish_now(window: DisplayWindow | undefined): Promise<void> {
    const snapshot = await snapshot_of(window);
    if (snapshot) send(mode_message(snapshot));
  }
  const publish_window = (window: DisplayWindow | undefined) => enqueue(() => publish_now(window));

  async function poll_fullscreen(): Promise<void> {
    const window = await deps.last_focused_window();
    if (window?.focused && window.fullscreen !== focused_fullscreen) {
      focused_fullscreen = window.fullscreen;
      sync_page_state();
      await deps.refresh_pages().catch(() => undefined);
      await publish_window(window);
    }
  }

  function schedule_poll(): void {
    cancel_poll = deps.after(() => {
      void poll_fullscreen().finally(() => port && ready && schedule_poll());
    }, FULLSCREEN_POLL_MS);
  }

  function became_ready(): void {
    ready = true;
    up_since_ms = deps.now_ms();
    // Every message sent while the port was down is gone, so the host gets the full state now.
    void deps.last_focused_window().then(async (window) => {
      focused_fullscreen = window?.focused === true && window.fullscreen;
      sync_page_state();
      await deps.refresh_pages().catch(() => undefined);
      await publish_window(window);
    });
    schedule_poll();
  }

  function dropped(which: DisplayPort): void {
    if (which !== port) return;
    const was_ready = ready;
    port = undefined;
    ready = false;
    cancel_poll?.();
    whichkey_tab = undefined;
    if (deps.now_ms() - up_since_ms >= STABLE_MS && was_ready) failures = 0;
    sync_page_state();
    if (was_ready) void deps.refresh_pages().catch(() => undefined);
    if (wants_port()) schedule_retry();
  }

  function schedule_retry(): void {
    cancel_retry?.();
    const delay_ms = Math.min(FIRST_RETRY_MS * 2 ** failures, MAX_RETRY_MS);
    failures++;
    cancel_retry = deps.after(() => {
      cancel_retry = undefined;
      connect();
    }, delay_ms);
  }

  function connect(): void {
    if (!wants_port() || port) return;
    let opened: DisplayPort;
    try {
      opened = deps.connect();
    } catch {
      return schedule_retry();
    }
    port = opened;
    opened.onMessage.addListener(() => {
      if (opened === port && !ready) became_ready();
    });
    opened.onDisconnect.addListener(() => dropped(opened));
  }

  function disconnect(): void {
    cancel_retry?.();
    cancel_retry = undefined;
    cancel_poll?.();
    const closing = port;
    const was_ready = ready;
    port = undefined;
    ready = false;
    whichkey_tab = undefined;
    closing?.disconnect();
    sync_page_state();
    if (was_ready) void deps.refresh_pages().catch(() => undefined);
  }

  // Reads the settings again: at start and whenever the stored keymap changes.
  async function settings_changed(): Promise<void> {
    const settings = await deps.read_settings();
    const ui_before = ui;
    ui = settings.ui;
    mode_indicator = settings.mode_indicator;
    if (ui === ui_before) {
      // The label text follows `mode_indicator`.
      if (ready) await publish_window(await deps.last_focused_window());
      return;
    }
    failures = 0;
    if (wants_port()) connect();
    else disconnect();
    sync_page_state();
    await deps.refresh_pages().catch(() => undefined);
  }

  return {
    start: settings_changed,
    settings_changed,
    // Whether the in-page which-key panel is off for the next answer.
    is_active: () => ready && wants_port(),
    // A page reported its top frame's mode. Only the active tab of a focused window is shown.
    mode_changed: (tab: { id?: number | undefined; windowId?: number | undefined; active?: boolean | undefined }, mode: Mode) =>
      enqueue(async () => {
        if (!ready || tab.id === undefined || tab.windowId === undefined || tab.active !== true) return;
        const window = await deps.window_of(tab.windowId);
        if (window?.focused) send(mode_message({ mode, tab_id: tab.id, window }));
      }),
    // Any focus move closes the panel, including focus leaving Firefox: the shell reopens a panel the file still holds when Firefox is focused again.
    window_focused: (window_id: number) => {
      hide_whichkey();
      return enqueue(async () => {
        if (!ready || window_id < 0) return;
        const window = await deps.window_of(window_id);
        if (!window?.focused) return;
        focused_fullscreen = window.fullscreen;
        sync_page_state();
        await publish_now(window);
      });
    },
    tab_activated: (window_id: number) => {
      hide_whichkey();
      return enqueue(async () => {
        if (!ready) return;
        const window = await deps.window_of(window_id);
        if (window?.focused) await publish_now(window);
      });
    },
    // A tab that navigates or closes takes its panel with it, and its bundle cannot say so.
    tab_gone: (tab_id: number) => {
      if (tab_id === whichkey_tab) hide_whichkey();
    },
    whichkey_hidden: () => hide_whichkey(),
    // Called with the answer to a page's `list_keys`. Returns what the page may draw: the same panel marked `external` when the host shows it.
    whichkey_panel: (panel: WhichKeyPanel, tab: { id?: number | undefined; active?: boolean | undefined } | undefined): WhichKeyPanel => {
      if (!ready || !wants_port()) return panel;
      if (panel.rows.length === 0 || tab?.active !== true) {
        hide_whichkey();
        return panel;
      }
      whichkey_tab = tab.id;
      send({ verb: "whichkey_show", title: panel.title, border: panel.border, rows: panel.rows });
      return { ...panel, external: true };
    },
  };
}
