// Walks the compiled prefix tree one key token at a time. Ships in the content script.

import { ANY_KEY } from "../prefix_tree.ts";
import type { CompiledKeymap, LeafStep, TreeBranch, TreeLeaf } from "../prefix_tree.ts";
import { REGISTER_KEY } from "../register_names.ts";

export type MatchResult =
  | { kind: "match"; leaf: TreeLeaf; count?: number }
  // `register_keys` is `"` while the register name is awaited and `"a` once it is typed. It sits beside `typed` and not in it, so a count can follow it.
  | { kind: "pending"; node: TreeBranch; typed: string[]; count?: number; register_keys?: string; keys: string[] }
  | { kind: "no_match" };

const MAX_COUNT_DIGITS = 6;

// Only the modes that move through the page have counts and registers. In the others a digit or `"` is just a key.
const COUNT_MODES = ["normal", "caret", "visual", "visual_line", "media"];

// `frees` names the keys a site rule hands to the page. While no sequence is under way, such a key matches nothing and is no count digit.
export function create_matcher(keymap: CompiledKeymap, frees?: (token: string) => boolean) {
  let walk_mode = "";
  let node: TreeBranch | undefined;
  let typed: string[] = [];
  let count_digits = "";
  let register_keys = "";
  // Every key of the sequence under way, in the order typed. The key flow types all but the last again on Backspace.
  let keys: string[] = [];

  const reset = () => {
    node = undefined;
    keys = typed = [];
    count_digits = register_keys = "";
  };

  // Whether the page gets this key whatever the tree says, so the key flow does not cancel it either.
  const passes_ = (mode: string, token: string): boolean => mode === "normal" && typed.length === 0 && count_digits + register_keys === "" && frees?.(token) === true;

  const walk = (mode: string, token: string): MatchResult => {
    if (mode !== walk_mode) {
      reset();
      walk_mode = mode;
    }
    const root = keymap.modes[mode as keyof CompiledKeymap["modes"]];
    if (!root) return { kind: "no_match" };
    node ??= root;
    if (passes_(mode, token)) return reset(), { kind: "no_match" };

    keys = [...keys, token];
    const progress = () => ({ ...(count_digits && { count: Number(count_digits) }), ...(register_keys && { register_keys }), keys });
    // `"` and a register name go before a command, and a count may stand on either side of them.
    const awaiting_name = register_keys === '"';
    if (awaiting_name || (token === '"' && !register_keys && COUNT_MODES.includes(mode) && typed.length === 0 && !root.children[token])) {
      if (awaiting_name && !REGISTER_KEY.test(token)) return reset(), { kind: "no_match" };
      register_keys += token;
      return { kind: "pending", node: root, typed, ...progress() };
    }

    const is_digit = /^[0-9]$/.test(token);
    const key_is_count_digit =
      COUNT_MODES.includes(mode) &&
      typed.length === 0 &&
      is_digit &&
      count_digits.length < MAX_COUNT_DIGITS &&
      (count_digits !== "" || (token !== "0" && !root.children[token]));
    if (key_is_count_digit) {
      count_digits += token;
      return { kind: "pending", node: root, typed, ...progress() };
    }

    // A branch with an `ANY_KEY` child waits for one printable key. Any other token breaks the sequence, as a stray key would.
    const next = node.children[token] ?? ([...token].length === 1 ? node.children[ANY_KEY] : undefined);
    const info = progress();
    if (!next) {
      reset();
      return { kind: "no_match" };
    }
    if (next.kind === "leaf") {
      reset();
      const register = info.register_keys?.[1];
      const fill = (step: LeafStep): LeafStep =>
        step.capture || (register && step.register)
          ? { ...step, invocation: { ...step.invocation, args: { ...step.invocation.args, ...(step.capture && { [step.capture]: token }), ...(register && step.register && { register }) } } }
          : step;
      return { kind: "match", leaf: { ...next, steps: next.steps.map(fill) }, ...info };
    }
    node = next;
    typed = [...typed, token];
    return { kind: "pending", node: next, typed, ...info };
  };

  // A key that breaks a half-typed sequence gets one more try as a first key, so Enter after a stray prefix key still submits.
  const feed = (mode: string, token: string): MatchResult => {
    const in_progress = typed.length > 0 || count_digits + register_keys !== "";
    const result = walk(mode, token);
    return result.kind === "no_match" && in_progress ? walk(mode, token) : result;
  };

  // Whether `token` binds after the keys in `ahead`: it adds a count digit or starts, continues or ends a binding. The walk is left as it was.
  // A completed binding in `ahead` can change the mode the later keys replay in, so every key after it counts as binding.
  const binds_after_ = (mode: string, ahead: readonly string[], token: string): boolean => {
    const saved = [walk_mode, node, typed, count_digits, register_keys, keys] as const;
    let result: MatchResult = { kind: "no_match" };
    for (const key of [...ahead, token]) {
      if (result.kind === "match") break;
      result = feed(mode, key);
    }
    [walk_mode, node, typed, count_digits, register_keys, keys] = saved;
    return result.kind !== "no_match";
  };

  return { feed, reset, binds_after_, passes_ };
}
