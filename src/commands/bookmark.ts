import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext, ParamDef } from "../shared/command.ts";
import { bookmark_rows, browser_complete_items_deps } from "../background/complete_items.ts";
import type { FolderNode } from "../background/complete_items.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";
import type { BookmarkItem, BookmarkRows, ToastKind } from "../shared/messages.ts";
import { in_folder, pick_folder, rows_in_folder } from "../shared/folder_pick.ts";
import { define } from "../shared/registry/builtin.ts";
import { open_in, open_many, pick_entry, WHERE_PARAM, WHERE_SHORT } from "./open_target.ts";
import type { Where } from "./open_target.ts";

export type BookmarkDeps = {
  // The title of the tab when it shows this url.
  tab_title_for_url: (tab_id: number | undefined, url: string) => Promise<string | undefined>;
  // `parent_id` is a folder id. Without it Firefox files the bookmark in its default folder.
  create: (bookmark: { url: string; title: string; parent_id?: string }) => Promise<void>;
  // Newest first, the same list the completion shows.
  bookmarks: () => Promise<BookmarkRows>;
  open: (ctx: CommandContext, url: string, where: Where) => Promise<void>;
  // The nodes Firefox finds for `url`. It ignores case and a trailing slash, so the handler checks the address again.
  nodes_for_url: (url: string) => Promise<{ id: string; parentId?: string | undefined; url?: string | undefined; type?: string | undefined; unmodifiable?: string | undefined }[]>;
  tab_url: (tab_id: number | undefined) => Promise<string | undefined>;
  remove: (id: string) => Promise<void>;
  update: (id: string, changes: { title?: string; url?: string }) => Promise<void>;
  move: (id: string, parent_id: string) => Promise<void>;
  folders: () => Promise<FolderNode[]>;
  open_many: (ctx: CommandContext, urls: readonly string[], where: Exclude<Where, "here">, report: (failed: number) => Promise<void>) => Promise<void>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
};

export const pick_bookmark = (bookmarks: readonly BookmarkItem[], text: string): BookmarkItem => pick_entry(bookmarks, text, "bookmark");

// The most tabs one `bookmark.open_folder` opens. A bigger folder opens its first tabs and the toast says so.
export const OPEN_FOLDER_CAP = 25;

