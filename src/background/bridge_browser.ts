// Connects `create_bridge` to the browser: the native port, the window and tab queries and the events that publish or stream.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import type { Mode } from "../shared/command.ts";
import { BRIDGE_HOST_NAME, create_bridge } from "./bridge.ts";
import type { BridgeDeps, BridgeWindow } from "./bridge.ts";
import { registry } from "../shared/registry/builtin.ts";
import { create_bridge_run } from "./bridge_run.ts";
import { NoSuchTab } from "./bridge_run.ts";
import type { BridgeRunTarget } from "./bridge_run.ts";
import { typed_url_target } from "../commands/open_target.ts";
import { no_repeat_memory } from "./repeat_memory.ts";
import { create_tab_switch } from "./tab_switch.ts";
import type { TabSwitch } from "./tab_switch.ts";
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

// The active tab a `--tab` router reads, at every step and repeat: the named tab while it is a normal-window tab, else a refusal. Never the focused window, which can be private.
export const pinned_active_tab = (tab_switch: Pick<TabSwitch, "normal_tab">, named: BridgeRunTarget) => async () => {
  const tab = await tab_switch.normal_tab(named.tab_id);
  if (!tab) throw new NoSuchTab();
  return { tab_id: named.tab_id, window_id: tab.windowId as number, url: tab.url, incognito: false };
};

// A run from outside has its own router: it targets the focused normal window instead of `currentWindow`, shows no toast (the answer carries the refusal),
// and leaves `.` and the macro recorder alone, so a script cannot rewrite what the user repeats.
export function browser_bridge_run(router_deps: RouterDeps, is_snippet: (command_id: string) => boolean, tab_switch: TabSwitch) {
  const { record_step: _recorded, ...shared_deps } = router_deps;
  // One router per request, because a named run pins its tab for the whole request.
  const router_for = (named: BridgeRunTarget | undefined) =>
    create_router({
      ...shared_deps,
      active_tab: named
        ? pinned_active_tab(tab_switch, named)
        : async () => {
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
    target: async (tab_id) => {
      if (tab_id === undefined) return focused_normal_target();
      const tab = await tab_switch.normal_tab(tab_id);
      return tab && { tab_id, window_id: tab.windowId as number, url: tab.url, incognito: false };
    },
    run: (invocation, target, named) => router_for(named ? target : undefined).run({ invocations: [invocation], mode: "normal", sender_tab_id: target.tab_id, skip_repeat: true }),
  });
}

export const browser_tab_switch = (): TabSwitch =>
  create_tab_switch({
    windows: () => browser.windows.getAll(),
    window: (window_id) => browser.windows.get(window_id),
    last_focused_window: () => browser.windows.getLastFocused(),
    tabs: () => browser.tabs.query({}),
    tab: (tab_id) => browser.tabs.get(tab_id),
    select: async (tab_id) => void (await browser.tabs.update(tab_id, { active: true })),
    focus_window: async (window_id) => void (await browser.windows.update(window_id, { focused: true })),
    set_preface: async (window_id, text) => void (await browser.windows.update(window_id, { titlePreface: text })),
    remove: (tab_id) => browser.tabs.remove(tab_id),
    capture: (tab_id, options) => browser.tabs.captureTab(tab_id, options),
    after: (run, delay_ms) => void setTimeout(run, delay_ms),
  });

export const browser_bridge_deps = (recall_mode: (tab_id: number) => Promise<Mode>, bridge_run: ReturnType<typeof browser_bridge_run>, tab_switch: TabSwitch): BridgeDeps => ({
  connect: () => browser.runtime.connectNative(BRIDGE_HOST_NAME),
  read_settings: async () => {
    const keymap = current_keymap((await browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY))[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined);
    return { bridge: keymap?.bridge === true, share_tabs: keymap?.bridge === true && keymap.bridge_share_tabs === true };
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
  run_command: bridge_run.run,
  list_commands: bridge_run.list,
  tab_verb: tab_switch.handle,
  normal_tab: tab_switch.normal_tab,
});

// Registers its listeners in the first turn, like the other background listeners, then connects once the settings are read.
// `recall_mode` answers the mode of a tab, which is the focused frame's (`tab_modes.ts`).
export function start_bridge(recall_mode: (tab_id: number) => Promise<Mode>, router_deps: RouterDeps, is_snippet: (command_id: string) => boolean) {
  const tab_switch = browser_tab_switch();
  const bridge = create_bridge(browser_bridge_deps(recall_mode, browser_bridge_run(router_deps, is_snippet, tab_switch), tab_switch));
  browser.windows.onFocusChanged.addListener((window_id) => void bridge.window_focused(window_id));
  browser.tabs.onActivated.addListener(({ tabId, windowId }) => void bridge.tab_activated(windowId, tabId));
  // Its own listener, filtered, so the other `onUpdated` work in main.ts stays apart from the stream.
  browser.tabs.onUpdated.addListener((tab_id, change) => bridge.tab_updated(tab_id, change), { properties: ["title", "url", "audible"] });
  browser.tabs.onRemoved.addListener((tab_id) => bridge.tab_removed(tab_id));
  browser.permissions.onAdded.addListener(() => bridge.permission_added());
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && COMPILED_KEYMAP_STORAGE_KEY in changes) void bridge.settings_changed().catch(() => undefined);
  });
  void bridge.start().catch(() => undefined);
  return bridge;
}
