import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { bookmark_items, browser_complete_items_deps } from "../background/complete_items.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";
import type { BookmarkItem, ToastKind } from "../shared/messages.ts";
import { define } from "../shared/registry/builtin.ts";
import { open_in, pick_entry, WHERE_PARAM } from "./open_target.ts";
import type { Where } from "./open_target.ts";

export type BookmarkDeps = {
  // The title of the tab when it shows this url.
  tab_title_for_url: (tab_id: number | undefined, url: string) => Promise<string | undefined>;
  create: (bookmark: { url: string; title: string }) => Promise<void>;
  // Newest first, the same list the completion shows.
  bookmarks: () => Promise<BookmarkItem[]>;
  open: (ctx: CommandContext, url: string, where: Where) => Promise<void>;
  // The nodes Firefox finds for `url`. It ignores case and a trailing slash, so the handler checks the address again.
  nodes_for_url: (url: string) => Promise<{ id: string; url?: string | undefined; type?: string | undefined; unmodifiable?: string | undefined }[]>;
  tab_url: (tab_id: number | undefined) => Promise<string | undefined>;
  remove: (id: string) => Promise<void>;
  update: (id: string, changes: { title?: string; url?: string }) => Promise<void>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
};

export const pick_bookmark = (bookmarks: readonly BookmarkItem[], text: string): BookmarkItem => pick_entry(bookmarks, text, "bookmark");

export function make_bookmark_handlers(deps: BookmarkDeps) {
  const bookmarks_at = async (url: string | undefined) => {
    const nodes = url === undefined ? [] : await deps.nodes_for_url(url);
    return nodes.filter((node) => node.url === url && (node.type === undefined || node.type === "bookmark"));
  };

  // The unmanaged bookmarks a command acts on. An empty `bookmark` means the current page. Completion lists one row per address, so a picked row stands for every bookmark with that address.
  async function editable_bookmarks(ctx: CommandContext, bookmark: string, verb: string): Promise<{ id: string }[]> {
    const url = bookmark.trim() === "" ? await deps.tab_url(ctx.tab_id) : pick_bookmark(await deps.bookmarks(), bookmark).url;
    const found = await bookmarks_at(url);
    if (found.length === 0) throw new RuntimeRefusal("No bookmark for this page");
    // A managed bookmark rejects a change, so it is left out before the first one runs.
    const matches = found.filter((node) => node.unmodifiable === undefined);
    if (matches.length === 0) throw new RuntimeRefusal(`This page's bookmarks are managed and cannot be ${verb}`);
    return matches;
  }

  const count_of = (count: number) => `${count} ${count === 1 ? "bookmark" : "bookmarks"}`;

  return {
    add: async (ctx: CommandContext, args: { url: string }) => {
      if ((await bookmarks_at(args.url)).length > 0) throw new RuntimeRefusal("Already bookmarked");
      const title = (await deps.tab_title_for_url(ctx.tab_id, args.url)) || args.url;
      await deps.create({ url: args.url, title });
    },
    open: async (ctx: CommandContext, args: { bookmark: string; where: Where }) => {
      const picked = pick_bookmark(await deps.bookmarks(), args.bookmark);
      await deps.open(ctx, picked.url, args.where);
    },
    remove: async (ctx: CommandContext, args: { bookmark: string }) => {
      const matches = await editable_bookmarks(ctx, args.bookmark, "removed");
      for (const { id } of matches) await deps.remove(id);
      await deps.toast(ctx, "success", `Removed ${count_of(matches.length)}`);
    },
    rename: async (ctx: CommandContext, args: { bookmark: string; title: string }) => {
      const matches = await editable_bookmarks(ctx, args.bookmark, "renamed");
      for (const { id } of matches) await deps.update(id, { title: args.title });
      await deps.toast(ctx, "success", `Renamed ${count_of(matches.length)}`);
    },
    edit_url: async (ctx: CommandContext, args: { bookmark: string; url: string }) => {
      const matches = await editable_bookmarks(ctx, args.bookmark, "changed");
      // Moving a bookmark onto an address that has one would make the duplicate that add refuses. The same address is a no-op, not a clash.
      const taken = (await bookmarks_at(args.url)).some((node) => !matches.some((match) => match.id === node.id));
      if (taken) throw new RuntimeRefusal("Already bookmarked");
      for (const { id } of matches) await deps.update(id, { url: args.url });
      await deps.toast(ctx, "success", `Changed the address of ${count_of(matches.length)}`);
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
  nodes_for_url: (url) => browser.bookmarks.search({ url }),
  tab_url: async (tab_id) => (tab_id === undefined ? undefined : (await browser.tabs.get(tab_id)).url),
  remove: (id) => browser.bookmarks.remove(id),
  update: async (id, changes) => void (await browser.bookmarks.update(id, changes)),
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "bookmark", message, kind),
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

define("bookmark.remove", {
  label: "Remove bookmark",
  intent: "Remove the current page's bookmarks. With an argument, remove the bookmark chosen by title or address.",
  params: [{ name: "bookmark", type: "string", rest: true, main: true, optional: true, values: { from: "bookmarks" } }],
  runs_in: "background",
  run: (ctx, args) => handlers.remove(ctx, args as { bookmark: string }),
});

define("bookmark.rename", {
  label: "Rename bookmark",
  intent: "Rename the current page's bookmarks. With a bookmark, rename the one chosen by title or address.",
  params: [
    { name: "title", type: "string", rest: true, main: true },
    { name: "bookmark", type: "string", optional: true, values: { from: "bookmarks" }, description: "Rename this bookmark, not the current page's." },
  ],
  runs_in: "background",
  run: (ctx, args) => handlers.rename(ctx, args as { bookmark: string; title: string }),
});

define("bookmark.edit_url", {
  label: "Edit bookmark address",
  intent: "Change the address of the current page's bookmarks. With a bookmark, change the one chosen by title or address.",
  params: [
    { name: "url", type: "string", main: true },
    { name: "bookmark", type: "string", optional: true, values: { from: "bookmarks" }, description: "Change this bookmark, not the current page's." },
  ],
  runs_in: "background",
  run: (ctx, args) => handlers.edit_url(ctx, args as { bookmark: string; url: string }),
});
