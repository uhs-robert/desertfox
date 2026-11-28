import { COPY_FORMATS, RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext, CopyFormat, ParamDef } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { YANK_REGISTER_PARAM } from "./register_param.ts";
import { BLACK_HOLE_REGISTER } from "../shared/register_names.ts";
import { format_page_link } from "../shared/copy/page_link.ts";
import { dedupe_links, format_link_list } from "../shared/copy/link_list.ts";
import type { ListFormat as LinkFormat } from "../shared/copy/link_list.ts";
import { parse_page_links } from "../shared/browser_module_page_links.ts";
import type { PageLinkScope } from "../shared/browser_module_page_links.ts";
import { browser_module_call } from "../background/browser_module_call.ts";
import { strip_tracking } from "../shared/copy/strip_tracking.ts";
import { show_toast_on_tab, page_of } from "../background/browser_deps.ts";
import { browser_register_store, is_private_context } from "../background/register_store.ts";
import type { RegisterStore } from "../background/register_store.ts";
import { strip_resolver } from "../background/strip_patterns.ts";
import { refused_as } from "../shared/swallow.ts";

const COPY_URL_PARAMS = [
    {
      name: "format",
      type: "enum",
      values: COPY_FORMATS,
      default: "plain",
      short: { canonical: "C", short: "s", title: "T", markdown: "m", org: "o" },
      value_labels: { canonical: "in canonical form", short: "shortened", title: "as page title", markdown: "as Markdown link", org: "as Org link" },
      description: {
        canonical: "Copy the canonical address.",
        short: "Copy the shortened address.",
        title: "Copy the page title.",
        markdown: "Copy a Markdown link.",
        org: "Copy an Org link.",
      },
    },
    YANK_REGISTER_PARAM,
] as const satisfies readonly ParamDef[];

define("copy.url", {
  name: "copy",
  label: "Copy URL",
  intent: "Copy the page address or a link. The clipboard gets the address, the title or a link in one of six formats.",
  params: COPY_URL_PARAMS,
  bridge: false,
  runs_in: "content",
  bundle: "page",
});

export type CopyPageDeps = {
  page: (ctx: CommandContext) => Promise<{ url: string; title?: string } | undefined>;
  is_private: (ctx: CommandContext) => Promise<boolean>;
  strip_patterns: () => Promise<(address: string) => readonly string[]>;
  write_clipboard: (text: string) => Promise<void>;
  store: RegisterStore;
  toast: (ctx: CommandContext, message: string) => Promise<void>;
};

// `copy.url` for a page with no DesertFox page code (see `LOCKED_VARIANTS` in shared/browser_module_scope.ts). It reads what the browser already lists of the tab, its address and title, and nothing from the page.
// A canonical or short link lives in the page's own markup, which this reads nothing of, so those two formats give the address, as `copy.url` does for a page with no such link.
export function make_copy_page_handler(deps: CopyPageDeps) {
  return async (ctx: CommandContext, args: { format: CopyFormat; register?: string }): Promise<void> => {
    const page = await deps.page(ctx);
    if (!page) throw new RuntimeRefusal("No page to copy");
    const register = args.register ?? "";
    if (register === BLACK_HOLE_REGISTER) return;
    const patterns = (await deps.strip_patterns())(page.url);
    const text = format_page_link(args.format, { url: strip_tracking(page.url, patterns), title: page.title ?? "", canonical_url_: undefined, short_url_: undefined });
    const copied = await refused_as(deps.write_clipboard(text).then(() => true), false);
    // A private window's registers stay apart from the normal ones, as for every yank.
    await deps.store.yank(register, text, await deps.is_private(ctx));
    if (!copied) throw new RuntimeRefusal("Could not copy to the clipboard");
    await deps.toast(ctx, `Copied ${text}`);
  };
}

const copy_page = make_copy_page_handler({
  page: (ctx) => page_of(ctx.tab_id),
  is_private: is_private_context,
  strip_patterns: () => strip_resolver(browser.storage.local),
  write_clipboard: (text) => navigator.clipboard.writeText(text),
  store: browser_register_store,
  toast: (ctx, message) => show_toast_on_tab(ctx, "copy_page", message, "success"),
});

define("copy.page", {
  label: "Copy page link",
  intent: "Copy the tab's address or title with no page code. A locked page takes it in place of Copy URL.",
  params: COPY_URL_PARAMS,
  completion: "hidden",
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => copy_page(ctx, args),
});

