// Answers a page's `read_keymap`: the stored keymap trimmed for the page's site table columns, so the content script holds no rule logic.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import { ANY_KEY } from "../shared/prefix_tree.ts";
import { HINT_SITE_SETTINGS, PAGE_REPLY_SITE_SETTINGS } from "../shared/prefix_tree.ts";
import { is_default_value } from "../shared/keys/compiler.ts";
import type { CompiledKeymap, FrameSiteName, FrameSiteValues, PageFrees, PageKeymap, SiteBind, TreeBranch, TreeLeaf, TreeNode } from "../shared/prefix_tree.ts";
import { DEFAULT_SETTINGS } from "../shared/default_settings.ts";
import { frees_of, is_empty_tree, prune_tree, type KeyRule } from "../shared/keys/prune_tree.ts";
import type { PerSiteName, Settings } from "../shared/settings_table.ts";
import { matches_any_address, resolve_site_columns, type ResolvedSiteColumns } from "../shared/match_pattern.ts";

type KeymapStorage = Pick<typeof browser.storage.local, "get">;

// The frame's own address comes first, so `frame_site_values_for` can take it alone. The top frame matches on its own address only. `sender.tab.url` can still hold the previous page while the tab navigates, so only a subframe adds it: a frame of another site cannot read the tab's address itself.
export const rule_addresses_of = (sender: { frameId?: number | undefined; url?: string | undefined; tab?: { url?: string | undefined } | undefined }): (string | undefined)[] =>
  sender.frameId === 0 ? [sender.url] : [sender.url, sender.tab?.url];

// A value about the whole tab, such as its zoom, follows the top page, so every frame resolves it against the top frame's address. A value about one frame's own content resolves against `[sender.url]`.
export const top_frame_address_of = (sender: { frameId?: number | undefined; url?: string | undefined; tab?: { url?: string | undefined } | undefined }): string | undefined =>
  sender.frameId === 0 ? sender.url : sender.tab?.url;

export type PageSiteColumns = ResolvedSiteColumns<KeyRule, SiteBind>;

// The page's columns of the site table, for the page's key handling and for which-key alike.
export const site_columns_for = (keymap: CompiledKeymap | undefined, addresses: readonly (string | undefined)[]): PageSiteColumns =>
  resolve_site_columns((keymap?.site_rules ?? []).filter(({ regex }) => matches_any_address(regex, addresses)));

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
  const stored = await storage.get(COMPILED_KEYMAP_STORAGE_KEY);
  const keymap = current_keymap(stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined);
  return (keymap && frame_site_values_for(keymap, frame_address, HINT_SITE_SETTINGS)) ?? {};
}

// A bound key replaces whatever the tree holds at that key. A key under a leaf of the tree turns the leaf into a branch, and a bind that is a prefix of tree keys replaces the whole subtree. Copies the path and never mutates the input.
export function graft_binds(root: TreeBranch | undefined, binds: Readonly<Record<string, SiteBind>>): TreeBranch {
  const grafted: TreeBranch = root ?? { kind: "branch", children: {} };
  const put = (branch: TreeBranch, tokens: readonly string[], leaf: TreeLeaf): TreeBranch => {
    const [token, ...rest] = tokens as [string, ...string[]];
    const below = branch.children[token];
    const child: TreeNode = rest.length === 0 ? leaf : put(below?.kind === "branch" ? below : { kind: "branch", children: {} }, rest, leaf);
    return { ...branch, children: { ...branch.children, [token]: child } };
  };
  // A bind that sits under another bind is dropped, as a complete binding hides the keys under it in a keymap. The compiler warns about the pair for rows of one site. Under a leaf of the tree itself a bind wins and the leaf becomes a branch.
  const all = Object.values(binds);
  const hidden = ({ tokens }: SiteBind) => all.some((other) => other.tokens.length < tokens.length && other.tokens.every((token, index) => tokens[index] === token));
  return all.filter((bind) => !hidden(bind)).reduce((tree, { tokens, leaf }) => put(tree, tokens, leaf), grafted);
}

// The normal tree under the page's columns. `off` wins over all of it. Binds go onto the tree first, then the key rule prunes, so `pass` frees a bound key and `only` keeps it. A page whose key rule leaves no normal binding is all off and keeps the whole tree, so `,i` can leave ignore mode.
export function normal_tree_for(normal: TreeBranch | undefined, columns: PageSiteColumns): { tree: TreeBranch | undefined; all_off: boolean } | { tree: TreeBranch; all_off: false; frees: PageFrees } {
  if (columns.off === true) return { tree: normal, all_off: true };
  const bound = columns.bind === undefined ? normal : graft_binds(normal, columns.bind);
  if (columns.keys === undefined) return { tree: bound, all_off: false };
  const pruned = prune_tree(bound, columns.keys);
  return is_empty_tree(pruned) ? { tree: normal, all_off: true } : { tree: pruned, all_off: false, frees: frees_of(columns.keys) };
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

// `recording` is the register a macro is being recorded into, or undefined.
export async function page_keymap_for(storage: KeymapStorage, addresses: readonly (string | undefined)[], recording?: string, join_insert?: () => Promise<boolean>): Promise<PageKeymap | undefined> {
  const trimmed = await trimmed_keymap_for(storage, addresses);
  const reply = trimmed && !trimmed.all_off && (await join_insert?.()) ? { ...trimmed, insert: true as const } : trimmed;
  if (!reply || recording === undefined) return reply;
  const normal = reply.keymap.modes.normal;
  return { ...reply, keymap: normal ? { ...reply.keymap, modes: { ...reply.keymap.modes, normal: with_stop_for_record(normal) } } : reply.keymap, recording };
}

async function trimmed_keymap_for(storage: KeymapStorage, addresses: readonly (string | undefined)[]): Promise<PageKeymap | undefined> {
  const stored = await storage.get(COMPILED_KEYMAP_STORAGE_KEY);
  const keymap = current_keymap(stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined);
  if (keymap === undefined) return undefined;
  const { site_rules: _, frame_site_globals: __, ...keymap_without_rules } = keymap;
  const page_tree = normal_tree_for(keymap.modes.normal, site_columns_for(keymap, addresses));
  const site_values = frame_site_values_for(keymap, addresses[0], PAGE_REPLY_SITE_SETTINGS);
  const with_values = site_values ? { site_values } : {};
  const { tree } = page_tree;
  const modes = tree === undefined || tree === keymap.modes.normal ? keymap_without_rules.modes : { ...keymap_without_rules.modes, normal: tree };
  return { keymap: { ...keymap_without_rules, modes }, all_off: page_tree.all_off, ..."frees" in page_tree && { frees: page_tree.frees }, ...with_values };
}

// A string, not the object: the structured clone of the whole tree cost the page about 11 ms, and `JSON.parse` of the string costs a few.
export const read_keymap_reply = async (storage: KeymapStorage, addresses: readonly (string | undefined)[], recording?: string, join_insert?: () => Promise<boolean>): Promise<string | undefined> => {
  const reply = await page_keymap_for(storage, addresses, recording, join_insert);
  return reply && JSON.stringify(reply);
};
