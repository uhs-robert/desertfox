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
  if (result.kind === "no_match") return { kind: "unbound" };
  // The cmdline keymap has no sequences, so a half match is a key to swallow.
  if (result.kind === "pending") {
    matcher.reset();
    return { kind: "effect", effect: { kind: "render" } };
  }
  const invocation = result.leaf.steps[0]?.invocation;
  return { kind: "effect", effect: invocation ? session.run(invocation.id, invocation.args) : { kind: "render" } };
}

export type TypedEdit = { insert: string } | { backspace: true };

// What a token that no binding took does to the text. The page types real keys itself, so this serves keys
// that arrived through the host: those typed while the page loaded and those sent after a click on the page.
export function typed_edit(token: string): TypedEdit | undefined {
  if (token === "<Space>") return { insert: " " };
  if (token === "<Backspace>") return { backspace: true };
  return [...token].length === 1 ? { insert: token } : undefined;
}
