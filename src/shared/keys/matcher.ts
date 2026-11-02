// Walks the compiled prefix tree one key token at a time. Ships in the content script.

import type { CompiledKeymap, TreeBranch, TreeLeaf } from "../prefix_tree.ts";

export type MatchResult =
  | { kind: "match"; leaf: TreeLeaf; count?: number }
  | { kind: "pending"; node: TreeBranch; typed: string[]; count?: number }
  | { kind: "no_match" };

const MAX_COUNT_DIGITS = 6;

// Only the modes that move through the page have counts. In the others a digit is just a key.
const COUNT_MODES = ["normal", "caret", "visual"];

export function create_matcher(keymap: CompiledKeymap) {
  let walk_mode = "";
  let node: TreeBranch | undefined;
  let typed: string[] = [];
  let count_digits = "";

  const reset = () => {
    node = undefined;
    typed = [];
    count_digits = "";
  };

  const feed = (mode: string, token: string): MatchResult => {
    if (mode !== walk_mode) {
      reset();
      walk_mode = mode;
    }
    const root = keymap.modes[mode as keyof CompiledKeymap["modes"]];
    if (!root) return { kind: "no_match" };
    node ??= root;

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

  return { feed, reset };
}
