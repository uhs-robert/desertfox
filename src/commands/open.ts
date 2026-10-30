import { get_config } from "../background/startup.ts";
import { define } from "../shared/registry/index.ts";
import { CONTAINER_PARAM, open_in, WHERE_PARAM } from "./open_target.ts";
import type { Where } from "./open_target.ts";
import { engine_search_url } from "./url_build.ts";

const container_of = (args: Record<string, unknown>) => (typeof args.container === "string" ? args.container : undefined);

define("open.url", {
  name: "open",
  label: "Open URL",
  intent: "Open a URL in this tab, a new tab, a background tab or a new window.",
  params: [{ name: "url", type: "string" }, WHERE_PARAM, CONTAINER_PARAM],
  runs_in: "background",
  run: (ctx, args) => open_in(ctx, args.url as string, args.where as Where, container_of(args)),
});

define("open.search", {
  name: "search",
  aliases: ["s"],
  label: "Search",
  intent: "Search with a keyword engine from the search engine list. The query defaults to the selection.",
  params: [
    { name: "engine", type: "enum", values: { from: "search_engines" } },
    { name: "query", type: "string", rest: true, default: { from: "selection" } },
    WHERE_PARAM,
    CONTAINER_PARAM,
  ],
  flags: [
    { short: "b", long: "background", sets: { where: "background" }, label: "Open in a background tab" },
    { short: "t", long: "tab", sets: { where: "new_tab" }, label: "Open in a new tab" },
  ],
  runs_in: "background",
  run: async (ctx, args) => {
    const engine = (await get_config()).search_engines[args.engine as string];
    if (!engine) throw new Error(`No search engine named "${String(args.engine)}"`);
    await open_in(ctx, engine_search_url(engine.url, args.query as string), args.where as Where, container_of(args));
  },
});

define("open.clipboard", {
  name: "paste",
  label: "Open Clipboard",
  intent: "Open the URL on the clipboard.",
  params: [WHERE_PARAM, CONTAINER_PARAM],
  runs_in: "background",
  run: async (ctx, args) => {
    const text = (await navigator.clipboard.readText()).trim();
    if (!URL.canParse(text)) throw new Error("The clipboard does not hold a URL");
    await open_in(ctx, text, args.where as Where, container_of(args));
  },
});
