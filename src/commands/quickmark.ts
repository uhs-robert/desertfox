import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { get_config } from "../background/startup.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";
import { browser_quickmark_store } from "../background/quickmark_store.ts";
import { is_private_context } from "../background/register_store.ts";
import { shorten_address } from "../shared/mark_text.ts";
import { QUICKMARK_KEY } from "../shared/quickmark_names.ts";
import type { QuickmarkTable } from "../shared/quickmark_names.ts";
import type { ToastKind } from "../shared/messages.ts";
import { define } from "../shared/registry/builtin.ts";
import { current_tab_url, open_in, own_pages, typed_url_target, WHERE_PARAM } from "./open_target.ts";
import type { Where } from "./open_target.ts";

export type QuickmarkDeps = {
  // The quickmarks this window opens: config table, saved ones, and private ones in a private window.
  table: (ctx: CommandContext) => Promise<QuickmarkTable>;
  save: (ctx: CommandContext, key: string, url: string) => Promise<void>;
  remove: (ctx: CommandContext, key: string) => Promise<void>;
  tab_url: (ctx: CommandContext) => Promise<string>;
  // Turns an address written without a scheme into one that opens, as `o` does.
  target: (text: string) => Promise<string>;
  open: (ctx: CommandContext, url: string, where: Where) => Promise<void>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
};

export function make_quickmark_handlers(deps: QuickmarkDeps) {
  return {
    add: async (ctx: CommandContext, args: { key: string }) => {
      const url = await deps.tab_url(ctx);
      await deps.save(ctx, args.key, url);
      await deps.toast(ctx, "success", `Quickmark ${args.key} set`);
    },
    open: async (ctx: CommandContext, args: { key: string; where: Where }) => {
      const url = (await deps.table(ctx))[args.key];
      if (url === undefined) throw new RuntimeRefusal(`No quickmark ${args.key}`);
      await deps.open(ctx, await deps.target(url), args.where);
    },
    // Opens the quickmark in this tab. The command line list is the overview.
    list: async (ctx: CommandContext, args: { quickmark: string }) => {
      const url = (await deps.table(ctx))[args.quickmark.trim()];
      if (url === undefined) throw new RuntimeRefusal(`No quickmark ${args.quickmark.trim()}`);
      await deps.open(ctx, await deps.target(url), "here");
    },
    delete: async (ctx: CommandContext, args: { quickmark: string }) => {
      const key = args.quickmark.trim();
      await deps.remove(ctx, key);
      // A saved key can shadow an address of quickmarks.toml (or, in a private window, a normal one), which opens again.
      const still = (await deps.table(ctx))[key];
      await deps.toast(ctx, "success", still === undefined ? `Quickmark ${key} deleted` : `Quickmark ${key} deleted, it now opens ${shorten_address(still)}`);
    },
  };
}

export const browser_quickmark_deps: QuickmarkDeps = {
  table: async (ctx) => browser_quickmark_store.table((await get_config()).quickmarks, await is_private_context(ctx)),
  save: async (ctx, key, url) => browser_quickmark_store.add(key, url, await is_private_context(ctx)),
  remove: async (ctx, key) => browser_quickmark_store.remove(key, await is_private_context(ctx)),
  tab_url: current_tab_url,
  target: (text) => typed_url_target(text, own_pages),
  open: (ctx, url, where) => open_in(ctx, url, where),
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "quickmark", message, kind),
};

const handlers = make_quickmark_handlers(browser_quickmark_deps);

const KEY_PARAM_SOURCE = QUICKMARK_KEY.source;

define("quickmark.add", {
  label: "Add quickmark",
  intent: "Save this page's address under a key. Saving the key again replaces it, and it wins over the same key in quickmarks.toml.",
  params: [{ name: "key", type: "key", pattern: KEY_PARAM_SOURCE, description: "Name the quickmark with this letter or digit." }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.add(ctx, args as { key: string }),
});

define("quickmark.open", {
  label: "Open quickmark",
  intent: "Open a quickmark. It opens here, or where the flag says. Quickmarks come from quickmarks.toml and quickmark.add.",
  params: [{ name: "key", type: "key", pattern: KEY_PARAM_SOURCE, description: "Open the quickmark under this letter or digit." }, WHERE_PARAM],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handlers.open(ctx, args as { key: string; where: Where }),
});

define("quickmark.list", {
  name: "quickmarks",
  label: "List quickmarks",
  intent: "Pick a quickmark from the list and open it in this tab.",
  params: [{ name: "quickmark", type: "string", rest: true, main: true, values: { from: "quickmarks" }, pattern: KEY_PARAM_SOURCE, description: "Open the quickmark under this letter or digit." }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.list(ctx, args as { quickmark: string }),
});

define("quickmark.delete", {
  label: "Delete quickmark",
  intent: "Delete a quickmark saved with `M`. A private window deletes only its own private ones. An entry of quickmarks.toml stays until the file changes.",
  params: [{ name: "quickmark", type: "string", rest: true, main: true, values: { from: "saved_quickmarks" }, pattern: KEY_PARAM_SOURCE, description: "Delete the quickmark under this letter or digit." }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.delete(ctx, args as { quickmark: string }),
});
