// Answers a page's `read_keymap` with the stored keymap resolved for the page's site (`shared/site/page_keymap_resolve.ts`), and holds what else the background reads from the keymap and the sender.

import { current_keymap, is_freed } from "../shared/prefix_tree.ts";
import { stored_keymap } from "./keymap_source.ts";
import { HINT_SITE_SETTINGS, ITEM_SELECT_SITE_SETTINGS, PAGE_REPLY_SITE_SETTINGS, QUALITY_SITE_SETTINGS } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, FrameSiteValues, PageKeymap, TreeLeaf } from "../shared/prefix_tree.ts";
import { DEFAULT_SETTINGS } from "../shared/default_settings.ts";
import { frees_of } from "../shared/keys/prune_tree.ts";
import { frame_site_values_for, trimmed_keymap_of, with_page_state } from "../shared/site/page_keymap_resolve.ts";
import { site_columns_for, type PageSiteColumns } from "../shared/site/site_columns.ts";

// The resolver moved to src/shared/site/page_keymap_resolve.ts. These names keep the importers of this file as they are.
export { frame_site_values_for, keymap_mode_trees_for, page_mode_trees_for, site_value } from "../shared/site/page_keymap_resolve.ts";

type KeymapStorage = Pick<typeof browser.storage.local, "get">;

// The frame's own address comes first, so `frame_site_values_for` can take it alone. The top frame matches on its own address only. `sender.tab.url` can still hold the previous page while the tab navigates, so only a subframe adds it: a frame of another site cannot read the tab's address itself.
export const rule_addresses_of = (sender: { frameId?: number | undefined; url?: string | undefined; tab?: { url?: string | undefined } | undefined }): (string | undefined)[] =>
  sender.frameId === 0 ? [sender.url] : [sender.url, sender.tab?.url];

// The sender as the page's address now. A request that names its address (`location.href`) is matched on it, because `sender.url` stays the address the document loaded at. Only an address of the same origin counts: an in-place change never leaves the origin, and an about:blank frame that wrote its document reports its parent's address, which must not give it the parent's rows.
const origin_of = (address: string | undefined): string | undefined => {
  try {
    return address === undefined ? undefined : new URL(address).origin;
  } catch {
    return undefined;
  }
};
export const sender_at = <S extends { url?: string | undefined }>(sender: S, url: unknown): S => (typeof url === "string" && origin_of(url) !== undefined && origin_of(url) !== "null" && origin_of(url) === origin_of(sender.url) ? { ...sender, url } : sender);

// A value about the whole tab, such as its zoom, follows the top page, so every frame resolves it against the top frame's address. A value about one frame's own content resolves against `[sender.url]`.
export const top_frame_address_of = (sender: { frameId?: number | undefined; url?: string | undefined; tab?: { url?: string | undefined } | undefined }): string | undefined =>
  sender.frameId === 0 ? sender.url : sender.tab?.url;

// A row that binds or passes j or k in normal mode gives those keys to the site (Kagi moves its own highlight), and item mode would take them back.
const site_claims_item_keys = (columns: PageSiteColumns): boolean =>
  ["j", "k"].some((key) => Object.hasOwn(columns.bind ?? {}, key) || Object.hasOwn(columns.keymap?.["normal"] ?? {}, key) || (columns.keys !== undefined && is_freed(frees_of(columns.keys), key)));

// A row's own `item_navigator` value decides its pages. A shipped row says `shipped`, which follows the global value unless that is false. With no row value only a global true starts the page.
const item_navigator_on = (columns: PageSiteColumns, global: CompiledKeymap["item_navigator"]): boolean => {
  const own = Object.hasOwn(columns.values, "item_navigator") ? columns.values["item_navigator"] : undefined;
  return own === undefined ? global === true : own === true || (own === "shipped" && global !== undefined);
};

// The item selectors of `page.item` steps in a leaf and in the choices behind its guards. Which guard holds is a question for the page, so every choice counts. The last fallback is the item section's own key, which has no selector.
const item_selectors_of = (leaf: TreeLeaf | undefined): string[] => {
  const selectors: string[] = [];
  for (let at = leaf; at; at = at.otherwise) {
    for (const { invocation } of at.steps) if (invocation.id === "page.item" && typeof invocation.args?.["selector"] === "string") selectors.push(invocation.args["selector"]);
  }
  return selectors;
};

export type ItemStart = { selectors: string[] };

// A site row that sets `item_navigator` to false keeps its pages out of item mode, even when the user followed a link there in the mode.
const item_navigator_refused = (columns: PageSiteColumns): boolean => Object.hasOwn(columns.values, "item_navigator") && columns.values["item_navigator"] === false;

// Whether a page that finished loading starts in item mode: the `item_navigator` setting for its address, unless a row switches every key off there or claims j or k. `resume` says the tab was in item mode when this load began (`tab_item.ts`), which starts any page with a list unless its row refuses. `selectors` are the item selectors of every item key the page's rows bind, so the start looks for the rows' items and not the finder's list. With none, the finder reads the page.
export async function item_start_for(storage: KeymapStorage, address: string | undefined, { resume = false } = {}): Promise<ItemStart | undefined> {
  const keymap = current_keymap(await stored_keymap(storage));
  const columns = site_columns_for(keymap, [address]);
  if (keymap === undefined || columns.off === true || site_claims_item_keys(columns)) return undefined;
  if (resume ? item_navigator_refused(columns) : !item_navigator_on(columns, keymap.item_navigator)) return undefined;
  return { selectors: [...new Set(Object.values(columns.keymap?.["item"] ?? {}).flatMap(({ leaf }) => item_selectors_of(leaf)))] };
}

