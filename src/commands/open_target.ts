// Opens a URL where the command asks. Shared by open, page.home and the other commands that open pages.

import { RuntimeRefusal } from "../shared/command.ts";
import { DEFAULT_CONTAINER_NAME, DEFAULT_COOKIE_STORE_ID } from "../shared/container_store.ts";
import { get_config } from "../background/startup.ts";
import { DEFAULT_SETTINGS } from "../shared/config.ts";
import type { CommandContext, ParamDef } from "../shared/index.ts";
import type { PageInfo } from "../shared/engines/slots.ts";
import { openable_url, require_openable, url_target } from "./url_build.ts";
import type { OwnPages } from "./url_build.ts";
import { pick_by } from "../shared/folder_pick.ts";
import type { Pickable } from "../shared/folder_pick.ts";

export const WHERE = ["here", "tab", "background", "window"] as const;
export type Where = (typeof WHERE)[number];

// `-t -b -w` mean the same on every command that has a where param, and `-c` always means container.
export const WHERE_SHORT = { tab: "t", background: "b", window: "w" } as const;

export const WHERE_PARAM: ParamDef = {
  name: "where",
  type: "enum",
  values: WHERE,
  default: "here",
  short: WHERE_SHORT,
  value_labels: { tab: "in new tab", background: "in background tab", window: "in new window" },
  description: { tab: "Open in a new tab.", background: "Open in a background tab.", window: "Open in a new window." },
};

// Firefox cannot change the container of an open tab, so the param needs a new tab or window.
export const CONTAINER_PARAM: ParamDef = {
  name: "container",
  type: "string",
  values: { from: "containers" },
  when: { where: ["tab", "background", "window"] },
  short: "c",
  description: "Open in a container.",
};

export type FindContainerStoreId = (container_name: string) => Promise<string | undefined>;

// Tolerates a browser with containers turned off: the lookup then finds nothing.
export const find_container_store_id: FindContainerStoreId = async (container_name) => {
  const identities = await browser.contextualIdentities.query({ name: container_name }).catch(() => undefined);
  return Array.isArray(identities) ? identities.find((identity) => identity.name === container_name)?.cookieStoreId : undefined;
};

// The one container-to-cookie-store lookup. `default` is the container-less store. Undefined in, undefined out.
export async function resolve_container_store_id(container_name: string, find?: FindContainerStoreId): Promise<string>;
export async function resolve_container_store_id(container_name: string | undefined, find?: FindContainerStoreId): Promise<string | undefined>;
export async function resolve_container_store_id(
  container_name: string | undefined,
  find: FindContainerStoreId = find_container_store_id,
): Promise<string | undefined> {
  if (container_name === undefined) return undefined;
  if (container_name === DEFAULT_CONTAINER_NAME) return DEFAULT_COOKIE_STORE_ID;
  const store_id = await find(container_name);
  if (store_id === undefined) throw new RuntimeRefusal(`No container named "${container_name}"`);
  return store_id;
}

export function require_tab_id(ctx: CommandContext): number {
  if (ctx.tab_id === undefined) throw new RuntimeRefusal("No tab");
  return ctx.tab_id;
}

export async function current_tab_url(ctx: CommandContext): Promise<string> {
  const tab = await browser.tabs.get(require_tab_id(ctx));
  if (!tab.url) throw new RuntimeRefusal("This tab has no address");
  return tab.url;
}

// What the page slots read. Undefined when the tab cannot be read, so page slots then refuse with their own message.
export async function current_page(ctx: CommandContext): Promise<PageInfo | undefined> {
  if (ctx.tab_id === undefined) return undefined;
  const tab = await browser.tabs.get(ctx.tab_id).catch(() => undefined);
  return tab?.url ? { url: tab.url, ...(tab.title ? { title: tab.title } : {}) } : undefined;
}

// The extension's own pages may open from the user's config and stored data, and from typed text in a request no page sent. Text a page sent, such as a hinted link or the selection, may not open them, and neither may the clipboard or a register.
export const own_pages: NonNullable<OwnPages> = () => browser.runtime.getURL("");
export const own_pages_for = (ctx: CommandContext): OwnPages => (ctx.from_page ? undefined : own_pages);

// The addresses `open_in` and `open_many` take come from typed text that `url_target` already checked against the request's sender, or from code, config and stored data. So the extension's own pages pass here.
export const is_openable = (url: string): boolean => openable_url(url, own_pages);

