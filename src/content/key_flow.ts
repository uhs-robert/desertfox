// Decides, for one key token, whether the page keeps the key. Holds keys that
// arrive before the compiled keymap is read, and replays them once it is.

import type { Mode, TreeBranch, TreeLeaf } from "../shared/index.ts";
import type { MatchResult } from "../shared/keys/index.ts";

export type KeyDecision = "cancel" | "pass";

export type Matcher = { feed: (mode: string, token: string) => MatchResult; reset: () => void };

export type KeyFlowDeps = {
  get_mode: () => Mode;
  take_pass_next: () => boolean;
  run_leaf: (leaf: TreeLeaf, count: number | undefined) => void;
  leave_insert: () => void;
  in_editable_field: () => boolean;
};

const MAX_HELD_KEYS = 32;

// Chords carry Ctrl, Alt or Meta. Shift alone is a plain key (`J`, `<S-Escape>`).
const is_chord = (token: string) => /^<(?:[SCAM]-)*[CAM]-/.test(token);

export function create_key_flow(deps: KeyFlowDeps) {
  let matcher: Matcher | undefined;
  let browser_chords: TreeBranch | undefined;
  let held_tokens: string[] = [];
  let sequence_in_progress = false;

  const reset_sequence = () => {
    matcher?.reset();
    sequence_in_progress = false;
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

  const step = (active: Matcher, token: string): KeyDecision => {
    const mode = deps.get_mode();
    const was_in_progress = sequence_in_progress;
    let result = active.feed(mode, token);
    // A key that breaks a half-typed sequence gets one more try as a first key.
    if (result.kind === "no_match" && was_in_progress) result = active.feed(mode, token);
    sequence_in_progress = result.kind === "pending";
    if (result.kind === "match") {
      deps.run_leaf(result.leaf, result.count);
      return "cancel";
    }
    if (result.kind === "pending") return "cancel";
    // The page sees this Escape too, so it can close its own dialog.
    if (mode === "insert" && token === "<Escape>") deps.leave_insert();
    return "pass";
  };

  return {
    handle_token: (token: string): KeyDecision => {
      if (deps.take_pass_next()) {
        reset_sequence();
        return "pass";
      }
      if (!matcher) {
        // Plain keys outside a field wait for the keymap. Cancelling them keeps the page from acting twice on replay.
        if (is_chord(token) || deps.in_editable_field()) return "pass";
        if (held_tokens.length < MAX_HELD_KEYS) held_tokens.push(token);
        return "cancel";
      }
      if (run_browser_chord(token)) return "cancel";
      return step(matcher, token);
    },
    reset_sequence,
    // The first call also replays the held keys. Later calls swap the keymap.
    set_matcher: (next: Matcher, next_browser_chords?: TreeBranch) => {
      matcher = next;
      browser_chords = next_browser_chords;
      sequence_in_progress = false;
      const replay = held_tokens;
      held_tokens = [];
      for (const token of replay) step(next, token);
    },
  };
}
