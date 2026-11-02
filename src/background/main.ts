import "./command_modules.ts";
import type { ContentToBackground } from "../shared/messages.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import { make_router_deps, reinject_deps } from "./browser_deps.ts";
import { repair_tabs_after_reload } from "./reload.ts";
import { create_router } from "./router.ts";
import { SLOT_TABLE_STORAGE_KEY } from "./storage_keys.ts";
import { clear_toolbar_badge, get_config, get_search_engine_names, on_color_scheme_change, refresh_all_toolbar_badges, show_toolbar_badge } from "./startup.ts";
import { registry } from "../shared/registry/index.ts";
import { forget_all_tab_modes, forget_mode_on_navigation, forget_tab_mode, recall_tab_mode, remember_reported_mode, shortcut_allowed } from "./tab_modes.ts";
import type { SlotTable } from "./slots.ts";

// Mode reports wait for this, so the clear never removes a fresh report.
const modes_cleared = forget_all_tab_modes(browser.storage.local);

const router = create_router(make_router_deps(get_search_engine_names));

// Listeners register in the first turn, so no event is missed while the config loads.
browser.runtime.onMessage.addListener((message: unknown, sender) => {
  const request = message as ContentToBackground;
  if (request?.type === "mode_changed" && sender.tab?.id !== undefined) {
    const tab_id = sender.tab.id;
    return modes_cleared.then(async () => {
      if (await remember_reported_mode(browser.storage.local, tab_id, sender.frameId, request.mode)) await show_toolbar_badge(tab_id, request.mode);
    });
  }
  if (request?.type !== "run") return undefined;
  return get_config().then(() =>
    router.run({
      invocations: request.invocations,
      mode: request.mode,
      ...(sender.tab?.id === undefined ? {} : { sender_tab_id: sender.tab.id }),
      ...(sender.frameId === undefined ? {} : { frame_id: sender.frameId }),
    }),
  );
});

browser.commands.onCommand.addListener(async (slot_name: string) => {
  await get_config();
  const stored = await browser.storage.local.get(SLOT_TABLE_STORAGE_KEY);
  const invocations: BoundInvocation[] | undefined = (stored[SLOT_TABLE_STORAGE_KEY] as SlotTable | undefined)?.[slot_name];
  if (!invocations) return;
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  const mode = active?.id === undefined ? "normal" : await recall_tab_mode(browser.storage.local, active.id);
  if (shortcut_allowed(mode, invocations, (id) => registry.get(id))) await router.run({ invocations, mode });
});

browser.tabs.onUpdated.addListener(async (tab_id, change) => {
  await forget_mode_on_navigation(browser.storage.local, tab_id, change);
  if (change.status === "loading") await clear_toolbar_badge(tab_id);
});

browser.tabs.onRemoved.addListener((tab_id) => forget_tab_mode(browser.storage.local, tab_id));

void get_config().then(() => repair_tabs_after_reload(reinject_deps));

// After the mode clear, so a stale mode from the last run never reaches a badge.
void modes_cleared.then(refresh_all_toolbar_badges);
on_color_scheme_change(() => void refresh_all_toolbar_badges());
