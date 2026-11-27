// Answers a page's `read_keymap`: the stored keymap trimmed for the page's site table columns, so the content script holds no rule logic.

import { current_keymap } from "../shared/prefix_tree.ts";
import { stored_keymap } from "./keymap_source.ts";
import { ANY_KEY, is_freed } from "../shared/prefix_tree.ts";
import { HINT_SITE_SETTINGS, ITEM_SELECT_SITE_SETTINGS, PAGE_REPLY_SITE_SETTINGS, QUALITY_SITE_SETTINGS } from "../shared/prefix_tree.ts";
import { is_default_value } from "../shared/keys/compiler.ts";
import type { CompiledKeymap, FrameSiteName, FrameSiteValues, PageKeymap, PageSiteMode, SiteBind, TreeBranch, TreeLeaf } from "../shared/prefix_tree.ts";
import { DEFAULT_SETTINGS } from "../shared/default_settings.ts";
import { with_item_select } from "./item_select.ts";
import { resolve_mode_parents } from "../shared/keys/mode_parents.ts";
import type { KeymapMode } from "../shared/keymap.ts";
import { frees_of } from "../shared/keys/prune_tree.ts";
import type { PerSiteName, Settings } from "../shared/settings_table.ts";
import type { SiteModeColumn } from "../shared/match_pattern.ts";
import { graft_binds, normal_tree_for, site_columns_for, type PageSiteColumns } from "../shared/site/site_columns.ts";

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

// A per-site setting on a page. The cast holds because the setting's own check accepted the value when the config loaded. The site's value beats the global value, which already holds `:set` and `:set --temp`: the row names the site and `:set` does not.
export const site_value = <Name extends PerSiteName>(columns: PageSiteColumns, name: Name, global_value: Settings[Name]): Settings[Name] =>
  Object.hasOwn(columns.values, name) ? (columns.values[name] as Settings[Name]) : global_value;

