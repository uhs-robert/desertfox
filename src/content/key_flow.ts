// Decides, for one key token, whether the page keeps the key. Holds keys that
// arrive before the compiled keymap is read or while a bundle loads, and replays them in order once they can run.

import type { Mode, TreeBranch, TreeLeaf } from "../shared/index.ts";
import type { MatchResult } from "../shared/keys/index.ts";
import type { Sink } from "./bundle_host.ts";

export type KeyDecision = "cancel" | "pass";

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
};

const MAX_HELD_KEYS = 32;

// Chords carry Ctrl, Alt or Meta. Shift alone is a plain key (`J`, `<S-Escape>`).
const is_chord = (token: string) => /^<(?:[SCAM]-)*[CAM]-/.test(token);

export function create_key_flow(deps: KeyFlowDeps) {
  let matcher: Matcher | undefined;
  let browser_chords: TreeBranch | undefined;
  const held_tokens: string[] = [];
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

  const hold = (token: string): KeyDecision => {
    // Plain keys outside a field wait. Cancelling them keeps the page from acting twice on replay.
    if (is_chord(token) || deps.in_editable_field()) return "pass";
    if (held_tokens.length < MAX_HELD_KEYS) held_tokens.push(token);
    return "cancel";
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
      sequence_in_progress = false;
      replay();
    },
    release: replay,
  };
}
