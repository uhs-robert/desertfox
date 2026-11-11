// Connects `create_bridge` to the browser: the native port, the window and tab queries and the events that publish.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import type { Mode } from "../shared/command.ts";
import { BRIDGE_HOST_NAME, create_bridge } from "./bridge.ts";
import type { BridgeDeps, BridgeWindow } from "./bridge.ts";

const as_bridge_window = (window: browser.windows.Window): BridgeWindow | undefined =>
  window.id === undefined ? undefined : { id: window.id, focused: window.focused === true, private: window.incognito === true };

export const browser_bridge_deps = (recall_mode: (tab_id: number) => Promise<Mode>): BridgeDeps => ({
  connect: () => browser.runtime.connectNative(BRIDGE_HOST_NAME),
  read_settings: async () => {
    const keymap = current_keymap((await browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY))[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined);
    return { bridge: keymap?.bridge === true };
  },
  permission_granted: () => browser.permissions.contains({ permissions: ["nativeMessaging"] }),
  last_focused_window: async () => {
    const window = await browser.windows.getLastFocused().catch(() => undefined);
    return window && as_bridge_window(window);
  },
  window_of: async (window_id) => {
    const window = await browser.windows.get(window_id).catch(() => undefined);
    return window && as_bridge_window(window);
  },
  active_tab_of: async (window_id) => (await browser.tabs.query({ active: true, windowId: window_id }))[0]?.id,
  recall_mode,
  after: (run, delay_ms) => {
    const timer = setTimeout(run, delay_ms);
    return () => clearTimeout(timer);
  },
  now_ms: () => Date.now(),
});

// Registers its listeners in the first turn, like the other background listeners, then connects once the settings are read.
// `recall_mode` answers the mode of a tab, which is the focused frame's (`tab_modes.ts`).
export function start_bridge(recall_mode: (tab_id: number) => Promise<Mode>) {
  const bridge = create_bridge(browser_bridge_deps(recall_mode));
  browser.windows.onFocusChanged.addListener((window_id) => void bridge.window_focused(window_id));
  browser.tabs.onActivated.addListener(({ windowId }) => void bridge.tab_activated(windowId));
  browser.permissions.onAdded.addListener(() => bridge.permission_added());
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && COMPILED_KEYMAP_STORAGE_KEY in changes) void bridge.settings_changed().catch(() => undefined);
  });
  void bridge.start().catch(() => undefined);
  return bridge;
}
