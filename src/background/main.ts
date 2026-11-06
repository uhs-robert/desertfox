import "./command_modules.ts";
import type { ContentToBackground } from "../shared/messages.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import { DEFAULT_SETTINGS, effective_settings } from "../shared/config.ts";
import { bundle_loader_deps, container_names, image_deps, make_router_deps, page_of, reinject_deps } from "./browser_deps.ts";
import { run_image_action } from "./image_actions.ts";
import { HELP_PAGE_FILE } from "../help/route.ts";
import { open_quick_start_on_install } from "./first_install.ts";
import { create_cmdline_service } from "./cmdline_service.ts";
import { create_previous_tabs } from "./previous_tab.ts";
import { browser_discard_deps } from "./tab_discard.ts";
import { browser_complete_items_deps, create_complete_items } from "./complete_items.ts";
import type { Asker } from "./complete_items.ts";
import { create_open_help } from "./open_help.ts";
import { requirement_lookup, site_engine_for, with_site_engines } from "./availability.ts";
import { list_keys } from "./list_keys.ts";
import { create_bundle_loader } from "./bundle_loader.ts";
import { track_window_focus } from "./window_focus.ts";
import { repair_tabs_after_reload } from "./reload.ts";
import { browser_tab_model_deps, create_tab_model } from "./tab_model.ts";
import { browser_find_scan_deps, create_find_scan, is_scan_request } from "./find_scan.ts";
import { create_router } from "./router.ts";
import { create_repeat_memory, page_record } from "./repeat_memory.ts";
import { wire_repeat } from "../commands/command.ts";
import { SLOT_TABLE_STORAGE_KEY } from "./storage_keys.ts";
import { get_config, get_search_engine_names, snippets } from "./startup.ts";
import { command_meta, registry } from "../shared/registry/index.ts";
import { forget_all_tab_modes, forget_mode_on_navigation, forget_tab_mode, recall_tab_mode, remember_reported_mode, shortcut_allowed } from "./tab_modes.ts";
import type { SlotTable } from "./slots.ts";
import type { SnippetCall } from "./snippets.ts";

// Mode reports wait for this, so the clear never removes a fresh report.
const modes_cleared = forget_all_tab_modes(browser.storage.local);

// Taken before the config loads, so it holds the built-in commands only, which are the ones the help page has cards for.
const built_in_ids = new Set(registry.list().map((command) => command.id));

const repeat_memory = create_repeat_memory(browser.storage.session);
const router_deps = make_router_deps(get_config, repeat_memory);
const router = create_router(router_deps);
const is_private_tab = async (tab_id: number | undefined) => tab_id !== undefined && (await browser.tabs.get(tab_id).catch(() => undefined))?.incognito === true;
// A replay is a request like any other: it stores itself again, so `3.` keeps its count for the next `.`.
wire_repeat({
  load: async (ctx) => repeat_memory.load(await is_private_tab(ctx.tab_id)),
  run_batch: (invocations, ctx) =>
    router.run({ invocations, mode: ctx.mode, frame_id: ctx.frame_id, ...(ctx.tab_id === undefined ? {} : { sender_tab_id: ctx.tab_id }) }),
});
const bundle_loader = create_bundle_loader(bundle_loader_deps);
const cmdline = create_cmdline_service({
  storage: browser.storage.local,
  tickets: browser.storage.session,
  new_ticket: () => crypto.randomUUID(),
  sources: async () => ({ search_engines: await get_search_engine_names(), containers: await container_names() }),
  page_config: async () => {
    const config = await get_config();
    return { commands: registry.list().map(command_meta), help_ids: [...built_in_ids], command_aliases: config.command_aliases, prompt: effective_settings(config.settings).cmdline_prompt, all_windows: effective_settings(config.settings).completion_all_windows };
  },
});

const previous_tabs = create_previous_tabs(browser.storage.session);

const open_help = create_open_help({
  is_opener: cmdline.is_opener,
  is_command: (command_id) => built_in_ids.has(command_id),
  help_page_url: browser.runtime.getURL(HELP_PAGE_FILE),
  open_tab: (tab) => browser.tabs.create(tab),
});

const complete_items = create_complete_items({
  ...browser_complete_items_deps,
  previous_tab: previous_tabs.previous_of,
  is_opener: cmdline.is_opener,
  search_engines: async () => (await get_config()).search_engines,
  page_of,
  read_tab: (tab_id) => browser.tabs.get(tab_id).catch(() => undefined),
  discard: { ...browser_discard_deps, alternate_of: previous_tabs.previous_of },
  open_settings: async () => {
    const { open_completion, history_completion_max } = effective_settings((await get_config()).settings);
    return { sources: open_completion, history_max: history_completion_max };
  },
});

track_window_focus(browser.storage.session, browser.windows);

const asker_of = (sender: browser.runtime.MessageSender): Asker | undefined => {
  const { id, windowId, incognito } = sender.tab ?? {};
  return id === undefined || windowId === undefined || sender.frameId === undefined ? undefined : { tab_id: id, frame_id: sender.frameId, window_id: windowId, incognito: incognito === true };
};
const find_scan = create_find_scan(browser_find_scan_deps());

