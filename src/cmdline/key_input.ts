// Turns one key token into a command line action. The keymap decides first, so a bound key never types.

import type { MatchResult } from "../shared/keys/index.ts";
import type { Effect, Session } from "./session.ts";

export type TokenMatcher = { feed: (mode: string, token: string) => MatchResult; reset: () => void };

export type KeyOutcome =
  | { kind: "effect"; effect: Effect }
  // No binding: the token is text, or a key the line ignores.
  | { kind: "unbound" };

export function run_token(matcher: TokenMatcher, session: Session, token: string): KeyOutcome {
  let result = matcher.feed("cmdline", token);
  // A token that ends a half-typed sequence starts over at the root, so Enter after a stray prefix key still submits.
  if (result.kind === "no_match") result = matcher.feed("cmdline", token);
  if (result.kind === "no_match") return { kind: "unbound" };
  // Swallowed, and the matcher stays on the sequence for the next token.
  if (result.kind === "pending") return { kind: "effect", effect: { kind: "render" } };
  const invocation = result.leaf.steps[0]?.invocation;
  return { kind: "effect", effect: invocation ? session.run(invocation.id, invocation.args) : { kind: "render" } };
}

// With no stored keymap the line still needs a way to run and a way out.
const KEYS_WITHOUT_KEYMAP: Record<string, string> = { "<Enter>": "cmdline.submit", "<Escape>": "mode.escape" };

export function run_token_without_keymap(session: Session, token: string): KeyOutcome {
  const command_id = KEYS_WITHOUT_KEYMAP[token];
  return command_id ? { kind: "effect", effect: session.run(command_id, undefined) } : { kind: "unbound" };
}

export type TypedEdit = { insert: string } | { backspace: true };

// What a token that no binding took does to the text. The page types real keys itself, so this serves keys
// that arrived through the host: those typed while the page loaded and those sent after a click on the page.
export function typed_edit(token: string): TypedEdit | undefined {
  if (token === "<Space>") return { insert: " " };
  if (token === "<Backspace>") return { backspace: true };
  return [...token].length === 1 ? { insert: token } : undefined;
}
