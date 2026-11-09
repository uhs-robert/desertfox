// Decides, for one key token, whether the page keeps the key. Holds keys that
// arrive before the compiled keymap is read or while a bundle loads, and replays them in order once they can run.
// During a load only keys that can bind wait. Every other key reaches the page at once, because a replayed key arrives after its keydown was cancelled.

import type { Mode, TreeBranch, TreeLeaf } from "../shared/index.ts";
import type { MatchResult } from "../shared/keys/index.ts";
import type { BundleName } from "../shared/bundles.ts";
import { hint_mode_takes } from "./hints/hint_keys.ts";
import type { Sink } from "./bundle_host.ts";
import { is_caret_mode } from "../shared/command.ts";
import { is_chord } from "../shared/keys/token.ts";

export type KeyDecision = "cancel" | "pass";

// The keys typed so far in a half-typed sequence. Which-key reads it.
export type PendingPrefix = { mode: Mode; typed: string[] };

export type Matcher = {
  feed: (mode: string, token: string) => MatchResult;
  reset: () => void;
  binds_after_: (mode: string, ahead: readonly string[], token: string) => boolean;
};

export type KeyFlowDeps = {
  get_mode: () => Mode;
  take_pass_next_: () => boolean;
  // `repeat` is true for an auto-repeat keydown of a held key.
  run_leaf_: (leaf: TreeLeaf, count: number | undefined, repeat: boolean) => void;
  leave_insert_: () => void;
  in_editable_field_: () => boolean;
  // A bundle is loading, and the mode its keys replay in is not known yet.
  is_loading_: () => boolean;
  // The loading bundles that register a sink. Their mode may take keys on replay.
  loading_sink_bundles_: () => readonly BundleName[];
  sink_of_: (mode: Mode) => Sink | undefined;
  // Called with the prefix after each key that leaves a sequence half-typed, and with nothing when the sequence ends or resets. `at_once` skips the pause before the panel.
  on_prefix_: (prefix: PendingPrefix | undefined, at_once?: boolean) => void;
};

const MAX_HELD_KEYS = 32;

// Stands in the held keys for a key the page got while a sequence waited. It ends that sequence on replay, as the key would have. No binding uses it, so reading ahead through it ends the sequence too.
const SEQUENCE_BREAK = "";

// Insert and ignore mode give keys to the page, and hint and cmdline mode own theirs. Every other mode blocks Quick Find, so a new mode does too.
const MODES_WITHOUT_QUICK_FIND_BLOCK: readonly Mode[] = ["insert", "ignore", "hint", "cmdline"];

// What a caret mode never takes: focus moves, Firefox's function keys and the page scroll keys.
const CARET_PAGE_KEYS = /^<(?:S-)?(?:Tab|F\d+|PageUp|PageDown|Home|End)>$/;

// What a caret mode still lets through: those keys and the way out of a page dialog.
const KEYS_PAST_CARET_MODES = new RegExp(`${CARET_PAGE_KEYS.source}|^<(?:S-)?Escape>$`);

// Whether the mode a sink bundle serves may take the key once the bundle is in. Only such keys wait for the load. Cmdline takes every key.
const bundle_may_take = (bundle: BundleName, token: string): boolean =>
  bundle === "hints" ? hint_mode_takes(token) : bundle === "caret" ? !CARET_PAGE_KEYS.test(token) : true;

// Which unbound keys the page never sees. Firefox starts Quick Find on `/` and `'` in page content, beside DesertFox's own page search. A caret mode is for reading, so a site shortcut there moves the user away from the caret. In a field every key is typing, and a chord stays with Firefox and the page (Ctrl+C copies a selection).
export const cancels_unbound_key = (mode: Mode, token: string, in_field: boolean): boolean => {
  if (in_field || is_chord(token)) return false;
  if (is_caret_mode(mode)) return !KEYS_PAST_CARET_MODES.test(token);
  return (token === "/" || token === "'") && !MODES_WITHOUT_QUICK_FIND_BLOCK.includes(mode);
};

