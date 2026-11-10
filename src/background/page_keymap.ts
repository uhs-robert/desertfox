// Answers a page's `read_keymap`: the stored keymap trimmed for the page's site rule, so the content script holds no rule logic.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, PageKeymap, SiteRule } from "../shared/prefix_tree.ts";
import { frees_of, prune_tree } from "../shared/keys/prune_tree.ts";
import { matches_any_address } from "../shared/match_pattern.ts";

type KeymapStorage = Pick<typeof browser.storage.local, "get">;

// The top frame matches on its own address only. `sender.tab.url` can still hold the previous page while the tab navigates, so only a subframe adds it: a frame of another site cannot read the tab's address itself.
export const rule_addresses_of = (sender: { frameId?: number | undefined; url?: string | undefined; tab?: { url?: string | undefined } | undefined }): (string | undefined)[] =>
  sender.frameId === 0 ? [sender.url] : [sender.url, sender.tab?.url];

// The first rule whose regex fits wins, for the page's key handling and for which-key alike.
export const site_rule_for = (keymap: CompiledKeymap | undefined, addresses: readonly (string | undefined)[]): SiteRule | undefined =>
  keymap?.site_rules?.find(({ regex }) => matches_any_address(regex, addresses));

export async function page_keymap_for(storage: KeymapStorage, addresses: readonly (string | undefined)[]): Promise<PageKeymap | undefined> {
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
export const read_keymap_reply = async (storage: KeymapStorage, addresses: readonly (string | undefined)[]): Promise<string | undefined> => {
  const reply = await page_keymap_for(storage, addresses);
  return reply && JSON.stringify(reply);
};
