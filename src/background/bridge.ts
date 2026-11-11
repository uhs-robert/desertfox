// Publishes the mode to the bridge host over one `connectNative` port, so a desktop shell can draw it.
// The wire format is the hand-off contract with the host: one verb, `mode`. The in-page badge stays on whatever the port does.
// A private window sends its mode and `private: true` and nothing else, so no id of it reaches the host.

import type { Mode } from "../shared/command.ts";
import { mode_label } from "../content/ui/mode_label.ts";

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
  read_settings: () => Promise<{ bridge: boolean }>;
  // The optional `nativeMessaging` permission, which Firefox grants only from a click.
  permission_granted: () => Promise<boolean>;
  window_of: (window_id: number) => Promise<BridgeWindow | undefined>;
  last_focused_window: () => Promise<BridgeWindow | undefined>;
  active_tab_of: (window_id: number) => Promise<number | undefined>;
  recall_mode: (tab_id: number) => Promise<Mode>;
  // Runs `run` once after `delay_ms` and returns a cancel function.
  after: (run: () => void, delay_ms: number) => () => void;
  now_ms: () => number;
};

export const FIRST_RETRY_MS = 1000;
export const MAX_RETRY_MS = 60_000;
// A port that stayed up this long was healthy, so its drop starts the backoff over.
export const STABLE_MS = 10_000;

type Snapshot = { mode: Mode; tab_id: number; window: BridgeWindow };

export function create_bridge(deps: BridgeDeps) {
  let bridge_on = false;
  let port: BridgePort | undefined;
  // The host sends one message when it has the lock, and only then is the port trusted: a second host waits for the lock and a missing host drops the port at once.
  let ready = false;
  let up_since_ms = 0;
  let failures = 0;
  let cancel_retry: (() => void) | undefined;
  // Publishes run one after another, so a slow lookup cannot let an older state land after a newer one.
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch(() => undefined);
    return queue;
  };

  function send(message: object): void {
    if (!port || !ready) return;
    try {
      port.postMessage(message);
    } catch {
      dropped(port);
    }
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

  function became_ready(): void {
    ready = true;
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
    if (!(await deps.permission_granted().catch(() => false))) return schedule_retry();
    // Calls overlap across the await above. `connect` and the `port` assignment below run with no await between them, so the first call to get here wins and the others return on this check.
    if (!bridge_on || port) return;
    let opened: BridgePort;
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
    const closing = port;
    port = undefined;
    ready = false;
    closing?.disconnect();
  }

  // Reads the settings again: at start and whenever the stored keymap changes.
  async function settings_changed(): Promise<void> {
    const settings = await deps.read_settings();
    const bridge_before = bridge_on;
    bridge_on = settings.bridge;
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
    // A tab's mode changed, or its top frame reported. Only the active tab of a focused window is shown.
    mode_changed: (tab: { id?: number | undefined; windowId?: number | undefined; active?: boolean | undefined }, mode: Mode) =>
      enqueue(async () => {
        if (!ready || tab.id === undefined || tab.windowId === undefined || tab.active !== true) return;
        const window = await deps.window_of(tab.windowId);
        if (window?.focused) send(mode_message({ mode, tab_id: tab.id, window }));
      }),
    window_focused: publish_focused,
    tab_activated: publish_focused,
  };
}
