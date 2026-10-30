// Opens a URL where the command asks. Shared by open, page.home and site.

import type { CommandContext, ParamDef } from "../shared/index.ts";

export const WHERE = ["current", "new_tab", "background", "new_window"] as const;
export type Where = (typeof WHERE)[number];

export const WHERE_PARAM: ParamDef = { name: "where", type: "enum", values: WHERE, default: "current", flag: { short: "w" } };

// Firefox cannot change the container of an open tab, so the param needs a new tab or window.
export const CONTAINER_PARAM: ParamDef = {
  name: "container",
  type: "string",
  values: { from: "containers" },
  flag: { short: "c" },
  when: { where: ["new_tab", "background", "new_window"] },
};

async function container_store_id(container: string | undefined): Promise<string | undefined> {
  if (container === undefined) return undefined;
  const [identity] = await browser.contextualIdentities.query({ name: container });
  if (!identity) throw new Error(`No container named "${container}"`);
  return identity.cookieStoreId;
}

export async function current_tab_url(ctx: CommandContext): Promise<string> {
  const tab = ctx.tab_id === undefined ? undefined : await browser.tabs.get(ctx.tab_id);
  if (!tab?.url) throw new Error("This tab has no address");
  return tab.url;
}

export async function open_in(ctx: CommandContext, url: string, where: Where, container?: string): Promise<void> {
  if (where === "current") {
    if (ctx.tab_id === undefined) throw new Error("No tab to open in");
    await browser.tabs.update(ctx.tab_id, { url });
    return;
  }
  const cookie_store_id = await container_store_id(container);
  const store = cookie_store_id === undefined ? {} : { cookieStoreId: cookie_store_id };
  if (where === "new_window") {
    await browser.windows.create({ url, ...store });
    return;
  }
  const opener = ctx.tab_id === undefined ? {} : { openerTabId: ctx.tab_id };
  await browser.tabs.create({ url, active: where === "new_tab", ...opener, ...store });
}