// For text a person typed or configured. URLs that code built need no such pass.
export async function typed_url_target(text: string, may_open_own_pages: OwnPages): Promise<string> {
  const { search_engines, settings } = await get_config();
  return url_target(text, settings.default_engine ?? DEFAULT_SETTINGS.default_engine, search_engines, may_open_own_pages);
}

export async function open_in(ctx: CommandContext, url: string, where: Where, container?: string): Promise<void> {
  await open_in_with_id(ctx, url, where, container);
}

// The id of the tab it made, for a caller that must place or activate it later. A window and `here` give none.
async function open_in_with_id(ctx: CommandContext, url: string, where: Where, container?: string): Promise<number | undefined> {
  require_openable(url, own_pages);
  return open_in_unchecked(ctx, url, where, container);
}

// Firefox opens a window with no container and not private unless told otherwise, so a window opened from a container or private tab must carry that tab's state. An unreadable sender tab gives the old plain window.
// A private window has no containers, so naming one from a private tab is refused. `default` is a named container and still counts.
async function new_window_context(ctx: CommandContext, container_store_id: string | undefined): Promise<{ cookieStoreId?: string; incognito?: true }> {
  const tab = ctx.tab_id === undefined ? undefined : await browser.tabs.get(ctx.tab_id).catch(() => undefined);
  if (tab?.incognito) {
    if (container_store_id !== undefined) throw new RuntimeRefusal("A private window has no containers");
    return { incognito: true };
  }
  if (container_store_id !== undefined) return { cookieStoreId: container_store_id };
  if (tab?.cookieStoreId !== undefined && tab.cookieStoreId !== DEFAULT_COOKIE_STORE_ID) return { cookieStoreId: tab.cookieStoreId };
  return {};
}

async function open_in_unchecked(ctx: CommandContext, url: string, where: Where, container?: string): Promise<number | undefined> {
  if (where === "here") {
    await browser.tabs.update(require_tab_id(ctx), { url });
    return undefined;
  }
  const cookie_store_id = await resolve_container_store_id(container);
  if (where === "window") {
    await browser.windows.create({ url, ...(await new_window_context(ctx, cookie_store_id)) });
    return undefined;
  }
  const store = cookie_store_id === undefined ? {} : { cookieStoreId: cookie_store_id };
  // Firefox rejects an openerTabId from another window, and the sender tab can sit in a window that is not focused.
  const opener = ctx.tab_id === undefined ? {} : { openerTabId: ctx.tab_id, ...(ctx.window_id === undefined || ctx.window_id < 0 ? {} : { windowId: ctx.window_id }) };
  return (await browser.tabs.create({ url, active: where === "tab", ...opener, ...store })).id;
}

// Opens several addresses at once. A tab opens them all in the background in order, then makes the first one active: a tab that opens active changes the selected tab, and Firefox then stops placing the next tabs after it.
// An address the browser refuses is skipped and counted. `report` gets that count once, after the tabs exist and before the focus moves, so a toast still lands on the tab the user is looking at.
// A window gets its toast after it opens, because the window takes the focus when it is created.
export async function open_many(ctx: CommandContext, urls: readonly string[], where: Exclude<Where, "here">, report: (failed: number) => Promise<void>): Promise<void> {
  let failed = 0;
  if (where === "window") {
    let window_id: number | undefined;
    const context = await new_window_context(ctx, undefined);
    for (const url of urls) {
      try {
        require_openable(url, own_pages);
        if (window_id === undefined) window_id = (await browser.windows.create({ url, ...context })).id;
        else await browser.tabs.create({ url, active: false, windowId: window_id });
      } catch {
        failed++;
      }
    }
    await report(failed);
    return;
  }
  const opened: number[] = [];
  for (const url of urls) {
    try {
      opened.push((await open_in_with_id(ctx, url, "background")) as number);
    } catch {
      failed++;
    }
  }
  await report(failed);
  if (where === "tab" && opened[0] !== undefined) await browser.tabs.update(opened[0], { active: true });
}

export { pick_by };
export type { Pickable };

// The boost ranks as in the list, so Enter on a typed word picks the row the list shows first.
export function pick_entry<Entry extends { title: string; url: string; boost?: number }>(entries: readonly Entry[], text: string, noun: string): Entry {
  return pick_by(entries, text, noun, (entry) => ({ key: entry.url, name: entry.title, description: entry.url, boost: entry.boost }), (entry) => `"${entry.title}" (${entry.url})`, "the address");
}
