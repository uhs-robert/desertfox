// Answers a page's `read_keymap`: the stored keymap trimmed for the page's site rule, so the content script holds no rule logic.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import { ANY_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, PageKeymap, SiteRule, TreeBranch, TreeLeaf } from "../shared/prefix_tree.ts";
import { frees_of, prune_tree } from "../shared/keys/prune_tree.ts";
import { matches_any_address } from "../shared/match_pattern.ts";

type KeymapStorage = Pick<typeof browser.storage.local, "get">;

// The top frame matches on its own address only. `sender.tab.url` can still hold the previous page while the tab navigates, so only a subframe adds it: a frame of another site cannot read the tab's address itself.
export const rule_addresses_of = (sender: { frameId?: number | undefined; url?: string | undefined; tab?: { url?: string | undefined } | undefined }): (string | undefined)[] =>
  sender.frameId === 0 ? [sender.url] : [sender.url, sender.tab?.url];

// The first rule whose regex fits wins, for the page's key handling and for which-key alike.
export const site_rule_for = (keymap: CompiledKeymap | undefined, addresses: readonly (string | undefined)[]): SiteRule | undefined =>
  keymap?.site_rules?.find(({ regex }) => matches_any_address(regex, addresses));

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
export async function page_keymap_for(storage: KeymapStorage, addresses: readonly (string | undefined)[], recording?: string, insert = false): Promise<PageKeymap | undefined> {
  const trimmed = await trimmed_keymap_for(storage, addresses);
  const reply = trimmed && insert ? { ...trimmed, insert: true as const } : trimmed;
  if (!reply || recording === undefined) return reply;
  const normal = reply.keymap.modes.normal;
  return { ...reply, keymap: normal ? { ...reply.keymap, modes: { ...reply.keymap.modes, normal: with_stop_for_record(normal) } } : reply.keymap, recording };
}

async function trimmed_keymap_for(storage: KeymapStorage, addresses: readonly (string | undefined)[]): Promise<PageKeymap | undefined> {
  const stored = await storage.get(COMPILED_KEYMAP_STORAGE_KEY);
  const keymap = current_keymap(stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined);
  if (keymap === undefined) return undefined;
  const { site_rules: _, ...keymap_without_rules } = keymap;
  const rule = site_rule_for(keymap, addresses);
  if (rule === undefined) return { keymap: keymap_without_rules, all_off: false };
  if ("all_off" in rule) return { keymap: keymap_without_rules, all_off: true };
  return { keymap: { ...keymap_without_rules, modes: { ...keymap_without_rules.modes, normal: prune_tree(keymap_without_rules.modes.normal, rule) } }, all_off: false, frees: frees_of(rule) };
}

// A string, not the object: the structured clone of the whole tree cost the page about 11 ms, and `JSON.parse` of the string costs a few.
export const read_keymap_reply = async (storage: KeymapStorage, addresses: readonly (string | undefined)[], recording?: string, insert = false): Promise<string | undefined> => {
  const reply = await page_keymap_for(storage, addresses, recording, insert);
  return reply && JSON.stringify(reply);
};
