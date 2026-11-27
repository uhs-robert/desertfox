// The page's keymap from a stored keymap: the site table's columns applied, the mode trees grafted and rewritten, then the held-mode join, the macro stop key and the status bar flag. The background answers `read_keymap` with it, and the locked page shim runs the same code on the keymap snapshot, so a page gets the same keys either way.

import { ANY_KEY, ITEM_SELECT_SITE_SETTINGS, PAGE_REPLY_SITE_SETTINGS } from "../prefix_tree.ts";
import type { CompiledKeymap, FrameSiteName, FrameSiteValues, PageKeymap, PageSiteMode, SiteBind, TreeBranch, TreeLeaf, TreeNode } from "../prefix_tree.ts";
import { DEFAULT_SETTINGS } from "../default_settings.ts";
import { is_default_value } from "../keys/compiler.ts";
import { resolve_mode_parents } from "../keys/mode_parents.ts";
import type { KeymapMode } from "../keymap.ts";
import type { SiteModeColumn } from "../match_pattern.ts";
import type { PerSiteName, Settings } from "../settings_table.ts";
import { with_item_select } from "./item_select_rewrite.ts";
import { graft_binds, normal_tree_for, site_columns_for } from "./site_columns.ts";
import type { PageSiteColumns } from "./site_columns.ts";

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

// While the browser module's status bar is up the page hides its own corner badge, which the reply says through the setting it already obeys, and reports what the bar shows.
const with_bar = (reply: PageKeymap, bar: boolean): PageKeymap => (bar ? { ...reply, keymap: { ...reply.keymap, mode_indicator: "off", bar: true } } : reply);

// Only the paths of `stopped` that end in the stop key, or undefined when it holds none.
const stop_paths_of = (stopped: TreeBranch): TreeBranch | undefined => {
  const children = Object.fromEntries(Object.entries(stopped.children).flatMap(([token, node]) => (node === STOP_LEAF ? [[token, node]] : node.kind === "branch" && stop_paths_of(node) ? [[token, stop_paths_of(node)!]] : [])));
  return Object.keys(children).length > 0 ? { kind: "branch", children } : undefined;
};

// The stop key of the normal tree, laid over the same place in a site mode's own tree: a mode bind on the record key would hide it, as it hides every key of the normal tree it shares. A mode leaf on a prefix of the record key gives way to a branch that holds the stop path alone, for as long as the macro records.
const with_stop_over = (mode_tree: Record<string, TreeNode>, stopped: TreeBranch): Record<string, TreeNode> =>
  Object.fromEntries(
    Object.entries(mode_tree).map(([token, node]) => {
      const over = stopped.children[token];
      if (over === STOP_LEAF) return [token, STOP_LEAF];
      if (over?.kind !== "branch") return [token, node];
      if (node.kind === "branch") return [token, { ...node, children: with_stop_over(node.children, over) }];
      return [token, stop_paths_of(over) ?? node];
    }),
  );

// `recording` is the register a macro is being recorded into, or undefined.
const with_recording = (reply: PageKeymap, recording: string): PageKeymap => {
  const normal = reply.keymap.modes.normal;
  const stopped = normal && with_stop_for_record(normal);
  // A mode tree meets the stop key too: a mode bind under the record key would otherwise hide it.
  const site_modes = reply.site_modes && Object.fromEntries(Object.entries(reply.site_modes).map(([name, mode]) => {
    const own = with_stop_for_record({ kind: "branch", children: mode.tree }).children;
    return [name, { ...mode, tree: stopped ? with_stop_over(own, stopped) : own }];
  }));
  return { ...reply, ...(site_modes && { site_modes }), keymap: stopped ? { ...reply.keymap, modes: { ...reply.keymap.modes, normal: stopped } } : reply.keymap, recording };
};

// The stored keymap trimmed for the page's addresses: the table's columns are resolved away, so the content script holds no rule logic. Undefined when no usable keymap is stored.
export function trimmed_keymap_of(keymap: CompiledKeymap | undefined, addresses: readonly (string | undefined)[]): PageKeymap | undefined {
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

export type PageState = { recording?: string | undefined; join?: PageKeymap["join"] | undefined; bar?: boolean | undefined };

// The bar flag, the join and the stop key go on in this order. A page that is off takes no join.
export function with_page_state(trimmed: PageKeymap | undefined, { recording, join, bar = false }: PageState): PageKeymap | undefined {
  if (!trimmed) return undefined;
  const barred = with_bar(trimmed, bar);
  const joined = join && !barred.all_off ? { ...barred, join } : barred;
  return recording === undefined ? joined : with_recording(joined, recording);
}

export const page_keymap_of = (keymap: CompiledKeymap | undefined, addresses: readonly (string | undefined)[], state: PageState = {}): PageKeymap | undefined => with_page_state(trimmed_keymap_of(keymap, addresses), state);
