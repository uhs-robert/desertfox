import { RuntimeRefusal } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { current_tab_url, open_in } from "./open_target.ts";
import { incremented_url, parent_url, root_url } from "./url_build.ts";

// A count fills `levels` instead of repeating: a repeat would read the tab URL again before the last navigation lands.
define("url.parent", {
  label: "Parent URL",
  intent: "Go up one level in the URL path. A count prefix goes up that many levels.",
  params: [{ name: "levels", type: "int", default: 1 }],
  runs_in: "background",
  count: { param: "levels" },
  run: async (ctx, args) => {
    const parent = parent_url(await current_tab_url(ctx), args.levels as number);
    if (parent === undefined) throw new RuntimeRefusal("This address has no parent");
    await open_in(ctx, parent, "here");
  },
});

define("url.root", {
  label: "Root URL",
  intent: "Go to the top of the site.",
  runs_in: "background",
  run: async (ctx) => {
    const root = root_url(await current_tab_url(ctx));
    if (root === undefined) throw new RuntimeRefusal("This address has no site root");
    await open_in(ctx, root, "here");
  },
});

// A count fills `amount` for the same reason it fills `levels` above.
define("url.increment", {
  label: "Change URL number",
  intent: "Change the last number in the URL. A count sets the amount.",
  params: [
    { name: "direction", type: "enum", values: ["up", "down"], value_labels: { up: "add to the number", down: "subtract from the number" }, description: { up: "Add the amount to the number.", down: "Subtract the amount from the number." } },
    { name: "amount", type: "int", min: 1, default: 1 },
  ],
  runs_in: "background",
  count: { param: "amount" },
  run: async (ctx, args) => {
    const next = incremented_url(await current_tab_url(ctx), args.direction as "up" | "down", args.amount as number);
    await open_in(ctx, next, "here");
  },
});
