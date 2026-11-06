// The typing side of hints: which keys count, what has been typed, when a label is complete. Pure, so it needs no page.

import { is_chord } from "../../shared/keys/token.ts";
import { narrow } from "./labels.ts";

export type Typed = { typed: string; still_possible: number[] };

export type KeyOutcome =
  | { kind: "pass" }
  // The key was taken. `picked` is the index of a completed label.
  | { kind: "handled"; typed: string; still_possible: number[]; picked?: number };

export function create_picker(labels: readonly string[]) {
  let typed = "";
  return {
    typed: () => typed,
    // A letter that continues no label is taken and dropped, so a slip does not leak into the page.
    on_token: (token: string): KeyOutcome => {
      if (is_chord(token)) return { kind: "pass" };
      if (token === "<Backspace>") {
        typed = typed.slice(0, -1);
        return { kind: "handled", typed, still_possible: narrow(labels, typed).still_possible };
      }
      if (token.length !== 1) return { kind: "pass" };
      const next = typed + token.toLowerCase();
      const { still_possible, complete } = narrow(labels, next);
      if (still_possible.length === 0) return { kind: "handled", typed, still_possible: narrow(labels, typed).still_possible };
      typed = next;
      return { kind: "handled", typed, still_possible, ...(complete === undefined ? {} : { picked: complete }) };
    },
  };
}
