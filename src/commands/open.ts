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
  params: [{ name: "url", type: "string", main: true, default: [{ value: "", when: { where: ["tab", "window", "background"] } }], values: { from: "open" } }, WHERE_PARAM, CONTAINER_PARAM],
  runs_in: "background",
  run: async (ctx, args) => open_in(ctx, await open_url_target(args.url as string), args.where as Where, container_of(args)),
});

define("open.search", {
  name: "search",
  label: "Search",
  intent: "Search with a keyword engine. The engine comes from the search engine list. It defaults to the default_engine setting and the query to the selection.",
  params: [
    // Empty stands for "none named", so the default_engine setting decides.
    { name: "engine", type: "enum", values: { from: "search_engines" }, optional: true },
    { name: "query", type: "string", rest: true, main: true, default: { from: "selection" } },
    WHERE_PARAM,
    CONTAINER_PARAM,
  ],
  runs_in: "background",
  run: async (ctx, args) => {
    const { search_engines, settings } = await get_config();
    const name = search_engine_name(args.engine, settings.default_engine ?? DEFAULT_SETTINGS.default_engine);
    if (!search_engines[name]) throw new RuntimeRefusal(`No search engine named "${name}"`);
    const page = await current_page(ctx);
    const url = engine_url(search_engines, name, { query: args.query as string, ...(page ? { page } : {}) });
    await open_in(ctx, url, args.where as Where, container_of(args));
  },
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
  runs_in: "background",
  run: async (ctx, args) => {
    const target = await typed_url_target(await text_to_open(ctx, args.register as string));
    await open_in(ctx, target, args.where as Where, container_of(args));
  },
});
