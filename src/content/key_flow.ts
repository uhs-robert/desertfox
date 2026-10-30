// Decides, for one key token, whether the page keeps the key. Holds keys that
// arrive before the compiled keymap is read, and replays them once it is.

import type { Mode, TreeLeaf } from "../shared/index.ts";
import type { MatchResult } from "../shared/keys/index.ts";

export type KeyDecision = "cancel" | "pass";

export type Matcher = { feed: (mode: string, token: string) => MatchResult; reset: () => void };

export type KeyFlowDeps = {
  get_mode: () => Mode;
  take_pass_next: () => boolean;
  run_leaf: (leaf: TreeLeaf, count: number | undefined) => void;
  leave_insert: () => void;
};

const MAX_HELD_KEYS = 32;

export function create_key_flow(deps: KeyFlowDeps) {
  let matcher: Matcher | undefined;
  let held_tokens: string[] = [];
  let sequence_in_progress = false;

  const step = (active: Matcher, token: string): KeyDecision => {
    const mode = deps.get_mode();
    const result = active.feed(mode, token);
    const was_in_progress = sequence_in_progress;
    sequence_in_progress = result.kind === "pending";
    if (result.kind === "match") {
      deps.run_leaf(result.leaf, result.count);
      return "cancel";
    }
    if (result.kind === "pending") return "cancel";
    if (mode === "insert" && token === "<Escape>") {
      deps.leave_insert();
      return "cancel";
    }
    // A key that breaks a half-typed sequence is part of that sequence, so the page does not get it.
    return was_in_progress ? "cancel" : "pass";
  };

  return {
    handle_token: (token: string): KeyDecision => {
      if (deps.take_pass_next()) {
        matcher?.reset();
        sequence_in_progress = false;
        return "pass";
      }
      if (!matcher) {
        if (held_tokens.length < MAX_HELD_KEYS) held_tokens.push(token);
        return "pass";
      }
      return step(matcher, token);
    },
    // The first call also replays the held keys. Later calls swap the keymap.
    set_matcher: (next: Matcher) => {
      matcher = next;
      sequence_in_progress = false;
      const replay = held_tokens;
      held_tokens = [];
      for (const token of replay) step(next, token);
    },
  };
}
