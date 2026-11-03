// The state of one open command line, apart from the DOM: the text, the inline message and the history walk.
// A key from the keymap arrives as a command id and becomes an effect for the page to carry out.

import type { Invocation } from "../shared/invocation.ts";
import type { ParseResult } from "../shared/registry/index.ts";
import { create_history_cursor } from "./history_cursor.ts";

export type Effect =
  | { kind: "render" }
  | { kind: "close" }
  // The text parsed. `text` is what to put in the history.
  | { kind: "submit"; invocation: Invocation; text: string };

export type SessionDeps = {
  history: readonly string[];
  parse: (text: string) => ParseResult;
  // An error for a parsed command that cannot run yet, for example a required value left out. The line stays open.
  // Undefined when the command is fine. The pre-check must not touch the ticket, the port or `run`.
  precheck?: (invocation: Invocation) => string | undefined;
};

export function create_session(deps: SessionDeps) {
  const cursor = create_history_cursor(deps.history);
  let text = "";
  // Shown under the line: a parse error, a warning or a usage line. Any edit clears it.
  let message: string | undefined;

  const replace_text = (next: string) => {
    text = next;
    message = undefined;
  };

  const submit = (): Effect => {
    const line = text.replace(/^[\s:]+/, "").trim();
    if (line === "") return { kind: "close" };
    const parsed = deps.parse(line);
    if (parsed.kind === "error") {
      message = parsed.error;
      return { kind: "render" };
    }
    if (parsed.kind === "help") {
      message = parsed.usage;
      return { kind: "render" };
    }
    const problem = deps.precheck?.(parsed.invocation);
    if (problem !== undefined) {
      message = problem;
      return { kind: "render" };
    }
    return { kind: "submit", invocation: parsed.invocation, text: line };
  };

  const walk_history = (direction: unknown): Effect => {
    const next = direction === "next" ? cursor.next() : cursor.prev(text);
    if (next !== undefined) replace_text(next);
    return { kind: "render" };
  };

  return {
    get_text: () => text,
    get_message: () => message,
    // The user typed or the page inserted a key: the history walk starts over.
    edit: (next: string) => {
      replace_text(next);
      cursor.reset();
    },
    // `command_id` is a leaf of the `cmdline` keymap. Ids this piece does not own do nothing.
    run: (command_id: string, args: Record<string, unknown> | undefined): Effect => {
      switch (command_id) {
        case "cmdline.submit":
          return submit();
        case "cmdline.history":
          return walk_history(args?.direction);
        case "cmdline.clear":
          replace_text("");
          cursor.reset();
          return { kind: "render" };
        case "mode.escape":
          return { kind: "close" };
        default:
          return { kind: "render" };
      }
    },
  };
}

export type Session = ReturnType<typeof create_session>;
