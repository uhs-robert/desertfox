import { define } from "../shared/registry/index.ts";
import { open_in, current_tab_url, WHERE_PARAM } from "./open_target.ts";
import type { Where } from "./open_target.ts";
import {
  archive_url,
  DEFAULT_SUBREDDIT,
  isdown_url,
  repo_search_url,
  site_search_url,
  subreddit_search_url,
  translate_url,
} from "./url_build.ts";
import type { CommandContext } from "../shared/index.ts";

const QUERY_PARAM = { name: "query", type: "string", rest: true, main: true } as const;

// Opens the URL a builder makes from the current page. The builder returns undefined when the page has no answer.
async function open_built(ctx: CommandContext, where: unknown, refusal: string, build: (page_url: string) => string | undefined) {
  const url = build(await current_tab_url(ctx));
  if (url === undefined) throw new Error(refusal);
  await open_in(ctx, url, where as Where);
}

define("site.search", {
  name: "sitesearch",
  label: "Search This Site",
  intent: "Search the current site with Google.",
  params: [QUERY_PARAM, WHERE_PARAM],
  runs_in: "background",
  run: (ctx, args) => open_built(ctx, args.where, "This address has no site", (page_url) => site_search_url(page_url, args.query as string)),
});

define("site.repo", {
  name: "repo",
  label: "Search This Repo",
  intent: "Search the code of the GitHub repository the page belongs to.",
  params: [QUERY_PARAM, WHERE_PARAM],
  runs_in: "background",
  run: (ctx, args) => open_built(ctx, args.where, "This page is not in a GitHub repository", (page_url) => repo_search_url(page_url, args.query as string)),
});

define("site.subreddit", {
  name: "subreddit",
  label: "Search Subreddit",
  intent: "Search a subreddit. Without a sub, search the one the page is in, or all of Reddit.",
  params: [QUERY_PARAM, { name: "sub", type: "string", default: DEFAULT_SUBREDDIT, flag: {} }, WHERE_PARAM],
  runs_in: "background",
  run: (ctx, args) => open_built(ctx, args.where, "This address has no subreddit search", (page_url) => subreddit_search_url(page_url, args.query as string, args.sub as string)),
});

define("site.archive", {
  name: "archive",
  label: "Archive Page",
  intent: "Open the page in the Internet Archive.",
  params: [WHERE_PARAM],
  runs_in: "background",
  run: (ctx, args) => open_built(ctx, args.where, "This address is not a web page", archive_url),
});

define("site.isdown", {
  name: "isdown",
  label: "Is It Down",
  intent: "Check whether the site is down for everyone.",
  params: [WHERE_PARAM],
  runs_in: "background",
  run: (ctx, args) => open_built(ctx, args.where, "This address has no site", isdown_url),
});

define("site.translate", {
  name: "translate",
  label: "Translate Page",
  intent: "Translate the page into English with Google Translate.",
  params: [WHERE_PARAM],
  runs_in: "background",
  run: (ctx, args) => open_built(ctx, args.where, "This address is not a web page", translate_url),
});
