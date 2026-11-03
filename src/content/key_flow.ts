// Decides, for one key token, whether the page keeps the key. Holds keys that
// arrive before the compiled keymap is read or while a bundle loads, and replays them in order once they can run.

import type { Mode, TreeBranch, TreeLeaf } from "../shared/index.ts";
import type { MatchResult } from "../shared/keys/index.ts";
import type { Sink } from "./bundle_host.ts";

export type KeyDecision = "cancel" | "pass";

// The keys typed so far in a half-typed sequence. Which-key reads it.
export type PendingPrefix = { mode: Mode; typed: string[] };

export type Matcher = { feed: (mode: string, token: string) => MatchResult; reset: () => void };

export type KeyFlowDeps = {
  get_mode: () => Mode;
  take_pass_next: () => boolean;
  run_leaf: (leaf: TreeLeaf, count: number | undefined) => void;
  leave_insert: () => void;
  in_editable_field: () => boolean;
  // A bundle is loading, and the mode its keys replay in is not known yet.
  is_loading: () => boolean;
  sink_of: (mode: Mode) => Sink | undefined;
  // Called with the prefix after each key that leaves a sequence half-typed, and with nothing when the sequence ends or resets. `at_once` skips the pause before the panel.
  on_prefix: (prefix: PendingPrefix | undefined, at_once?: boolean) => void;
};

const MAX_HELD_KEYS = 32;

// Chords carry Ctrl, Alt or Meta. Shift alone is a plain key (`J`, `<S-Escape>`).
const is_chord = (token: string) => /^<(?:[SCAM]-)*[CAM]-/.test(token);

export function create_key_flow(deps: KeyFlowDeps) {
  let matcher: Matcher | undefined;
  let browser_chords: TreeBranch | undefined;
  const held_tokens: string[] = [];
  let sequence_in_progress = false;
  let typed: string[] = [];
  let count: number | undefined;

  const reset_sequence = () => {
    matcher?.reset();
    sequence_in_progress = false;
    deps.on_prefix(undefined);
  };

  // The `browser` chords also have a Firefox shortcut. Cancelling the key stops the shortcut from firing too.
  const run_browser_chord = (token: string): boolean => {
    const mode = deps.get_mode();
    const node = browser_chords?.children[token];
    if (node?.kind !== "leaf" || (mode !== "normal" && mode !== "insert")) return false;
    reset_sequence();
    deps.run_leaf(node, undefined);
    return true;
  };

  const hold = (token: string): KeyDecision => {
    // Plain keys outside a field wait. Cancelling them keeps the page from acting twice on replay.
    if (is_chord(token) || deps.in_editable_field()) return "pass";
    if (held_tokens.length < MAX_HELD_KEYS) held_tokens.push(token);
    return "cancel";
  };

  const step = (active: Matcher, token: string): KeyDecision => {
    const mode = deps.get_mode();
    const was_in_progress = sequence_in_progress;
    // Backspace drops the last key of a half-typed sequence. The matcher cannot step back, so the shorter prefix is typed again.
    if (was_in_progress && token === "<Backspace>") {
      const kept = typed.slice(0, -1);
      reset_sequence();
      // The count goes back in as its digits, ahead of the kept keys.
      for (const key of [...`${count ?? ""}`, ...kept]) step(active, key);
      deps.on_prefix(kept.length > 0 ? { mode, typed: kept } : undefined, true);
      return "cancel";
    }
    let result = active.feed(mode, token);
    // A key that breaks a half-typed sequence gets one more try as a first key.
    if (result.kind === "no_match" && was_in_progress) result = active.feed(mode, token);
    sequence_in_progress = result.kind === "pending";
    if (result.kind === "pending") ({ typed, count } = result);
    // A bare count (`3`) has typed nothing yet, so no keys can be listed.
    deps.on_prefix(result.kind === "pending" && result.typed.length > 0 ? { mode, typed: result.typed } : undefined);
    if (result.kind === "match") {
      deps.run_leaf(result.leaf, result.count);
      return "cancel";
    }
    if (result.kind === "pending") return "cancel";
    // The page sees this Escape too, so it can close its own dialog.
    if (mode === "insert" && token === "<Escape>") deps.leave_insert();
    return "pass";
  };

  const decide = (active: Matcher, token: string): KeyDecision => {
    // A sink takes the token before the keymap, and "pass" lets the keymap see it.
    if (deps.sink_of(deps.get_mode())?.on_token(token) === "handled") {
      reset_sequence();
      return "cancel";
    }
    return run_browser_chord(token) ? "cancel" : step(active, token);
  };

  // A replayed key can start another load, and the keys behind it wait for that load too.
  const replay = () => {
    while (matcher && held_tokens.length > 0 && !deps.is_loading()) decide(matcher, held_tokens.shift()!);
  };

  return {
    handle_token: (token: string): KeyDecision => {
      if (deps.take_pass_next()) {
        reset_sequence();
        return "pass";
      }
      if (!matcher || deps.is_loading()) return hold(token);
      return decide(matcher, token);
    },
    reset_sequence,
    // The first call also replays the held keys. Later calls swap the keymap.
    set_matcher: (next: Matcher, next_browser_chords?: TreeBranch) => {
      matcher = next;
      browser_chords = next_browser_chords;
      // A half-typed sequence of the old keymap means nothing in the new one, and neither does its panel.
      reset_sequence();
      replay();
    },
    release: replay,
  };
}
