import type { CommandContext } from "../shared/command.ts";
import { bookmark_items, browser_complete_items_deps } from "../background/complete_items.ts";
import type { BookmarkItem } from "../shared/messages.ts";
import { define } from "../shared/registry/index.ts";
import { best_match } from "../shared/score.ts";
import { open_in, WHERE_PARAM } from "./open_target.ts";
import type { Where } from "./open_target.ts";

export type BookmarkDeps = {
  // The title of the tab when it shows this url.
  tab_title_for_url: (tab_id: number | undefined, url: string) => Promise<string | undefined>;
  create: (bookmark: { url: string; title: string }) => Promise<void>;
  // Newest first, the same list the completion shows.
  bookmarks: () => Promise<BookmarkItem[]>;
  open: (ctx: CommandContext, url: string, where: Where) => Promise<void>;
};

// An exact address wins, since a completion pick puts the address in the line. Other text is a fuzzy match on title
// and address, and an equal tie is refused.
export function pick_bookmark(bookmarks: readonly BookmarkItem[], text: string): BookmarkItem {
  const typed = text.trim();
  const exact = bookmarks.find((bookmark) => bookmark.url === typed);
  if (exact) return exact;
  const match = best_match(typed, bookmarks, (bookmark) => ({ name: bookmark.title, description: bookmark.url }));
  if (match.found === "none") throw new Error(`no bookmark matches "${typed}"`);
  if (match.found === "tie") throw new Error(`"${typed}" matches "${match.first.title}" (${match.first.url}) and "${match.second.title}" (${match.second.url}) equally, use the address`);
  return match.item;
}

export function make_bookmark_handlers(deps: BookmarkDeps) {
  return {
    add: async (ctx: CommandContext, args: { url: string }) => {
      const title = (await deps.tab_title_for_url(ctx.tab_id, args.url)) || args.url;
      await deps.create({ url: args.url, title });
    },
    open: async (ctx: CommandContext, args: { bookmark: string; where: Where }) => {
      const picked = pick_bookmark(await deps.bookmarks(), args.bookmark);
      await deps.open(ctx, picked.url, args.where);
    },
  };
}

export const browser_bookmark_deps: BookmarkDeps = {
  tab_title_for_url: async (tab_id, url) => {
    if (tab_id === undefined) return undefined;
    const tab = await browser.tabs.get(tab_id);
    return tab.url === url ? tab.title : undefined;
  },
  create: async ({ url, title }) => void (await browser.bookmarks.create({ url, title })),
  bookmarks: async () => bookmark_items(await browser_complete_items_deps.all_bookmarks()),
  open: (ctx, url, where) => open_in(ctx, url, where),
};

const handlers = make_bookmark_handlers(browser_bookmark_deps);

define("bookmark.add", {
  label: "Add bookmark",
  intent: "Bookmark a page. The url defaults to the current page, titled with the page title.",
  params: [{ name: "url", type: "string", main: true, default: { from: "current_url" } }],
  runs_in: "background",
  run: (ctx, args) => handlers.add(ctx, args as { url: string }),
});

define("bookmark.open", {
  name: "bookmark",
  label: "Open bookmark",
  intent: "Open a bookmark chosen by title or address.",
  params: [{ name: "bookmark", type: "string", rest: true, main: true, values: { from: "bookmarks" } }, WHERE_PARAM],
  runs_in: "background",
  run: (ctx, args) => handlers.open(ctx, args as { bookmark: string; where: Where }),
});