// Answers the hints bundle's `read_hint_selectors` with the frame's hint selectors, an empty object when none apply.
export async function hint_selectors_reply(storage: KeymapStorage, frame_address: string | undefined): Promise<FrameSiteValues<(typeof HINT_SITE_SETTINGS)[number]>> {
  const keymap = current_keymap(await stored_keymap(storage));
  return (keymap && frame_site_values_for(keymap, frame_address, HINT_SITE_SETTINGS)) ?? {};
}

// Answers the quality bundle's `quality_report` (from a frame with a video) with the rule for the frame's own address: a `media quality` value (a height as text) or `off`. A page with no stored keymap (nothing compiled yet) keeps the global default.
export async function media_quality_reply(storage: KeymapStorage, frame_address: string | undefined): Promise<string> {
  const keymap = current_keymap(await stored_keymap(storage));
  const value = (keymap && frame_site_values_for(keymap, frame_address, QUALITY_SITE_SETTINGS)?.media_quality) ?? DEFAULT_SETTINGS.media_quality;
  return String(value);
}

// True when no page can have a rule to apply: the global value is `off` or `auto` (both leave the player alone) and no site row asks for a quality. A row of `off` or `auto` asks for nothing. A page with no stored keymap keeps the global default, so the default `auto` makes it idle too.
export async function media_quality_is_idle(storage: KeymapStorage): Promise<boolean> {
  const keymap = current_keymap(await stored_keymap(storage));
  const global = keymap?.frame_site_globals?.media_quality ?? DEFAULT_SETTINGS.media_quality;
  return (global === "off" || global === "auto") && !(keymap?.site_rules ?? []).some(({ values }) => values !== undefined && Object.hasOwn(values, "media_quality") && values.media_quality !== "off" && values.media_quality !== "auto");
}

// The mode a frame that starts late joins. Insert wins: media entry leaves a frame in insert alone too. Media and item are asked only when the holds before them are not held, so a join writes the frame into a hold only when the frame joins it.
// Only a frame's first ask joins: a re-ask (config reload, macro recording) from a frame in another mode must not write it into a hold.
export type JoinMode = "insert" | "media" | "item";
export const join_mode = async (first_ask: boolean, insert_held: () => Promise<boolean>, media_held: () => Promise<boolean>, item_held: () => Promise<boolean>): Promise<JoinMode | undefined> =>
  !first_ask ? undefined : (await insert_held()) ? "insert" : (await media_held()) ? "media" : (await item_held()) ? "item" : undefined;

export async function page_keymap_for(storage: KeymapStorage, addresses: readonly (string | undefined)[], recording?: string, join?: () => Promise<JoinMode | undefined>, bar = false): Promise<PageKeymap | undefined> {
  const trimmed = trimmed_keymap_of(current_keymap(await stored_keymap(storage)), addresses);
  const joined = trimmed && !trimmed.all_off ? await join?.() : undefined;
  return with_page_state(trimmed, { recording, join: joined, bar });
}

// A string, not the object: the structured clone of the whole tree cost the page about 11 ms, and `JSON.parse` of the string costs a few.
export const read_keymap_reply = async (storage: KeymapStorage, addresses: readonly (string | undefined)[], recording?: string, join?: () => Promise<JoinMode | undefined>, bar = false): Promise<string | undefined> => {
  const reply = await page_keymap_for(storage, addresses, recording, join, bar);
  return reply && JSON.stringify(reply);
};

// The setting values of a site row that the page resolver reads: `frame_site_values_for` is asked for these names only.
const SHIM_SITE_VALUES: readonly string[] = [...PAGE_REPLY_SITE_SETTINGS, ...ITEM_SELECT_SITE_SETTINGS];

// The stored keymap as the locked page snapshot holds it, less what the shim never reads: each row's `origin`, `name`, `site` (the site rules view reads them), its setting values outside `SHIM_SITE_VALUES`, and the top-level `item_navigator`. The rows then no longer fit `SiteRule`, which is why the shim reads them only through `page_keymap_of`.
export function keymap_snapshot_of(keymap: CompiledKeymap | undefined): CompiledKeymap | undefined {
  if (keymap === undefined) return undefined;
  const { item_navigator: _, ...rest } = keymap;
  const site_rules = keymap.site_rules?.map(({ origin: _origin, name: _name, site: _site, values, ...row }: Record<string, unknown> & { values?: Readonly<Record<string, unknown>> }) => ({
    ...row,
    ...(values && { values: Object.fromEntries(Object.entries(values).filter(([name]) => SHIM_SITE_VALUES.includes(name))) }),
  }));
  return { ...rest, ...(site_rules && { site_rules: site_rules as unknown as CompiledKeymap["site_rules"] }) } as CompiledKeymap;
}