// Listeners register in the first turn, so no event is missed while the config loads.
browser.runtime.onMessage.addListener((message: unknown, sender) => {
  const request = message as ContentToBackground;
  if (request?.type === "mode_changed" && sender.tab?.id !== undefined) {
    const tab_id = sender.tab.id;
    return modes_cleared.then(() => remember_reported_mode(browser.storage.local, tab_id, sender.frameId, request.mode));
  }
  if (request?.type === "load_bundle") return bundle_loader.answer(sender, request.name);
  if (request?.type === "find_scan" && is_scan_request(request)) return find_scan.answer(request, `${sender.tab?.id}:${sender.frameId}`);
  if (request?.type === "issue_cmdline_ticket") return cmdline.issue_ticket(sender.tab?.id);
  if (request?.type === "open_cmdline") return get_config().then(() => cmdline.open(request.ticket, sender.tab?.id, sender.frameId, sender.tab?.windowId));
  if (request?.type === "complete_items") return complete_items.answer(request.kind, asker_of(sender));
  if (request?.type === "set_tab_unloaded") return complete_items.set_unloaded(request.tab_id, request.unloaded, asker_of(sender));
  if (request?.type === "image_action") return run_image_action(image_deps, request, { incognito: sender.tab?.incognito === true, cookie_store_id: sender.tab?.cookieStoreId });
  if (request?.type === "read_tab_address") return Promise.resolve(sender.tab?.url);
  if (request?.type === "open_help") return open_help.open(request.command_id, sender.tab?.id, sender.frameId);
  if (request?.type === "record_cmdline") return cmdline.record(request.text, sender.tab?.incognito === true);
  if (request?.type === "record_repeat") {
    return get_config().then(async () => {
      const invocation = page_record(request, (id) => registry.get(id), { search_engines: await get_search_engine_names(), containers: await container_names() });
      if (invocation) await repeat_memory.save([invocation], sender.tab?.incognito === true);
    });
  }
  if (request?.type === "list_keys") {
    const tab = sender.tab;
    const page = tab?.url ? { url: tab.url, ...(tab.title ? { title: tab.title } : {}) } : undefined;
    return get_config().then((config) => list_keys(browser.storage.local, (id) => registry.get(id), request, {
      page,
      requirement_of: requirement_lookup(config),
      site_engine_label_of: (invocation) => config.search_engines[site_engine_for(config.search_engines, invocation.site_search?.engines ?? [], page) ?? ""]?.label,
    }));
  }
  if ((message as SnippetCall)?.type === "snippet_run") {
    return get_config().then(() => snippets.handle_call(message as SnippetCall, { tab_id: sender.tab?.id, frame_id: sender.frameId }));
  }
  if (request?.type !== "run") return undefined;
  return get_config().then(async (config) => {
    const page = sender.tab?.url ? { url: sender.tab.url, ...(sender.tab.title ? { title: sender.tab.title } : {}) } : undefined;
    const settled = with_site_engines(request.invocations, config.search_engines, page);
    if ("unfit_letter" in settled) {
      const refusal = { id: "open.search", message: `No ${settled.unfit_letter} search for this site` };
      await router_deps.show_refusal(sender.tab?.id, refusal, sender.frameId);
      return { ok: false, refusal };
    }
    return router.run({
      invocations: settled.invocations,
      mode: request.mode,
      may_prompt: true,
      ...(request.from_hints === true && request.invocations.length === 1 && request.invocations[0]?.id === "open.url" ? { skip_repeat: true } : {}),
      ...(sender.tab?.id === undefined ? {} : { sender_tab_id: sender.tab.id }),
      ...(sender.frameId === undefined ? {} : { frame_id: sender.frameId }),
    });
  });
});

// The config may fail to load, and a failed load must not stop the page: the default is to open it.
browser.runtime.onInstalled.addListener(({ reason }) => {
  void open_quick_start_on_install(
    {
      reason,
      open_on_install: () => get_config().then((config) => effective_settings(config.settings).open_quick_start_on_install, () => DEFAULT_SETTINGS.open_quick_start_on_install),
      open_tab: (url) => browser.tabs.create({ url }),
    },
    (file) => browser.runtime.getURL(file),
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

browser.tabs.onUpdated.addListener((tab_id, change) => {
  void cmdline.forget_opener_on_navigation(tab_id, change);
  return forget_mode_on_navigation(browser.storage.local, tab_id, change);
});

browser.tabs.onActivated.addListener(({ windowId, previousTabId }) => previous_tabs.activated(windowId, previousTabId));

browser.tabs.onRemoved.addListener((tab_id, { windowId, isWindowClosing }) => {
  void previous_tabs.removed(tab_id, windowId, isWindowClosing);
  void cmdline.forget_opener(tab_id);
  return forget_tab_mode(browser.storage.local, tab_id);
});

void get_config().then(() => repair_tabs_after_reload(reinject_deps));

void create_tab_model(browser_tab_model_deps({ previous_of: previous_tabs.previous_of, is_opener: cmdline.is_opener })).start();
