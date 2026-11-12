import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { get_config } from "../background/startup.ts";
import { define } from "../shared/registry/builtin.ts";
import { OPEN_REGISTER_PARAM } from "./register_param.ts";
import { CONTAINER_PARAM, current_page, open_in, typed_url_target, WHERE_PARAM } from "./open_target.ts";
import type { Where } from "./open_target.ts";
import { BUILT_IN_PAGE, DEFAULT_SETTINGS, NEW_TAB_PAGE_FILE } from "../shared/config.ts";
import { browser_register_store, is_private_context } from "../background/register_store.ts";
import { engine_url, home_page_url, search_engine_name } from "./url_build.ts";
import { decode_ref } from "../shared/anything_ref.ts";

const container_of = (args: Record<string, unknown>) => (typeof args.container === "string" ? args.container : undefined);

// A blank url opens the built-in new tab page, the same page `page.home` opens for `desertfox`.
// The param schema decides where a blank url is allowed, so this takes whatever the check let through.
async function open_url_target(text: string): Promise<string> {
  if (text.trim() !== "") return typed_url_target(text);
  return home_page_url(BUILT_IN_PAGE, () => browser.runtime.getURL(NEW_TAB_PAGE_FILE));
}

define("open.url", {
  name: "open",
  label: "Open URL",
  intent: "Open a URL. It opens here, in a new tab, in a background tab or in a new window. With no URL, a new tab, background tab or window opens the new tab page, and opening here needs a URL.",
  params: [{ name: "url", type: "string", rest: true, main: true, default: [{ value: "", when: { where: ["tab", "window", "background"] } }], values: { from: "open" } }, WHERE_PARAM, CONTAINER_PARAM],
  bridge: true,
  runs_in: "background",
  run: async (ctx, args) => open_in(ctx, await open_url_target(args.url as string), args.where as Where, container_of(args)),
});

// The address a search opens: the engine named, else the default_engine setting, filled from the page of the command's tab.
async function search_target(ctx: CommandContext, engine: unknown, query: string): Promise<string> {
  const { search_engines, settings } = await get_config();
  const name = search_engine_name(engine, settings.default_engine ?? DEFAULT_SETTINGS.default_engine);
  if (!search_engines[name]) throw new RuntimeRefusal(`No search engine named "${name}"`);
  const page = await current_page(ctx);
  return engine_url(search_engines, name, { query, ...(page ? { page } : {}) });
}

define("open.search", {
  name: "search",
  label: "Search",
  intent: "Search with a keyword engine. The engine comes from the search engine list. It defaults to the default_engine setting and the query to the selection, else the query of the search results page you are on.",
  params: [
    // Empty stands for "none named", so the default_engine setting decides.
    { name: "engine", type: "enum", values: { from: "search_engines" }, optional: true },
    { name: "query", type: "string", rest: true, main: true, default: { from: "selection", then: "search_query" } },
    WHERE_PARAM,
    CONTAINER_PARAM,
  ],
  bridge: false,
  runs_in: "background",
  run: async (ctx, args) => open_in(ctx, await search_target(ctx, args.engine, args.query as string), args.where as Where, container_of(args)),
});

export type AnythingDeps = {
  is_private: (ctx: CommandContext) => Promise<boolean>;
  // The tab's window and privacy, undefined when it is gone.
  read_tab: (tab_id: number) => Promise<{ window_id: number; incognito: boolean } | undefined>;
  activate: (tab_id: number) => Promise<void>;
  focus_window: (window_id: number) => Promise<void>;
  restore_closed: (session_id: string) => Promise<void>;
  target: (text: string) => Promise<string>;
  search: (ctx: CommandContext, engine: string | undefined, query: string) => Promise<string>;
  open: (ctx: CommandContext, url: string, where: Where) => Promise<void>;
};

// The query holds the reference of the row the finder highlighted, or plain text when no row was. Plain text opens like the last row does.
// A tab row switches to its tab and a closed-tab row restores it, whatever `where` says.
export function make_anything_handlers(deps: AnythingDeps) {
  return {
    run: async (ctx: CommandContext, args: { query: string; where: Where }) => {
      const ref = decode_ref(args.query) ?? { kind: "web" as const, query: args.query };
      const private_line = await deps.is_private(ctx);
      if (ref.kind === "tab") {
        const tab = await deps.read_tab(ref.id);
        if (!tab || tab.incognito !== private_line) throw new RuntimeRefusal("That tab is gone");
        await deps.activate(ref.id);
        if (tab.window_id !== ctx.window_id) await deps.focus_window(tab.window_id);
      } else if (ref.kind === "closed") {
        if (private_line) throw new RuntimeRefusal("A private window has no closed tabs");
        await deps.restore_closed(ref.session_id);
      } else if (ref.kind === "page") await deps.open(ctx, await deps.target(ref.url), args.where);
      else if (ref.kind === "engine") await deps.open(ctx, await deps.search(ctx, ref.engine, ref.query), args.where);
      else await deps.open(ctx, await deps.target(ref.query), args.where);
    },
  };
}

const anything_handlers = make_anything_handlers({
  is_private: is_private_context,
  read_tab: async (tab_id) => {
    const tab = await browser.tabs.get(tab_id).catch(() => undefined);
    return tab?.windowId === undefined ? undefined : { window_id: tab.windowId, incognito: tab.incognito };
  },
  activate: async (tab_id) => void (await browser.tabs.update(tab_id, { active: true })),
  focus_window: async (window_id) => void (await browser.windows.update(window_id, { focused: true })),
  restore_closed: async (session_id) => void (await browser.sessions.restore(session_id)),
  target: typed_url_target,
  search: search_target,
  open: (ctx, url, where) => open_in(ctx, url, where),
});

define("open.anything", {
  name: "anything",
  label: "Find anything",
  intent: "Find a page in one list. The list holds open tabs, quickmarks, bookmarks, history, recently closed tabs and search engines. Enter switches to an open tab and restores a closed one. Any other row opens here, or where the flag says. Shift+Enter opens in a new tab. A first word that is an engine's keyword searches that engine.",
  params: [{ name: "query", type: "string", rest: true, main: true, values: { from: "anything" } }, WHERE_PARAM],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => anything_handlers.run(ctx, args as { query: string; where: Where }),
});

// A register that holds a macro has no text to open.
async function text_to_open(ctx: CommandContext, register: string): Promise<string> {
  if (register.trim() === "") return navigator.clipboard.readText();
  const name = register.trim();
  const value = await browser_register_store.read(name, await is_private_context(ctx));
  if (value === undefined || value === "") throw new RuntimeRefusal(`Register ${name} is empty`);
  if (typeof value !== "string") throw new RuntimeRefusal(`Register ${name} holds a macro, not text`);
  return value;
}

define("open.clipboard", {
  name: "paste",
  label: "Open clipboard",
  intent: "Open the URL on the clipboard or in a register. Text that is not a URL is searched with the default_engine setting.",
  params: [WHERE_PARAM, CONTAINER_PARAM, OPEN_REGISTER_PARAM],
  bridge: false,
  runs_in: "background",
  run: async (ctx, args) => {
    const target = await typed_url_target(await text_to_open(ctx, args.register as string));
    await open_in(ctx, target, args.where as Where, container_of(args));
  },
});
