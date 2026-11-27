// Walks the compiled prefix tree one key token at a time. Ships in the content script.

import { ANY_KEY } from "../prefix_tree.ts";
import type { CompiledKeymap, LeafStep, TreeBranch, TreeLeaf } from "../prefix_tree.ts";
import { REGISTER_KEY } from "../register_names.ts";

export type MatchResult =
  // `held_` is the typed prefix of the group a hold keeps open, and then the walk stays in that group.
  | { kind_: "match"; leaf: TreeLeaf; count?: number; held_?: string[]; keys?: string[] }
  // `register_keys_` is `"` while the register name is awaited and `"a` once it is typed. It sits beside `typed` and not in it, so a count can follow it.
  | { kind_: "pending"; node: TreeBranch; typed_: string[]; count?: number; register_keys_?: string; keys: string[]; held_?: string[] }
  // `ended_` is a Space that ended a hold: the key is spent, so it neither retries as a first key nor reaches the page.
  | { kind_: "no_match"; ended_?: true };

const MAX_COUNT_DIGITS = 6;

// Only the modes that move through the page have counts, and all of them but media and item have registers. In the others a digit or `"` is just a key. Media and item capture only their listed keys, so an unbound `"` reaches the page.
export const COUNT_MODES: readonly string[] = ["normal", "caret", "visual", "visual_line", "media", "item", "item_visual"];

// `frees` names the keys a site rule hands to the page. While no sequence is under way, such a key matches nothing and is no count digit.
export function create_matcher(keymap: CompiledKeymap, frees?: (token: string) => boolean) {
  let walk_mode = "";
  let node: TreeBranch | undefined;
  let typed: string[] = [];
  let count_digits = "";
  let register_keys_ = "";
  // Every key of the sequence under way, in the order typed. The key flow types all but the last again on Backspace.
  let keys: string[] = [];
  // Space in a group opens a hold: each leaf of the group runs and the walk returns to the group, not to the root.
  let held: { node: TreeBranch; typed: string[]; keys: string[] } | undefined;

  const reset = () => {
    node = held = undefined;
    keys = typed = [];
    count_digits = register_keys_ = "";
  };

  // Whether the page gets this key whatever the tree says, so the key flow does not cancel it either.
  const passes_ = (mode: string, token: string): boolean => mode === "normal" && typed.length === 0 && count_digits + register_keys_ === "" && frees?.(token) === true;

  const walk = (mode: string, token: string): MatchResult => {
    if (mode !== walk_mode) {
      reset();
      walk_mode = mode;
    }
    const root = keymap.modes[mode as keyof CompiledKeymap["modes"]];
    if (!root) return { kind_: "no_match" };
    node ??= root;
    if (passes_(mode, token)) return reset(), { kind_: "no_match" };

    keys = [...keys, token];
    const progress = () => ({ ...(count_digits && { count: Number(count_digits) }), ...(register_keys_ && { register_keys_ }), keys });
    // `"` and a register name go before a command, and a count may stand on either side of them.
    const awaiting_name = register_keys_ === '"';
    if (awaiting_name || (token === '"' && !register_keys_ && mode !== "media" && mode !== "item" && mode !== "item_visual" && COUNT_MODES.includes(mode) && typed.length === 0 && !root.children[token])) {
      if (awaiting_name && !REGISTER_KEY.test(token)) return reset(), { kind_: "no_match" };
      register_keys_ += token;
      return { kind_: "pending", node: root, typed_: typed, ...progress() };
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
      return { kind_: "pending", node: root, typed_: typed, ...progress() };
    }

    // A branch with an `ANY_KEY` child waits for one printable key, and a space counts. Any other token breaks the sequence, as a stray key would.
    const typed_char = token === "<Space>" ? " " : token;
    // A branch that binds Space or takes any key as its argument keeps Space for itself. In a held group a second Space ends the hold.
    if (token === "<Space>" && typed.length > 0 && !count_digits && !register_keys_ && !node.children[token] && !node.children[ANY_KEY]) {
      if (held?.node === node) return reset(), { kind_: "no_match", ended_: true };
      held = { node, typed, keys };
      return { kind_: "pending", node, typed_: typed, keys, held_: typed };
    }
    const next = node.children[token] ?? ([...typed_char].length === 1 ? node.children[ANY_KEY] : undefined);
    const info = progress();
    if (!next) {
      reset();
      return { kind_: "no_match" };
    }
    if (next.kind === "leaf") {
      const kept = held;
      reset();
      const register = info.register_keys_?.[1];
      const fill = (step: LeafStep): LeafStep =>
        step.capture || (register && step.register)
          ? { ...step, invocation: { ...step.invocation, args: { ...step.invocation.args, ...(step.capture && { [step.capture]: typed_char }), ...(register && step.register && { register }) } } }
          : step;
      if (kept) ({ node, typed, keys } = held = kept);
      return { kind_: "match", leaf: { ...next, steps: next.steps.map(fill) }, ...info, ...(kept && { held_: kept.typed, keys: kept.keys }) };
    }
    node = next;
    typed = [...typed, token];
    return { kind_: "pending", node: next, typed_: typed, ...info, ...(held && { held_: held.typed }) };
  };

  // A key that breaks a half-typed sequence gets one more try as a first key, so Enter after a stray prefix key still submits.
  const feed = (mode: string, token: string): MatchResult => {
    const in_progress = typed.length > 0 || count_digits + register_keys_ !== "";
    const result = walk(mode, token);
    return result.kind_ === "no_match" && in_progress && !result.ended_ ? walk(mode, token) : result;
  };

  // Whether `token` binds after the keys in `ahead`: it adds a count digit or starts, continues or ends a binding. The walk is left as it was.
  // A completed binding in `ahead` can change the mode the later keys replay in, so every key after it counts as binding.
  const binds_after_ = (mode: string, ahead: readonly string[], token: string): boolean => {
    const saved = [walk_mode, node, typed, count_digits, register_keys_, keys, held] as const;
    let result: MatchResult = { kind_: "no_match" };
    for (const key of [...ahead, token]) {
      if (result.kind_ === "match") break;
      result = feed(mode, key);
    }
    [walk_mode, node, typed, count_digits, register_keys_, keys, held] = saved;
    return result.kind_ !== "no_match";
  };

  return { feed, reset, binds_after_, passes_ };
}
