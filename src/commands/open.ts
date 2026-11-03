import { get_config } from "../background/startup.ts";
import { define } from "../shared/registry/index.ts";
import { CONTAINER_PARAM, open_in, typed_url_target, WHERE_PARAM } from "./open_target.ts";
import type { Where } from "./open_target.ts";
import { DEFAULT_SETTINGS } from "../shared/config.ts";
import { engine_search_url, search_engine_name } from "./url_build.ts";

const container_of = (args: Record<string, unknown>) => (typeof args.container === "string" ? args.container : undefined);

define("open.url", {
  name: "open",
  label: "Open URL",
  intent: "Open a URL here, in a new tab, in a background tab or in a new window.",
  params: [{ name: "url", type: "string", main: true }, WHERE_PARAM, CONTAINER_PARAM],
  runs_in: "background",
  run: async (ctx, args) => open_in(ctx, await typed_url_target(args.url as string), args.where as Where, container_of(args)),
});

define("open.search", {
  name: "search",
  label: "Search",
  intent: "Search with a keyword engine from the search engine list. The engine defaults to the default_engine setting and the query to the selection.",
  params: [
    // The empty default stands for "none named", which the validator needs to treat the param as optional.
    { name: "engine", type: "enum", values: { from: "search_engines" }, default: "" },
    { name: "query", type: "string", rest: true, main: true, default: { from: "selection" } },
    WHERE_PARAM,
    CONTAINER_PARAM,
  ],
  runs_in: "background",
  run: async (ctx, args) => {
    const { search_engines, settings } = await get_config();
    const name = search_engine_name(args.engine, settings.default_engine ?? DEFAULT_SETTINGS.default_engine);
    const engine = search_engines[name];
    if (!engine) throw new Error(`No search engine named "${name}"`);
    await open_in(ctx, engine_search_url(engine.url, args.query as string), args.where as Where, container_of(args));
  },
});

define("open.clipboard", {
  name: "paste",
  label: "Open clipboard",
  intent: "Open the URL on the clipboard. Text that is not a URL is searched with the default_engine setting.",
  params: [WHERE_PARAM, CONTAINER_PARAM],
  runs_in: "background",
  run: async (ctx, args) => {
    const target = await typed_url_target(await navigator.clipboard.readText());
    await open_in(ctx, target, args.where as Where, container_of(args));
  },
});
