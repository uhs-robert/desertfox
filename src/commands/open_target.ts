// Opens a URL where the command asks. Shared by open, page.home and the other commands that open pages.

import { RuntimeRefusal } from "../shared/command.ts";
import { DEFAULT_CONTAINER_NAME, DEFAULT_COOKIE_STORE_ID } from "../shared/container_store.ts";
import { get_config } from "../background/startup.ts";
import { DEFAULT_SETTINGS } from "../shared/config.ts";
import type { CommandContext, ParamDef } from "../shared/index.ts";
import type { PageInfo } from "../shared/engines/slots.ts";
import { url_target } from "./url_build.ts";

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

// For text a person typed or configured. URLs that code built need no such pass.
export async function typed_url_target(text: string): Promise<string> {
  const { search_engines, settings } = await get_config();
  return url_target(text, settings.default_engine ?? DEFAULT_SETTINGS.default_engine, search_engines);
}

// Firefox refuses privileged pages such as about:config from extensions. The refusal is shown as a notice, so the text is never searched instead.
const ABOUT_URL = /^about:/i;
const PRIVILEGED_URL_REFUSAL = /illegal url|privileged/i;

export async function open_in(ctx: CommandContext, url: string, where: Where, container?: string): Promise<void> {
  try {
    await open_in_unchecked(ctx, url, where, container);
  } catch (error) {
    if (!ABOUT_URL.test(url) || !PRIVILEGED_URL_REFUSAL.test(String(error))) throw error;
    throw new RuntimeRefusal(`Firefox does not let extensions open ${url}`);
  }
}

async function open_in_unchecked(ctx: CommandContext, url: string, where: Where, container?: string): Promise<void> {
  if (where === "here") {
    await browser.tabs.update(require_tab_id(ctx), { url });
    return;
  }
  const cookie_store_id = await resolve_container_store_id(container);
  const store = cookie_store_id === undefined ? {} : { cookieStoreId: cookie_store_id };
  if (where === "window") {
    await browser.windows.create({ url, ...store });
    return;
  }
  const opener = ctx.tab_id === undefined ? {} : { openerTabId: ctx.tab_id };
  await browser.tabs.create({ url, active: where === "tab", ...opener, ...store });
}
