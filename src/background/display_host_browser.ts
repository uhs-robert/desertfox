// Connects `create_display_host` to the browser: the native port, the window and tab queries and the events that publish.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { DEFAULT_SETTINGS } from "../shared/config.ts";
import type { Mode } from "../shared/command.ts";
import { create_display_host, DISPLAY_HOST_NAME } from "./display_host.ts";
import type { DisplayDeps, DisplayWindow } from "./display_host.ts";
import { recall_tab_mode } from "./tab_modes.ts";

const as_display_window = (window: browser.windows.Window): DisplayWindow | undefined =>
  window.id === undefined ? undefined : { id: window.id, focused: window.focused === true, fullscreen: window.state === "fullscreen", private: window.incognito === true };

export const browser_display_deps = (): DisplayDeps => ({
  connect: () => browser.runtime.connectNative(DISPLAY_HOST_NAME),
  read_settings: async () => {
    const keymap = current_keymap((await browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY))[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined);
    return { ui: keymap?.ui ?? DEFAULT_SETTINGS.ui, mode_indicator: keymap?.mode_indicator ?? DEFAULT_SETTINGS.mode_indicator };
  },
  last_focused_window: async () => {
    const window = await browser.windows.getLastFocused().catch(() => undefined);
    return window && as_display_window(window);
  },
  window_of: async (window_id) => {
    const window = await browser.windows.get(window_id).catch(() => undefined);
    return window && as_display_window(window);
  },
  active_tab_of: async (window_id) => (await browser.tabs.query({ active: true, windowId: window_id }))[0]?.id,
  recall_mode: (tab_id): Promise<Mode> => recall_tab_mode(browser.storage.local, tab_id),
  refresh_pages: async () => {
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map((tab) => (tab.id === undefined ? undefined : browser.tabs.sendMessage(tab.id, { type: "tree_updated" }).catch(() => undefined))));
  },
  after: (run, delay_ms) => {
    const timer = setTimeout(run, delay_ms);
    return () => clearTimeout(timer);
  },
  now_ms: () => Date.now(),
});

// Registers its listeners in the first turn, like the other background listeners, then connects once the settings are read.
export function start_display_host() {
  const display = create_display_host(browser_display_deps());
  browser.windows.onFocusChanged.addListener((window_id) => void display.window_focused(window_id));
  browser.tabs.onActivated.addListener(({ windowId }) => void display.tab_activated(windowId));
  browser.tabs.onUpdated.addListener((tab_id, change) => {
    if (change.status === "loading") display.tab_gone(tab_id);
  });
  browser.tabs.onRemoved.addListener((tab_id) => display.tab_gone(tab_id));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && COMPILED_KEYMAP_STORAGE_KEY in changes) void display.settings_changed().catch(() => undefined);
  });
  void display.start().catch(() => undefined);
  return display;
}
