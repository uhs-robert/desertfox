import { define } from "../shared/registry/index.ts";
import { current_tab_url } from "./open_target.ts";
import { parent_url, root_url } from "./url_build.ts";

async function go_to(tab_id: number | undefined, url: string): Promise<void> {
  if (tab_id === undefined) throw new Error("No tab");
  await browser.tabs.update(tab_id, { url });
}

// A count fills `levels` instead of repeating: a repeat would read the tab URL again before the last navigation lands.
define("url.parent", {
  name: "parent",
  label: "Parent URL",
  intent: "Go up one level in the URL path. A count prefix goes up that many levels.",
  params: [{ name: "levels", type: "int", default: 1 }],
  runs_in: "background",
  count: { param: "levels" },
  run: async (ctx, args) => {
    const parent = parent_url(await current_tab_url(ctx), args.levels as number);
    if (parent === undefined) throw new Error("This address has no parent");
    await go_to(ctx.tab_id, parent);
  },
});

define("url.root", {
  name: "root",
  label: "Root URL",
  intent: "Go to the top of the site.",
  runs_in: "background",
  run: async (ctx) => {
    const root = root_url(await current_tab_url(ctx));
    if (root === undefined) throw new Error("This address has no site root");
    await go_to(ctx.tab_id, root);
  },
});