const COPY_LINKS_PARAMS = [
  {
    name: "scope",
    type: "enum",
    values: ["page", "viewport"],
    default: "page",
    short: { viewport: "v" },
    value_labels: { viewport: "in view" },
    description: { viewport: "Copy only the links in view." },
  },
  {
    name: "format",
    type: "enum",
    values: ["markdown", "plain", "org"],
    default: "markdown",
    short: { plain: "u", org: "o" },
    value_labels: { plain: "as plain addresses", org: "as an Org list" },
    description: { plain: "Copy the addresses, one per line.", org: "Copy an Org list." },
  },
  YANK_REGISTER_PARAM,
] as const satisfies readonly ParamDef[];

define("copy.links", {
  name: "copylinks",
  label: "Copy links",
  intent: "Copy the web links of the page as a list. The clipboard gets one line per link, the whole page or only what is in view, as Markdown, Org or plain addresses.",
  params: COPY_LINKS_PARAMS,
  bridge: false,
  runs_in: "content",
  bundle: "hints",
});

export type CopyPageLinksDeps = {
  page: (ctx: CommandContext) => Promise<{ url: string } | undefined>;
  // The module's read of the page's links: the reply value is foreign JSON text.
  ask_links: (ctx: CommandContext, scope: PageLinkScope) => Promise<{ ok: true; value?: string } | { ok: false; error: string }>;
  is_private: (ctx: CommandContext) => Promise<boolean>;
  strip_patterns: () => Promise<(address: string) => readonly string[]>;
  write_clipboard: (text: string) => Promise<void>;
  store: RegisterStore;
  toast: (ctx: CommandContext, message: string) => Promise<void>;
};

// An older module has no handler for the kind.
const MODULE_LACKS_LINKS = "no handler for this kind";

// `copy.links` for a page with no DesertFox page code (see `LOCKED_VARIANTS` in shared/browser_module_scope.ts). The browser module reads the links, and everything after that is the page's own path: strip, dedupe, format, clipboard, registers.
export function make_copy_page_links_handler(deps: CopyPageLinksDeps) {
  return async (ctx: CommandContext, args: { scope: PageLinkScope; format: LinkFormat; register?: string }): Promise<void> => {
    const page = await deps.page(ctx);
    if (!page) throw new RuntimeRefusal("No page to copy");
    const register = args.register ?? "";
    if (register === BLACK_HOLE_REGISTER) return;
    const read = await deps.ask_links(ctx, args.scope);
    if (!read.ok) throw new RuntimeRefusal(read.error === MODULE_LACKS_LINKS ? "Needs a newer browser module" : read.error);
    const pairs = parse_page_links(read.value);
    if (pairs === undefined) throw new RuntimeRefusal("The browser module sent links that could not be read");
    const patterns = (await deps.strip_patterns())(page.url);
    const links = dedupe_links(pairs, ({ address }) => address, patterns, ({ text }, url) => text || url);
    if (links.length === 0) throw new RuntimeRefusal("No links on this page");
    const text = format_link_list(links, args.format);
    const copied = await refused_as(deps.write_clipboard(text).then(() => true), false);
    // A private window's registers stay apart from the normal ones, as for every yank.
    await deps.store.yank(register, text, await deps.is_private(ctx));
    if (!copied) throw new RuntimeRefusal("Could not copy to the clipboard");
    await deps.toast(ctx, `Copied ${links.length} ${links.length === 1 ? "link" : "links"}`);
  };
}

const copy_page_links = make_copy_page_links_handler({
  page: (ctx) => page_of(ctx.tab_id),
  ask_links: async (ctx, scope) => (ctx.tab_id === undefined ? { ok: false, error: "No page to copy" } : browser_module_call.call("page_links.read", { tab_id: ctx.tab_id, scope })),
  is_private: is_private_context,
  strip_patterns: () => strip_resolver(browser.storage.local),
  write_clipboard: (text) => navigator.clipboard.writeText(text),
  store: browser_register_store,
  toast: (ctx, message) => show_toast_on_tab(ctx, "copy_page_links", message, "success"),
});

define("copy.page_links", {
  label: "Copy page links",
  intent: "Copy the page's links through the browser module.",
  params: COPY_LINKS_PARAMS,
  completion: "hidden",
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => copy_page_links(ctx, args),
});

