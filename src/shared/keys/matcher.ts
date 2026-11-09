// Walks the compiled prefix tree one key token at a time. Ships in the content script.

import type { CompiledKeymap, TreeBranch, TreeLeaf } from "../prefix_tree.ts";

export type MatchResult =
  | { kind: "match"; leaf: TreeLeaf; count?: number }
  | { kind: "pending"; node: TreeBranch; typed: string[]; count?: number }
  | { kind: "no_match" };

const MAX_COUNT_DIGITS = 6;

// Only the modes that move through the page have counts. In the others a digit is just a key.
const COUNT_MODES = ["normal", "caret", "visual", "visual_line"];

// `frees` names the keys a site rule hands to the page. While no sequence is under way, such a key matches nothing and is no count digit.
export function create_matcher(keymap: CompiledKeymap, frees?: (token: string) => boolean) {
  let walk_mode = "";
  let node: TreeBranch | undefined;
  let typed: string[] = [];
  let count_digits = "";

  const reset = () => {
    node = undefined;
    typed = [];
    count_digits = "";
  };

  // Whether the page gets this key whatever the tree says, so the key flow does not cancel it either.
  const passes_ = (mode: string, token: string): boolean => mode === "normal" && typed.length === 0 && count_digits === "" && frees?.(token) === true;

  const walk = (mode: string, token: string): MatchResult => {
    if (mode !== walk_mode) {
      reset();
      walk_mode = mode;
    }
    const root = keymap.modes[mode as keyof CompiledKeymap["modes"]];
    if (!root) return { kind: "no_match" };
    node ??= root;
    if (passes_(mode, token)) return reset(), { kind: "no_match" };

    const is_digit = /^[0-9]$/.test(token);
    const key_is_count_digit =
      COUNT_MODES.includes(mode) &&
      typed.length === 0 &&
      is_digit &&
      count_digits.length < MAX_COUNT_DIGITS &&
      (count_digits !== "" || (token !== "0" && !root.children[token]));
    if (key_is_count_digit) {
      count_digits += token;
      return { kind: "pending", node: root, typed, count: Number(count_digits) };
    }

    const next = node.children[token];
    const count = count_digits === "" ? {} : { count: Number(count_digits) };
    if (!next) {
      reset();
      return { kind: "no_match" };
    }
    if (next.kind === "leaf") {
      reset();
      return { kind: "match", leaf: next, ...count };
    }
    node = next;
    typed = [...typed, token];
    return { kind: "pending", node: next, typed, ...count };
  };

  // A key that breaks a half-typed sequence gets one more try as a first key, so Enter after a stray prefix key still submits.
  const feed = (mode: string, token: string): MatchResult => {
    const in_progress = typed.length > 0 || count_digits !== "";
    const result = walk(mode, token);
    return result.kind === "no_match" && in_progress ? walk(mode, token) : result;
  };

  // Whether `token` binds after the keys in `ahead`: it adds a count digit or starts, continues or ends a binding. The walk is left as it was.
  // A completed binding in `ahead` can change the mode the later keys replay in, so every key after it counts as binding.
  const binds_after_ = (mode: string, ahead: readonly string[], token: string): boolean => {
    const saved = [walk_mode, node, typed, count_digits] as const;
    let result: MatchResult = { kind: "no_match" };
    for (const key of [...ahead, token]) {
      if (result.kind === "match") break;
      result = feed(mode, key);
    }
    [walk_mode, node, typed, count_digits] = saved;
    return result.kind !== "no_match";
  };

  return { feed, reset, binds_after_, passes_ };
}