export function create_key_flow(deps: KeyFlowDeps) {
  let matcher: Matcher | undefined;
  let browser_chords: TreeBranch | undefined;
  const held_tokens: string[] = [];
  let sequence_in_progress = false;
  let typed: string[] = [];
  let count: number | undefined;

  const reset_sequence_ = () => {
    matcher?.reset();
    sequence_in_progress = false;
    deps.on_prefix_(undefined);
  };

  // The `browser` chords also have a Firefox shortcut. Cancelling the key stops the shortcut from firing too.
  const run_browser_chord = (token: string): boolean => {
    const mode = deps.get_mode();
    const node = browser_chords?.children[token];
    if (node?.kind !== "leaf" || (mode !== "normal" && mode !== "insert")) return false;
    reset_sequence_();
    deps.run_leaf_(node, undefined, false);
    return true;
  };

  const keep_held = (entry: string) => held_tokens.length < MAX_HELD_KEYS && held_tokens.push(entry);

  // The held keys are not fed yet, so the check reads ahead through them. It cannot read through Backspace, which edits the sequence, or an insert mode Escape, which leaves the mode on replay, so those keys and every key after them wait.
  const waits_for_replay = (active: Matcher, mode: Mode, token: string): boolean =>
    deps.loading_sink_bundles_().some((bundle) => bundle_may_take(bundle, token)) ||
    !!deps.sink_of_(mode) ||
    token === "<Backspace>" ||
    (mode === "insert" && token === "<Escape>") ||
    held_tokens.some((held) => held === "<Backspace>" || held === "<Escape>") ||
    active.binds_after_(mode, held_tokens, token);

  const hold = (token: string): KeyDecision => {
    // Chords and keys in a field never wait. A waiting key is cancelled, so the page does not act on it twice.
    if (is_chord(token) || deps.in_editable_field_()) return "pass";
    const mode = deps.get_mode();
    // Before the keymap is read nothing is known to bind, so every plain key waits.
    if (!matcher || waits_for_replay(matcher, mode, token)) {
      keep_held(token);
      return "cancel";
    }
    const last_held = held_tokens.at(-1);
    if (last_held === undefined) reset_sequence_();
    else if (last_held !== SEQUENCE_BREAK) keep_held(SEQUENCE_BREAK);
    return cancels_unbound_key(mode, token, false) ? "cancel" : "pass";
  };

  const step = (active: Matcher, token: string, repeat: boolean): KeyDecision => {
    const mode = deps.get_mode();
    const was_in_progress = sequence_in_progress;
    // Backspace drops the last key of a half-typed sequence. The matcher cannot step back, so the shorter prefix is typed again.
    if (was_in_progress && token === "<Backspace>") {
      const kept = typed.slice(0, -1);
      reset_sequence_();
      // The count goes back in as its digits, ahead of the kept keys.
      for (const key of [...`${count ?? ""}`, ...kept]) step(active, key, false);
      deps.on_prefix_(kept.length > 0 ? { mode, typed: kept } : undefined, true);
      return "cancel";
    }
    const result = active.feed(mode, token);
    sequence_in_progress = result.kind === "pending";
    if (result.kind === "pending") ({ typed, count } = result);
    // A bare count (`3`) has typed nothing yet, so no keys can be listed.
    deps.on_prefix_(result.kind === "pending" && result.typed.length > 0 ? { mode, typed: result.typed } : undefined);
    if (result.kind === "match") {
      deps.run_leaf_(result.leaf, result.count, repeat);
      return "cancel";
    }
    if (result.kind === "pending") return "cancel";
    // The page sees this Escape too, so it can close its own dialog.
    if (mode === "insert" && token === "<Escape>") deps.leave_insert_();
    return cancels_unbound_key(mode, token, deps.in_editable_field_()) ? "cancel" : "pass";
  };

  const decide = (active: Matcher, token: string, repeat: boolean): KeyDecision => {
    // A sink takes the token before the keymap, and "pass" lets the keymap see it.
    if (deps.sink_of_(deps.get_mode())?.on_token_(token) === "handled") {
      reset_sequence_();
      return "cancel";
    }
    return run_browser_chord(token) ? "cancel" : step(active, token, repeat);
  };

  // A replayed key can start another load, and the keys behind it wait for that load too.
  const replay = () => {
    while (matcher && held_tokens.length > 0 && !deps.is_loading_()) {
      const entry = held_tokens.shift()!;
      if (entry === SEQUENCE_BREAK) reset_sequence_();
      else decide(matcher, entry, false);
    }
  };

  return {
    handle_token_: (token: string, repeat = false): KeyDecision => {
      if (deps.take_pass_next_()) {
        reset_sequence_();
        return "pass";
      }
      if (!matcher || deps.is_loading_()) return hold(token);
      return decide(matcher, token, repeat);
    },
    reset_sequence_,
    // The first call also replays the held keys. Later calls swap the keymap.
    set_matcher_: (next: Matcher, next_browser_chords?: TreeBranch) => {
      matcher = next;
      browser_chords = next_browser_chords;
      // A half-typed sequence of the old keymap means nothing in the new one, and neither does its panel.
      reset_sequence_();
      replay();
    },
    release: replay,
  };
}
