// Connects `create_bridge` to the browser: the native port, the window and tab queries and the events that publish.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { DEFAULT_SETTINGS } from "../shared/config.ts";
import type { Mode } from "../shared/command.ts";
import { BRIDGE_HOST_NAME, create_bridge } from "./bridge.ts";
import type { BridgeDeps, BridgeWindow } from "./bridge.ts";
import { recall_tab_mode } from "./tab_modes.ts";

const as_bridge_window = (window: browser.windows.Window): BridgeWindow | undefined =>
  window.id === undefined ? undefined : { id: window.id, focused: window.focused === true, fullscreen: window.state === "fullscreen", private: window.incognito === true };

export const browser_bridge_deps = (): BridgeDeps => ({
  connect: () => browser.runtime.connectNative(BRIDGE_HOST_NAME),
  read_settings: async () => {
    const keymap = current_keymap((await browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY))[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined);
    return { bridge: keymap?.bridge === true, mode_indicator: keymap?.mode_indicator ?? DEFAULT_SETTINGS.mode_indicator };
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
  recall_mode: (tab_id): Promise<Mode> => recall_tab_mode(browser.storage.local, tab_id),
  after: (run, delay_ms) => {
    const timer = setTimeout(run, delay_ms);
    return () => clearTimeout(timer);
  },
  now_ms: () => Date.now(),
});

// Registers its listeners in the first turn, like the other background listeners, then connects once the settings are read.
export function start_bridge() {
  const bridge = create_bridge(browser_bridge_deps());
  browser.windows.onFocusChanged.addListener((window_id) => void bridge.window_focused(window_id));
  browser.tabs.onActivated.addListener(({ windowId }) => void bridge.tab_activated(windowId));
  browser.permissions.onAdded.addListener(() => bridge.permission_added());
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && COMPILED_KEYMAP_STORAGE_KEY in changes) void bridge.settings_changed().catch(() => undefined);
  });
  void bridge.start().catch(() => undefined);
  return bridge;
}
