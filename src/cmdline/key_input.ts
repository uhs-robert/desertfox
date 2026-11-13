// Turns one key token into a command line action. The keymap decides first, so a bound key never types.

import type { MatchResult } from "../shared/keys/index.ts";
import type { Effect, Session } from "./session.ts";

export type TokenMatcher = { feed: (mode: string, token: string) => MatchResult; reset: () => void };

export type KeyOutcome =
  | { kind: "effect"; effect: Effect }
  // No binding: the token is text, or a key the line ignores.
  | { kind: "unbound" };

export function run_token(matcher: TokenMatcher, session: Session, token: string): KeyOutcome {
  const result = matcher.feed("cmdline", token);
  if (result.kind_ === "no_match") return { kind: "unbound" };
  // Swallowed, and the matcher stays on the sequence for the next token.
  if (result.kind_ === "pending") return { kind: "effect", effect: { kind: "render" } };
  return { kind: "effect", effect: run_steps(session, result.leaf.steps.map((step) => step.invocation)) };
}

// In order, like the normal key flow. A close or a submit ends the line, so the steps after it have nothing to act on.
function run_steps(session: Session, invocations: readonly { id: string; args?: Record<string, unknown> }[]): Effect {
  for (const invocation of invocations) {
    const effect = session.run(invocation.id, invocation.args);
    if (effect.kind !== "render") return effect;
  }
  return { kind: "render" };
}

// With no stored keymap the line still needs a way to run and a way out.
const KEYS_WITHOUT_KEYMAP: Record<string, string> = { "<Enter>": "cmdline.submit", "<Escape>": "mode.escape" };

export function run_token_without_keymap(session: Session, token: string): KeyOutcome {
  const command_id = KEYS_WITHOUT_KEYMAP[token];
  return command_id ? { kind: "effect", effect: session.run(command_id, undefined) } : { kind: "unbound" };
}

export type TextField = { text: string; start: number; end: number };

// What a token that no binding took does to the text. The page types real keys itself, so this serves keys
// that arrived through the host: those typed while the page loaded and those sent after a click on the page.
// It mirrors what the browser does in a text field for the keys a user types first. Other keys are dropped.
export function edit_forwarded(field: TextField, token: string): { text: string; caret: number } | undefined {
  const { text, start, end } = field;
  const has_selection = start !== end;
  const replace = (from: number, to: number, insert: string) => ({ text: text.slice(0, from) + insert + text.slice(to), caret: from + insert.length });
  const move = (caret: number) => ({ text, caret });
  switch (token) {
    case "<Space>":
      return replace(start, end, " ");
    case "<Backspace>":
      return has_selection ? replace(start, end, "") : replace(Math.max(0, start - 1), start, "");
    case "<Delete>":
      return has_selection ? replace(start, end, "") : replace(start, Math.min(text.length, start + 1), "");
    case "<ArrowLeft>":
      return move(has_selection ? start : Math.max(0, start - 1));
    case "<ArrowRight>":
      return move(has_selection ? end : Math.min(text.length, end + 1));
    case "<Home>":
      return move(0);
    case "<End>":
      return move(text.length);
    default:
      return [...token].length === 1 ? replace(start, end, token) : undefined;
  }
}
