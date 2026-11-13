// Talks to the bridge host over one `connectNative` port. It publishes the mode so a desktop shell can draw it, answers the host's
// `run`, `list`, `theme` and tab requests, and sends the tab events (`bridge_events.ts`) while tab sharing is on. The wire format is the hand-off
// contract with the host. The in-page badge stays on whatever the port does.
// A private window sends its mode and `private: true` and nothing else, so no id of it reaches the host.

import type { CommandMeta, Mode } from "../shared/command.ts";
import type { BridgeAnswer } from "./bridge_run.ts";
import { TAB_VERBS } from "./tab_switch.ts";
import type { TabAnswer, TabInfo, TabVerb } from "./tab_switch.ts";
import { create_bridge_events, TABS_OFF_EVENT } from "./bridge_events.ts";
import type { TabChange } from "./bridge_events.ts";
import { BUILT_IN_THEME_NAMES } from "../shared/theme_names.ts";
import { mode_label } from "../content/ui/mode_label.ts";
import { refused_as } from "../shared/swallow.ts";

export const BRIDGE_HOST_NAME = "desertfox_bridge";

export type BridgePort = {
  postMessage: (message: object) => void;
  disconnect: () => void;
  onMessage: { addListener: (listener: (message: unknown) => void) => void };
  onDisconnect: { addListener: (listener: () => void) => void };
};

export type BridgeWindow = { id: number; focused: boolean; private: boolean };

export type BridgeDeps = {
  connect: () => BridgePort;
  read_settings: () => Promise<{ bridge: boolean; share_tabs: boolean }>;
  // The optional `nativeMessaging` permission, which Firefox grants only from a click.
  permission_granted: () => Promise<boolean>;
  window_of: (window_id: number) => Promise<BridgeWindow | undefined>;
  last_focused_window: () => Promise<BridgeWindow | undefined>;
  active_tab_of: (window_id: number) => Promise<number | undefined>;
  recall_mode: (tab_id: number) => Promise<Mode>;
  // Runs `run` once after `delay_ms` and returns a cancel function.
  after: (run: () => void, delay_ms: number) => () => void;
  now_ms: () => number;
  // What the host may ask for. Each checks its own rules and answers with a refusal text, so a throw here is a bug.
  run_command: (command_text: string, tab_id?: number) => Promise<BridgeAnswer>;
  list_commands: () => CommandMeta[];
  tab_verb: (verb: TabVerb, request: Record<string, unknown>) => Promise<TabAnswer>;
  // Stores the palette the desktop pushed. Called only with a built-in theme name.
  set_desktop_palette: (name: string) => Promise<void>;
  warn: (text: string) => void;
  // Gets the `release_version` of the host in its ready frame (undefined for a host from before the updater), so an older host can be updated.
  host_ready: (release_version: unknown) => void;
  // The tab while it is in a normal window, else undefined: the privacy gate of every tab event.
  normal_tab: (tab_id: number) => Promise<TabInfo | undefined>;
};

// A request over this is refused before it is parsed.
export const MAX_COMMAND_CHARS = 4096;
export const MAX_PALETTE_CHARS = 64;

export const FIRST_RETRY_MS = 1000;
export const MAX_RETRY_MS = 60_000;
// A port that stayed up this long was healthy, so its drop starts the backoff over.
export const STABLE_MS = 10_000;

// The answer to a tab verb or a `--tab` run while `bridge_share_tabs` is off. It names the setting, which is no secret.
// `sharing: "off"` tells the host to delete its thumbnails. The host drops the field before the reply reaches a client.
const TABS_OFF = { ok: false, message: "tab sharing is off, set bridge_share_tabs to true", sharing: "off" } as const;

type Snapshot = { mode: Mode; tab_id: number; window: BridgeWindow };