// The named frame site settings for one frame, resolved against the frame's own address only: a tab-level row reaching a frame of another site would act on content that row never named.
export function frame_site_values_for<Name extends FrameSiteName>(keymap: CompiledKeymap, frame_address: string | undefined, names: readonly Name[]): FrameSiteValues<Name> | undefined {
  const columns = site_columns_for(keymap, [frame_address]);
  const values: Record<string, unknown> = {};
  for (const name of names) {
    const value = site_value(columns, name, keymap.frame_site_globals?.[name] ?? DEFAULT_SETTINGS[name]);
    if (!is_default_value(name, value)) values[name] = value;
  }
  return Object.keys(values).length > 0 ? (values as FrameSiteValues<Name>) : undefined;
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

// The trees of the other keymap modes with the page's binds for them. Like `modes.<name>`, they skip a page that is off, and `pass` and `only` do not reach them: those prune the normal tree. A mode with no tree of its own starts from an empty one. The page reply and which-key both read them here.
export function keymap_mode_trees_for(modes: CompiledKeymap["modes"], columns: PageSiteColumns): CompiledKeymap["modes"] {
  return Object.fromEntries(Object.entries(columns.keymap ?? {}).map(([mode, binds]) => [mode, graft_binds(modes[mode as keyof CompiledKeymap["modes"]], binds)]));
}

// The mode trees of one page: the row binds grafted on, each child mode given its parent's keys from the page's own trees (after `pass` and `only`), and the item trees rewritten for the site's own arrow keys when `item_select` says `arrows` for the frame's own address. The page reply and which-key both read them here, so they show the same keys.
export function page_mode_trees_for(keymap: CompiledKeymap, columns: PageSiteColumns, frame_address: string | undefined): CompiledKeymap["modes"] {
  const grafted = keymap_mode_trees_for(keymap.modes, columns);
  const normal = normal_tree_for(keymap.modes.normal, columns).tree;
  const resolved = resolve_mode_parents({ ...keymap.modes, ...grafted, ...(normal && { normal }) }, keymap.mode_parents);
  const children = Object.fromEntries((Object.keys(keymap.mode_parents ?? {}) as KeymapMode[]).flatMap((mode) => (resolved[mode] ? [[mode, resolved[mode]]] : [])));
  const trees: CompiledKeymap["modes"] = { ...grafted, ...children };
  const arrows = frame_site_values_for(keymap, frame_address, ITEM_SELECT_SITE_SETTINGS)?.item_select === "arrows";
  if (!arrows || !keymap.item_select_keys) return trees;
  const { item_select_keys } = keymap;
  // The normal tree too: a row's `I` lands on its items from normal mode, and the landing selects there as well. Visual item mode takes the rewritten item keys.
  const rewritten = (["item", "item_visual", "normal"] as const).flatMap((mode) => {
    const tree = mode === "normal" ? normal : (trees[mode] ?? keymap.modes[mode]);
    return tree ? [[mode, with_item_select(tree, item_select_keys)]] : [];
  });
  return { ...trees, ...Object.fromEntries(rewritten) };
}

// Each site mode of the page as what it adds to the normal tree: its binds go onto the tree after `pass` and `only` prune it, so a mode bind survives a key rule. The page lays the unchanged children of the normal tree under them, so only the children the mode replaced are sent.
function site_modes_for(tree: TreeBranch | undefined, modes: Readonly<Record<string, SiteModeColumn<SiteBind>>>): Record<string, PageSiteMode> {
  return Object.fromEntries(
    Object.entries(modes).map(([name, { label, bind, sticky }]) => {
      const grafted = graft_binds(tree, bind);
      return [name, { label, ...(sticky && { sticky }), tree: Object.fromEntries(Object.entries(grafted.children).filter(([token, child]) => child !== tree?.children[token])) }];
    }),
  );
}

const STOP_LEAF: TreeLeaf = { kind: "leaf", label: "Stop recording", steps: [{ invocation: { id: "macro.stop" }, runs_in: "background", count_rule: "ignore" }] };

// While a macro records, the key that started it stops it, as in vim. The key waits for a register name, so it is a branch whose one child is the capture leaf. Where the user put the key does not matter.
function with_stop_for_record(node: TreeBranch): TreeBranch {
  const children = Object.fromEntries(
    Object.entries(node.children).map(([token, child]) => {
      if (child.kind === "leaf") return [token, child];
      const capture = child.children[ANY_KEY];
      return [token, capture?.kind === "leaf" && capture.steps[0]?.invocation.id === "macro.record" ? STOP_LEAF : with_stop_for_record(child)];
    }),
  );
  return { ...node, children };
}

// The mode a frame that starts late joins. Insert wins: media entry leaves a frame in insert alone too. Media and item are asked only when the holds before them are not held, so a join writes the frame into a hold only when the frame joins it.
// Only a frame's first ask joins: a re-ask (config reload, macro recording) from a frame in another mode must not write it into a hold.
export type JoinMode = "insert" | "media" | "item";
export const join_mode = async (first_ask: boolean, insert_held: () => Promise<boolean>, media_held: () => Promise<boolean>, item_held: () => Promise<boolean>): Promise<JoinMode | undefined> =>
  !first_ask ? undefined : (await insert_held()) ? "insert" : (await media_held()) ? "media" : (await item_held()) ? "item" : undefined;

// `recording` is the register a macro is being recorded into, or undefined.
// While the browser module's status bar is up the page hides its own corner badge, which the reply says through the setting it already obeys, and reports what the bar shows.
const with_bar = (reply: PageKeymap | undefined, bar: boolean): PageKeymap | undefined => (reply && bar ? { ...reply, keymap: { ...reply.keymap, mode_indicator: "off", bar: true } } : reply);

export async function page_keymap_for(storage: KeymapStorage, addresses: readonly (string | undefined)[], recording?: string, join?: () => Promise<JoinMode | undefined>, bar = false): Promise<PageKeymap | undefined> {
  const trimmed = with_bar(await trimmed_keymap_for(storage, addresses), bar);
  const joined = trimmed && !trimmed.all_off ? await join?.() : undefined;
  const reply = trimmed && joined ? { ...trimmed, join: joined } : trimmed;
  if (!reply || recording === undefined) return reply;
  const normal = reply.keymap.modes.normal;
  // A mode tree meets the stop key too: a mode bind under the record key would otherwise hide it.
  const site_modes = reply.site_modes && Object.fromEntries(Object.entries(reply.site_modes).map(([name, mode]) => [name, { ...mode, tree: with_stop_for_record({ kind: "branch", children: mode.tree }).children }]));
  return { ...reply, ...(site_modes && { site_modes }), keymap: normal ? { ...reply.keymap, modes: { ...reply.keymap.modes, normal: with_stop_for_record(normal) } } : reply.keymap, recording };
}

async function trimmed_keymap_for(storage: KeymapStorage, addresses: readonly (string | undefined)[]): Promise<PageKeymap | undefined> {
  const keymap = current_keymap(await stored_keymap(storage));
  if (keymap === undefined) return undefined;
  const { site_rules: _, frame_site_globals: __, item_navigator: ___, item_select_keys: ____, mode_parents: _____, ...keymap_without_rules } = keymap;
  const columns = site_columns_for(keymap, addresses);
  const page_tree = normal_tree_for(keymap.modes.normal, columns);
  const site_values = frame_site_values_for(keymap, addresses[0], PAGE_REPLY_SITE_SETTINGS);
  const with_values = site_values ? { site_values } : {};
  const { tree } = page_tree;
  const with_modes = columns.modes && !page_tree.all_off ? { site_modes: site_modes_for(tree, columns.modes) } : {};
  const normal_modes = tree === undefined || tree === keymap.modes.normal ? keymap_without_rules.modes : { ...keymap_without_rules.modes, normal: tree };
  const modes = page_tree.all_off ? normal_modes : { ...normal_modes, ...page_mode_trees_for(keymap, columns, addresses[0]) };
  return { keymap: { ...keymap_without_rules, modes }, all_off: page_tree.all_off, ..."frees" in page_tree && { frees: page_tree.frees }, ...with_modes, ...with_values };
}

// A string, not the object: the structured clone of the whole tree cost the page about 11 ms, and `JSON.parse` of the string costs a few.
export const read_keymap_reply = async (storage: KeymapStorage, addresses: readonly (string | undefined)[], recording?: string, join?: () => Promise<JoinMode | undefined>, bar = false): Promise<string | undefined> => {
  const reply = await page_keymap_for(storage, addresses, recording, join, bar);
  return reply && JSON.stringify(reply);
};
