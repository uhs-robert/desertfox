import { define } from "../shared/registry/index.ts";

// The help page lists every engine with its origins. The bare engine name opens it at that row.
define("engine.show", {
  label: "Show engine",
  intent: "Show the URL and fields of a search engine. It opens the help page at the engine, with the final URL, the page slots the engine needs and the file and level that set each field.",
  params: [{ name: "engine", type: "enum", values: { from: "search_engines" } }],
  runs_in: "background",
  repeatable: false,
  run: async (_ctx, args) => {
    const url = `${browser.runtime.getURL("help.html")}#engine=${encodeURIComponent(args.engine as string)}`;
    await browser.tabs.create({ url });
  },
});