export function create_bridge(deps: BridgeDeps) {
  let bridge_on = false;
  let share_tabs = false;
  let port: BridgePort | undefined;
  // The host sends one message when it has the lock, and only then is the port trusted: a second host waits for the lock and a missing host drops the port at once.
  let ready = false;
  // Goes up each time sharing goes off. A tab reply whose request started under an older count goes out as the refusal,
  // so tab data asked for before the switch never leaves after it.
  let sharing_turns_off = 0;
  let up_since_ms = 0;
  let failures = 0;
  let cancel_retry: (() => void) | undefined;
  // Publishes run one after another, so a slow lookup cannot let an older state land after a newer one.
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch((error: unknown) => console.warn("desertfox: a bridge update failed", error));
    return queue;
  };

  const events = create_bridge_events({ sharing: () => share_tabs && ready, send: (event) => send(event), normal_tab: deps.normal_tab, after: deps.after });

  function send(message: object): void {
    if (port) send_on(port, message);
  }

  // A reply goes back on the port that asked. After a reconnect the new host numbers requests from 1 again, so an old answer must not reach it.
  function send_on(which: BridgePort, message: object): void {
    if (which !== port || !ready) return;
    try {
      which.postMessage(message);
    } catch {
      dropped(which);
    }
  }

  type Asked = { verb: "run"; command: string; tab_id?: number } | { verb: "list" } | { verb: "theme"; palette: string } | { verb: TabVerb; fields: Record<string, unknown> };

  // The one check of a pushed palette: only a built-in theme name, so a socket client changes nothing else. Any other name is ignored and logged, and the current theme stays.
  async function set_palette(name: string): Promise<object> {
    if (!BUILT_IN_THEME_NAMES.includes(name)) {
      deps.warn(`desertfox: the desktop pushed the palette "${name}", which is not a built-in theme, so it was ignored`);
      return { ok: false, message: "no built-in theme has that name" };
    }
    await deps.set_desktop_palette(name);
    return { ok: true };
  }

  async function answer_of(request: Asked): Promise<object> {
    try {
      if (request.verb === "list") return { ok: true, commands: deps.list_commands() };
      if (request.verb === "theme") return await set_palette(request.palette);
      if (request.verb !== "run") return share_tabs ? await deps.tab_verb(request.verb, request.fields) : TABS_OFF;
      if (request.command.length > MAX_COMMAND_CHARS) return { ok: false, message: "the command text is too long" };
      if (request.tab_id !== undefined && !share_tabs) return TABS_OFF;
      return await deps.run_command(request.command, request.tab_id);
    } catch {
      // Fixed text: an unexpected throw can carry a tab title from a browser call.
      return { ok: false, message: "the command failed" };
    }
  }

  function asked_by(request: { verb?: unknown; command?: unknown; tab_id?: unknown; palette?: unknown }): Asked | undefined {
    if (request.verb === "list") return { verb: "list" };
    if (request.verb === "theme") return typeof request.palette === "string" && request.palette.length <= MAX_PALETTE_CHARS ? { verb: "theme", palette: request.palette } : undefined;
    if (request.verb === "run" && typeof request.command === "string") {
      if (request.tab_id === undefined) return { verb: "run", command: request.command };
      return Number.isInteger(request.tab_id) ? { verb: "run", command: request.command, tab_id: request.tab_id as number } : undefined;
    }
    const tab_verb = TAB_VERBS.find((verb) => verb === request.verb);
    return tab_verb && { verb: tab_verb, fields: request as Record<string, unknown> };
  }

  // The host sends only the fixed verbs. Anything else is dropped, and a request without an integer id has nobody to answer.
  function request_from_host(which: BridgePort, message: unknown): void {
    const request = message as { verb?: unknown; request_id?: unknown; command?: unknown; tab_id?: unknown; palette?: unknown } | null;
    if (typeof request !== "object" || request === null || !Number.isInteger(request.request_id)) return;
    const request_id = request.request_id as number;
    const asked = asked_by(request);
    if (!asked) return;
    const turns_off_at_ask = sharing_turns_off;
    void answer_of(asked).then((answer) => {
      const sharing_went_off = asked.verb !== "run" && asked.verb !== "list" && asked.verb !== "theme" && sharing_turns_off !== turns_off_at_ask;
      send_on(which, { ...(sharing_went_off ? TABS_OFF : answer), verb: "reply", request_id });
    });
  }

  async function snapshot_of(window: BridgeWindow | undefined): Promise<Snapshot | undefined> {
    if (!window) return undefined;
    const tab_id = await deps.active_tab_of(window.id);
    return tab_id === undefined ? undefined : { mode: await deps.recall_mode(tab_id), tab_id, window };
  }

  function mode_message({ mode, tab_id, window }: Snapshot): object {
    // The chip always carries the mode, whatever `mode_indicator` says about the in-page badge.
    const label = mode_label(mode, false, "always") ?? "";
    // The private filter: the ids of a private window are dropped here, before the port.
    if (window.private) return { verb: "mode", id: mode, label, private: true };
    return { verb: "mode", id: mode, label, private: false, tab_id, window_id: window.id };
  }

  async function publish_now(window: BridgeWindow | undefined): Promise<void> {
    const snapshot = await snapshot_of(window);
    if (snapshot) send(mode_message(snapshot));
  }

  // Only the focused window's active tab is shown.
  const publish_focused = (window_id: number) =>
    enqueue(async () => {
      if (!ready || window_id < 0) return;
      const window = await deps.window_of(window_id);
      if (window?.focused) await publish_now(window);
    });

  function became_ready(release_version: unknown): void {
    ready = true;
    deps.host_ready(release_version);
    // A tabs_off sent while the port was down never arrived, and a new host does not know the setting. Saying it on every ready lets the host delete its caches.
    if (!share_tabs) send(TABS_OFF_EVENT);
    up_since_ms = deps.now_ms();
    // Every message sent while the port was down is gone, so the host gets the full state now.
    void enqueue(async () => {
      const window = await deps.last_focused_window();
      if (window?.focused) await publish_now(window);
    });
  }

  function dropped(which: BridgePort): void {
    if (which !== port) return;
    const was_ready = ready;
    port = undefined;
    ready = false;
    if (deps.now_ms() - up_since_ms >= STABLE_MS && was_ready) failures = 0;
    if (bridge_on) schedule_retry();
  }

  function schedule_retry(): void {
    cancel_retry?.();
    const delay_ms = Math.min(FIRST_RETRY_MS * 2 ** failures, MAX_RETRY_MS);
    failures++;
    cancel_retry = deps.after(() => {
      cancel_retry = undefined;
      void connect();
    }, delay_ms);
  }

  async function connect(): Promise<void> {
    if (!bridge_on || port) return;
    if (!(await refused_as(deps.permission_granted(), false))) return schedule_retry();
    // Calls overlap across the await above. `connect` and the `port` assignment below run with no await between them, so the first call to get here wins and the others return on this check.
    if (!bridge_on || port) return;
    let opened: BridgePort;
    try {
      opened = deps.connect();
    } catch {
      return schedule_retry();
    }
    port = opened;
    opened.onMessage.addListener((message) => {
      if (opened !== port) return;
      if (!ready) {
        const frame = message as { ready?: unknown; release_version?: unknown } | null;
        if (frame?.ready === true) became_ready(frame.release_version);
        return;
      }
      request_from_host(opened, message);
    });
    opened.onDisconnect.addListener(() => dropped(opened));
  }

  function disconnect(): void {
    cancel_retry?.();
    cancel_retry = undefined;
    const closing = port;
    port = undefined;
    ready = false;
    closing?.disconnect();
  }

  // Reads the settings again: at start and whenever the stored keymap changes.
  async function settings_changed(): Promise<void> {
    const settings = await deps.read_settings();
    const bridge_before = bridge_on;
    const sharing_before = share_tabs;
    share_tabs = settings.share_tabs;
    bridge_on = settings.bridge;
    // Before a disconnect below, so the host still hears it and deletes its caches.
    if (sharing_before && !share_tabs) {
      sharing_turns_off++;
      events.sharing_off();
    }
    if (bridge_on === bridge_before) return;
    failures = 0;
    if (bridge_on) await connect();
    else disconnect();
  }

  return {
    start: settings_changed,
    settings_changed,
    // The user granted the permission: no need to wait out the backoff.
    permission_added: () => {
      if (!bridge_on || port) return;
      cancel_retry?.();
      failures = 0;
      void connect();
    },
    // A host update replaced the host file. The running process still runs the old code, so close its port at once: the host exits when its
    // stdin closes, and the new process waits up to 3 s for the old one to release the lock. A drop after that goes through the usual backoff.
    reconnect: () => {
      if (!bridge_on) return;
      disconnect();
      failures = 0;
      void connect();
    },
    // A tab's mode changed, or its top frame reported. Only the active tab of a focused window is shown.
    mode_changed: (tab: { id?: number | undefined; windowId?: number | undefined; active?: boolean | undefined }, mode: Mode) =>
      enqueue(async () => {
        if (!ready || tab.id === undefined || tab.windowId === undefined || tab.active !== true) return;
        const window = await deps.window_of(tab.windowId);
        if (window?.focused) send(mode_message({ mode, tab_id: tab.id, window }));
      }),
    window_focused: publish_focused,
    tab_activated: (window_id: number, tab_id: number) => {
      void events.tab_activated(tab_id);
      return publish_focused(window_id);
    },
    tab_updated: (tab_id: number, change: TabChange) => events.tab_updated(tab_id, change),
    tab_removed: (tab_id: number) => events.tab_removed(tab_id),
  };
}
