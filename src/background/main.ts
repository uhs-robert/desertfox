import "./command_modules.ts";
import type { ContentToBackground } from "../shared/messages.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import { bundle_loader_deps, container_names, make_router_deps, reinject_deps } from "./browser_deps.ts";
import { create_cmdline_service } from "./cmdline_service.ts";
import { list_keys } from "./list_keys.ts";
import { create_bundle_loader } from "./bundle_loader.ts";
import { repair_tabs_after_reload } from "./reload.ts";
import { create_router } from "./router.ts";
import { SLOT_TABLE_STORAGE_KEY } from "./storage_keys.ts";
import { get_config, get_search_engine_names, snippets } from "./startup.ts";
import { command_meta, registry } from "../shared/registry/index.ts";
import { forget_all_tab_modes, forget_mode_on_navigation, forget_tab_mode, recall_tab_mode, remember_reported_mode, shortcut_allowed } from "./tab_modes.ts";
import type { SlotTable } from "./slots.ts";
import type { SnippetCall } from "./snippets.ts";

// Mode reports wait for this, so the clear never removes a fresh report.
const modes_cleared = forget_all_tab_modes(browser.storage.local);

const router = create_router(make_router_deps(get_search_engine_names));
const bundle_loader = create_bundle_loader(bundle_loader_deps);
const cmdline = create_cmdline_service({
  storage: browser.storage.local,
  tickets: browser.storage.session,
  new_ticket: () => crypto.randomUUID(),
  sources: async () => ({ search_engines: await get_search_engine_names(), containers: await container_names() }),
  page_config: async () => {
    const config = await get_config();
    return { commands: registry.list().map(command_meta), command_aliases: config.command_aliases, css: config.css };
  },
});

// Listeners register in the first turn, so no event is missed while the config loads.
browser.runtime.onMessage.addListener((message: unknown, sender) => {
  const request = message as ContentToBackground;
  if (request?.type === "mode_changed" && sender.tab?.id !== undefined) {
    const tab_id = sender.tab.id;
    return modes_cleared.then(() => remember_reported_mode(browser.storage.local, tab_id, sender.frameId, request.mode));
  }
  if (request?.type === "load_bundle") return bundle_loader.answer(sender, request.name);
  if (request?.type === "issue_cmdline_ticket") return cmdline.issue_ticket(sender.tab?.id);
  if (request?.type === "open_cmdline") return get_config().then(() => cmdline.open(request.ticket, sender.tab?.id));
  if (request?.type === "record_cmdline") return cmdline.record(request.text, sender.tab?.incognito === true);
  if (request?.type === "list_keys") return get_config().then(() => list_keys(browser.storage.local, (id) => registry.get(id), request));
  if ((message as SnippetCall)?.type === "snippet_run") {
    return get_config().then(() => snippets.handle_call(message as SnippetCall, { tab_id: sender.tab?.id, frame_id: sender.frameId }));
  }
  if (request?.type !== "run") return undefined;
  return get_config().then(() =>
    router.run({
      invocations: request.invocations,
      mode: request.mode,
      may_prompt: true,
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
  if (shortcut_allowed(mode, invocations, (id) => registry.get(id))) await router.run({ invocations, mode, may_prompt: true });
});

browser.tabs.onUpdated.addListener((tab_id, change) => forget_mode_on_navigation(browser.storage.local, tab_id, change));

browser.tabs.onRemoved.addListener((tab_id) => forget_tab_mode(browser.storage.local, tab_id));

void get_config().then(() => repair_tabs_after_reload(reinject_deps));