// Addresses that cannot open as a page from an extension: a smart-bookmark query, script, and the browser's own pages. Opening one would stop the rest of the folder.
const UNOPENABLE_URL = /^(place|javascript|chrome|resource|file|data|view-source):|^about:(?!(blank|home|newtab)([?#]|$))/i;

export { pick_folder };

export function make_bookmark_handlers(deps: BookmarkDeps) {
  const bookmarks_at = async (url: string | undefined) => {
    const nodes = url === undefined ? [] : await deps.nodes_for_url(url);
    return nodes.filter((node) => node.url === url && (node.type === undefined || node.type === "bookmark"));
  };

  // The rows a command picks from. A folder keeps the rows filed in it or below it, and an unknown or tied folder is refused here.
  async function listed_bookmarks(folder: FolderNode | undefined): Promise<BookmarkItem[]> {
    const answer = await deps.bookmarks();
    return folder ? rows_in_folder(answer, folder.path) : answer.rows;
  }

  const folder_of = async (text: string): Promise<FolderNode | undefined> => (text.trim() === "" ? undefined : pick_folder(await deps.folders(), text));

  // The unmanaged bookmarks a command acts on. An empty `bookmark` means the current page. Completion lists one row per address, so a picked row stands for every bookmark with that address.
  // With a `folder`, only the copies filed in it or below it count, so a bookmark kept in two folders loses just the copy there.
  async function editable_bookmarks(ctx: CommandContext, bookmark: string, verb: string, folder_text = ""): Promise<{ id: string }[]> {
    const folder = await folder_of(folder_text);
    const url = bookmark.trim() === "" ? await deps.tab_url(ctx.tab_id) : pick_bookmark(await listed_bookmarks(folder), bookmark).url;
    const copies = await bookmarks_at(url);
    const inside = folder ? new Set((await deps.folders()).filter((candidate) => in_folder(candidate.path, folder.path)).map((candidate) => candidate.id)) : undefined;
    const found = inside ? copies.filter((node) => node.parentId !== undefined && inside.has(node.parentId)) : copies;
    if (found.length === 0) throw new RuntimeRefusal(folder ? `No bookmark for this page in ${folder.path}` : "No bookmark for this page");
    // A managed bookmark rejects a change, so it is left out before the first one runs.
    const matches = found.filter((node) => node.unmodifiable === undefined);
    if (matches.length === 0) throw new RuntimeRefusal(`This page's bookmarks are managed and cannot be ${verb}`);
    return matches;
  }

  // A managed folder rejects a new or moved bookmark, so it is refused before anything runs. Opening it is fine.
  async function writable_folder(text: string): Promise<FolderNode> {
    const folder = pick_folder(await deps.folders(), text);
    if (folder.managed) throw new RuntimeRefusal(`${folder.path} is managed and cannot be changed`);
    return folder;
  }

  const count_of = (count: number) => `${count} ${count === 1 ? "bookmark" : "bookmarks"}`;

  return {
    add: async (ctx: CommandContext, args: { url: string; folder: string }) => {
      const filed = args.folder.trim() !== "";
      if ((await bookmarks_at(args.url)).length > 0) throw new RuntimeRefusal(filed ? "Already bookmarked, use bm to move" : "Already bookmarked");
      const parent = filed ? { parent_id: (await writable_folder(args.folder)).id } : {};
      const title = (await deps.tab_title_for_url(ctx.tab_id, args.url)) || args.url;
      await deps.create({ url: args.url, title, ...parent });
    },
    move: async (ctx: CommandContext, args: { folder: string; bookmark: string }) => {
      const folder = await writable_folder(args.folder);
      const matches = await editable_bookmarks(ctx, args.bookmark, "moved");
      for (const { id } of matches) await deps.move(id, folder.id);
      await deps.toast(ctx, "success", `Moved ${count_of(matches.length)} to ${folder.path}`);
    },
    open_folder: async (ctx: CommandContext, args: { folder: string; where: Exclude<Where, "here"> }) => {
      const folder = pick_folder(await deps.folders(), args.folder);
      const total = folder.bookmarks.length;
      const openable = folder.bookmarks.flatMap((node) => (node.url && !UNOPENABLE_URL.test(node.url) ? [node.url] : []));
      if (openable.length === 0) throw new RuntimeRefusal(`No bookmarks to open in ${folder.path}`);
      const urls = openable.slice(0, OPEN_FOLDER_CAP);
      // The browser may still refuse an address the filter let through. open_many counts those and calls back before it moves the focus, so one toast carries every count.
      const report = async (failed: number) => {
        if (failed === urls.length) throw new RuntimeRefusal(`None of the bookmarks in ${folder.path} could be opened`);
        const skipped = total - openable.length + failed;
        const notes = [skipped > 0 ? `${skipped} cannot be opened` : "", openable.length > urls.length ? `the cap is ${OPEN_FOLDER_CAP}` : ""].filter(Boolean);
        if (notes.length > 0) await deps.toast(ctx, "warning", `Opened ${urls.length - failed} of ${total} bookmarks: ${notes.join(", ")}`);
      };
      await deps.open_many(ctx, urls, args.where, report);
    },
    open: async (ctx: CommandContext, args: { bookmark: string; folder: string; where: Where }) => {
      const picked = pick_bookmark(await listed_bookmarks(await folder_of(args.folder)), args.bookmark);
      await deps.open(ctx, picked.url, args.where);
    },
    remove: async (ctx: CommandContext, args: { bookmark: string; folder: string }) => {
      const matches = await editable_bookmarks(ctx, args.bookmark, "removed", args.folder);
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
  create: async ({ url, title, parent_id }) => void (await browser.bookmarks.create({ url, title, ...(parent_id === undefined ? {} : { parentId: parent_id }) })),
  bookmarks: async () => bookmark_rows(await browser_complete_items_deps.all_bookmarks(), await browser_complete_items_deps.folders()),
  open: (ctx, url, where) => open_in(ctx, url, where),
  nodes_for_url: (url) => browser.bookmarks.search({ url }),
  tab_url: async (tab_id) => (tab_id === undefined ? undefined : (await browser.tabs.get(tab_id)).url),
  remove: (id) => browser.bookmarks.remove(id),
  update: async (id, changes) => void (await browser.bookmarks.update(id, changes)),
  move: async (id, parent_id) => void (await browser.bookmarks.move(id, { parentId: parent_id })),
  folders: browser_complete_items_deps.folders,
  open_many,
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "bookmark", message, kind),
};

const handlers = make_bookmark_handlers(browser_bookmark_deps);

define("bookmark.add", {
  label: "Add bookmark",
  intent: "Bookmark a page. The url defaults to the current page, titled with the page title. Without a folder Firefox files it in its default folder. A page that already has a bookmark refuses with a folder too, so move it with bookmark.move.",
  params: [
    { name: "url", type: "string", main: true, format: "url", default: { from: "current_url" } },
    { name: "folder", type: "string", optional: true, values: { from: "folders" }, description: "File the bookmark in this folder." },
  ],
  runs_in: "background",
  run: (ctx, args) => handlers.add(ctx, args as { url: string; folder: string }),
});

define("bookmark.open", {
  name: "bookmark",
  label: "Open bookmark",
  intent: "Open a bookmark chosen by title or address. With a folder, choose among the bookmarks filed in it or in its subfolders. The folder matches as bookmark.add does.",
  params: [
    { name: "bookmark", type: "string", rest: true, main: true, values: { from: "bookmarks" } },
    { name: "folder", type: "string", optional: true, values: { from: "folders" }, description: "Only bookmarks in this folder or its subfolders." },
    WHERE_PARAM,
  ],
  runs_in: "background",
  run: (ctx, args) => handlers.open(ctx, args as { bookmark: string; folder: string; where: Where }),
});

define("bookmark.remove", {
  label: "Remove bookmark",
  intent: "Remove the current page's bookmarks. With an argument, remove the bookmark chosen by title or address. With a folder, remove only the copies filed in it or in its subfolders.",
  params: [
    { name: "bookmark", type: "string", rest: true, main: true, optional: true, values: { from: "bookmarks" } },
    { name: "folder", type: "string", optional: true, values: { from: "folders" }, description: "Only copies in this folder or its subfolders." },
  ],
  runs_in: "background",
  run: (ctx, args) => handlers.remove(ctx, args as { bookmark: string; folder: string }),
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
    { name: "url", type: "string", main: true, format: "url" },
    { name: "bookmark", type: "string", optional: true, values: { from: "bookmarks" }, description: "Change this bookmark, not the current page's." },
  ],
  runs_in: "background",
  run: (ctx, args) => handlers.edit_url(ctx, args as { bookmark: string; url: string }),
});

define("bookmark.move", {
  label: "Move bookmark to folder",
  intent: "Move the current page's bookmarks into a folder. With a bookmark, move the one chosen by title or address. Every bookmark with that address moves.",
  params: [
    { name: "folder", type: "string", rest: true, main: true, values: { from: "folders" } },
    { name: "bookmark", type: "string", optional: true, values: { from: "bookmarks" }, description: "Move this bookmark, not the current page's." },
  ],
  runs_in: "background",
  run: (ctx, args) => handlers.move(ctx, args as { folder: string; bookmark: string }),
});

// `here` is left out, since a folder is many pages. There is no default: no one value fits, and the shared -t -b -w letters stay.
const OPEN_FOLDER_WHERE_PARAM: ParamDef = {
  name: "where",
  type: "enum",
  values: ["tab", "background", "window"],
  short: WHERE_SHORT,
  value_labels: { tab: "in new tabs", background: "in background tabs", window: "in new window" },
  description: { tab: "Open in new tabs, the first one active.", background: "Open all in background tabs.", window: "Open all in a new window." },
};

define("bookmark.open_folder", {
  label: "Open bookmark folder",
  intent: `Open the bookmarks of a folder, not those of its subfolders. In a tab, the first one is active and the rest open in the background. At most ${OPEN_FOLDER_CAP} open.`,
  params: [
    { name: "folder", type: "string", rest: true, main: true, values: { from: "folders" } },
    OPEN_FOLDER_WHERE_PARAM,
  ],
  runs_in: "background",
  run: (ctx, args) => handlers.open_folder(ctx, args as { folder: string; where: Exclude<Where, "here"> }),
});
