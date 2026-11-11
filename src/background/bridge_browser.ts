// Connects `create_bridge` to the browser: the native port, the window and tab queries and the events that publish.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import type { Mode } from "../shared/command.ts";
import { BRIDGE_HOST_NAME, create_bridge } from "./bridge.ts";
import type { BridgeDeps, BridgeWindow } from "./bridge.ts";
import { recall_tab_mode } from "./tab_modes.ts";
import { registry } from "../shared/registry/builtin.ts";
import { create_bridge_run } from "./bridge_run.ts";
import type { BridgeRunTarget } from "./bridge_run.ts";
import { typed_url_target } from "../commands/open_target.ts";
import { no_repeat_memory } from "./repeat_memory.ts";
import { create_router } from "./router.ts";
import type { RouterDeps } from "./router.ts";

const as_bridge_window = (window: browser.windows.Window): BridgeWindow | undefined =>
  window.id === undefined ? undefined : { id: window.id, focused: window.focused === true, private: window.incognito === true };

type TargetApi = { windows: { getLastFocused: () => Promise<{ id?: number | undefined; type?: string | undefined; incognito?: boolean | undefined }> }; tabs: { query: (query: { active: true; windowId: number }) => Promise<{ id?: number | undefined; url?: string | undefined }[]> } };

// The active tab of the last focused window, when that window is a normal one. Firefox ignores `windowTypes` here, so the type is read from the window: a popup is never a target.
export async function focused_normal_target(api: TargetApi = browser): Promise<BridgeRunTarget | undefined> {
  const window = await api.windows.getLastFocused().catch(() => undefined);
  if (window?.id === undefined || window.type !== "normal") return undefined;
  const [tab] = await api.tabs.query({ active: true, windowId: window.id });
  return tab?.id === undefined ? undefined : { tab_id: tab.id, window_id: window.id, url: tab.url, incognito: window.incognito === true };
}

// A run from outside has its own router: it targets the focused normal window instead of `currentWindow`, shows no toast (the answer carries the refusal),
// and leaves `.` and the macro recorder alone, so a script cannot rewrite what the user repeats.
export function browser_bridge_run(router_deps: RouterDeps, is_snippet: (command_id: string) => boolean) {
  const { record_step: _recorded, ...shared_deps } = router_deps;
  const router = create_router({
    ...shared_deps,
    active_tab: async () => {
      const target = await focused_normal_target();
      return target && { tab_id: target.tab_id, window_id: target.window_id, url: target.url, incognito: target.incognito };
    },
    show_refusal: async () => undefined,
    repeat_memory: no_repeat_memory,
  });
  return create_bridge_run({
    registry,
    is_snippet,
    get_enum_sources: router_deps.get_enum_sources,
    resolve_url: typed_url_target,
    target: focused_normal_target,
    run: (invocation, target) => router.run({ invocations: [invocation], mode: "normal", sender_tab_id: target.tab_id, skip_repeat: true }),
  });
}

export const browser_bridge_deps = (bridge_run: ReturnType<typeof browser_bridge_run>): BridgeDeps => ({
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
  recall_mode: (tab_id): Promise<Mode> => recall_tab_mode(browser.storage.local, tab_id),
  after: (run, delay_ms) => {
    const timer = setTimeout(run, delay_ms);
    return () => clearTimeout(timer);
  },
  now_ms: () => Date.now(),
  run_command: bridge_run.run,
  list_commands: bridge_run.list,
});

// Registers its listeners in the first turn, like the other background listeners, then connects once the settings are read.
export function start_bridge(router_deps: RouterDeps, is_snippet: (command_id: string) => boolean) {
  const bridge = create_bridge(browser_bridge_deps(browser_bridge_run(router_deps, is_snippet)));
  browser.windows.onFocusChanged.addListener((window_id) => void bridge.window_focused(window_id));
  browser.tabs.onActivated.addListener(({ windowId }) => void bridge.tab_activated(windowId));
  browser.permissions.onAdded.addListener(() => bridge.permission_added());
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && COMPILED_KEYMAP_STORAGE_KEY in changes) void bridge.settings_changed().catch(() => undefined);
  });
  void bridge.start().catch(() => undefined);
  return bridge;
}
