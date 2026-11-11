import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { browser_complete_items_deps, history_items } from "../background/complete_items.ts";
import type { HistoryItem } from "../shared/messages.ts";
import { define } from "../shared/registry/builtin.ts";
import { open_in, pick_entry, WHERE_PARAM } from "./open_target.ts";
import type { Where } from "./open_target.ts";

export type HistoryDeps = {
  // Newest first, the same list the completion shows.
  history: () => Promise<HistoryItem[]>;
  // Firefox records no private visit, so a private tab has no history to open from.
  is_private: (ctx: CommandContext) => Promise<boolean>;
  open: (ctx: CommandContext, url: string, where: Where) => Promise<void>;
};

export function make_history_handlers(deps: HistoryDeps) {
  return {
    open: async (ctx: CommandContext, args: { entry: string; where: Where }) => {
      if (await deps.is_private(ctx)) throw new RuntimeRefusal("no history in a private window");
      const picked = pick_entry(await deps.history(), args.entry, "history entry");
      await deps.open(ctx, picked.url, args.where);
    },
  };
}

export const browser_history_deps: HistoryDeps = {
  history: async () => history_items(await browser_complete_items_deps.search_history()),
  is_private: async (ctx) => ctx.tab_id !== undefined && (await browser.tabs.get(ctx.tab_id)).incognito,
  open: (ctx, url, where) => open_in(ctx, url, where),
};

const handlers = make_history_handlers(browser_history_deps);

define("history.open", {
  name: "history",
  label: "Open history entry",
  intent: "Open a history entry chosen by title or address.",
  params: [{ name: "entry", type: "string", rest: true, main: true, values: { from: "history" } }, WHERE_PARAM],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handlers.open(ctx, args as { entry: string; where: Where }),
});
