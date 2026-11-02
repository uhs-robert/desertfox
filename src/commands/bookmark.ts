import type { CommandContext } from "../shared/command.ts";
import { define } from "../shared/registry/index.ts";

export type BookmarkDeps = {
  // The title of the tab when it shows this url.
  tab_title_for_url: (tab_id: number | undefined, url: string) => Promise<string | undefined>;
  create: (bookmark: { url: string; title: string }) => Promise<void>;
};

export function make_bookmark_handlers(deps: BookmarkDeps) {
  return {
    add: async (ctx: CommandContext, args: { url: string }) => {
      const title = (await deps.tab_title_for_url(ctx.tab_id, args.url)) || args.url;
      await deps.create({ url: args.url, title });
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
};

const handlers = make_bookmark_handlers(browser_bookmark_deps);

define("bookmark.add", {
  name: "bookmarkadd",
  label: "Add Bookmark",
  intent: "Bookmark a url, the current page by default, titled with the page title.",
  params: [{ name: "url", type: "string", default: { from: "current_url" } }],
  runs_in: "background",
  run: (ctx, args) => handlers.add(ctx, args as { url: string }),
});
