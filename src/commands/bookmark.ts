import type { CommandContext } from "../shared/command.ts";
import { refuse_needing_command_line } from "../content/handlers/lazy_bundle.ts";
import { define } from "../shared/registry/index.ts";
import { WHERE_PARAM } from "./open_target.ts";

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
  label: "Add bookmark",
  intent: "Bookmark a url, the current page by default, titled with the page title.",
  params: [{ name: "url", type: "string", main: true, default: { from: "current_url" } }],
  runs_in: "background",
  run: (ctx, args) => handlers.add(ctx, args as { url: string }),
});

define("bookmark.open", {
  name: "bookmark",
  label: "Open bookmark",
  intent: "Open a bookmark chosen by title or address.",
  params: [{ name: "bookmark", type: "string", rest: true, main: true }, WHERE_PARAM],
  runs_in: "background",
  run: refuse_needing_command_line,
});
