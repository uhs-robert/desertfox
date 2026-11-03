// Opens a URL where the command asks. Shared by open, page.home and site.

import { get_config } from "../background/startup.ts";
import { DEFAULT_SETTINGS } from "../shared/config.ts";
import type { CommandContext, ParamDef } from "../shared/index.ts";
import { url_target } from "./url_build.ts";

export const WHERE = ["here", "tab", "background", "window"] as const;
export type Where = (typeof WHERE)[number];

export const WHERE_PARAM: ParamDef = { name: "where", type: "enum", values: WHERE, default: "here" };

// Firefox cannot change the container of an open tab, so the param needs a new tab or window.
export const CONTAINER_PARAM: ParamDef = {
  name: "container",
  type: "string",
  values: { from: "containers" },
  when: { where: ["tab", "background", "window"] },
};

export const DEFAULT_CONTAINER_NAME = "default";
export const DEFAULT_COOKIE_STORE_ID = "firefox-default";

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
  if (store_id === undefined) throw new Error(`No container named "${container_name}"`);
  return store_id;
}

export function require_tab_id(ctx: CommandContext): number {
  if (ctx.tab_id === undefined) throw new Error("No tab");
  return ctx.tab_id;
}

export async function current_tab_url(ctx: CommandContext): Promise<string> {
  const tab = await browser.tabs.get(require_tab_id(ctx));
  if (!tab.url) throw new Error("This tab has no address");
  return tab.url;
}

// For text a person typed or configured. URLs that code built need no such pass.
export async function typed_url_target(text: string): Promise<string> {
  const { search_engines, settings } = await get_config();
  return url_target(text, settings.default_engine ?? DEFAULT_SETTINGS.default_engine, search_engines);
}

export async function open_in(ctx: CommandContext, url: string, where: Where, container?: string): Promise<void> {
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
