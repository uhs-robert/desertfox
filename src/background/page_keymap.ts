// Answers a page's `read_keymap`: the stored keymap trimmed for the page's site table columns, so the content script holds no rule logic.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import { ANY_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, PageFrees, PageKeymap, TreeBranch, TreeLeaf } from "../shared/prefix_tree.ts";
import { frees_of, is_empty_tree, prune_tree, type KeyRule } from "../shared/keys/prune_tree.ts";
import { matches_any_address, resolve_site_columns, type ResolvedSiteColumns } from "../shared/match_pattern.ts";

type KeymapStorage = Pick<typeof browser.storage.local, "get">;

// The top frame matches on its own address only. `sender.tab.url` can still hold the previous page while the tab navigates, so only a subframe adds it: a frame of another site cannot read the tab's address itself.
export const rule_addresses_of = (sender: { frameId?: number | undefined; url?: string | undefined; tab?: { url?: string | undefined } | undefined }): (string | undefined)[] =>
  sender.frameId === 0 ? [sender.url] : [sender.url, sender.tab?.url];

// A value about the whole tab, such as its zoom, follows the top page, so every frame resolves it against the top frame's address. A value about one frame's own content resolves against `[sender.url]`.
export const top_frame_address_of = (sender: { frameId?: number | undefined; url?: string | undefined; tab?: { url?: string | undefined } | undefined }): string | undefined =>
  sender.frameId === 0 ? sender.url : sender.tab?.url;

export type PageSiteColumns = ResolvedSiteColumns<KeyRule>;

// The page's columns of the site table, for the page's key handling and for which-key alike.
export const site_columns_for = (keymap: CompiledKeymap | undefined, addresses: readonly (string | undefined)[]): PageSiteColumns =>
  resolve_site_columns((keymap?.site_rules ?? []).filter(({ regex }) => matches_any_address(regex, addresses)));

// A per-site setting on a page. The site's value beats the global value, which already holds `:set` and `:set --temp`: the row names the site and `:set` does not.
export const site_value = <Value>(columns: PageSiteColumns, name: string, global_value: Value): Value => (Object.hasOwn(columns.values, name) ? (columns.values[name] as Value) : global_value);

// The normal tree under the page's columns. An off page, or one whose key rule leaves no normal binding, is all off and keeps the whole tree, so `,i` can leave ignore mode.
export function normal_tree_for(normal: TreeBranch | undefined, columns: PageSiteColumns): { tree: TreeBranch | undefined; all_off: boolean; frees?: PageFrees } {
  if (columns.off === true || columns.keys === undefined) return { tree: normal, all_off: columns.off === true };
  const pruned = prune_tree(normal, columns.keys);
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
  const { site_rules: _, ...keymap_without_rules } = keymap;
  const { tree, all_off, frees } = normal_tree_for(keymap.modes.normal, site_columns_for(keymap, addresses));
  if (tree === undefined || tree === keymap.modes.normal) return { keymap: keymap_without_rules, all_off };
  return { keymap: { ...keymap_without_rules, modes: { ...keymap_without_rules.modes, normal: tree } }, all_off, ...(frees === undefined ? {} : { frees }) };
}

// A string, not the object: the structured clone of the whole tree cost the page about 11 ms, and `JSON.parse` of the string costs a few.
export const read_keymap_reply = async (storage: KeymapStorage, addresses: readonly (string | undefined)[], recording?: string, join_insert?: () => Promise<boolean>): Promise<string | undefined> => {
  const reply = await page_keymap_for(storage, addresses, recording, join_insert);
  return reply && JSON.stringify(reply);
};
