// The typing side of hints: which keys count, what has been typed, when a label is complete. Pure, so it needs no page.

import { is_chord } from "../../shared/keys/token.ts";
import { is_hint_char } from "./hint_keys.ts";
import { narrow } from "./labels.ts";
import { rank_items } from "./rank.ts";

export type Typed = { typed: string; still_possible_: number[] };

// The keys that switch, cycle, pick or rotate. Hint mode takes them besides the label characters.
const NAMED_KEYS = ["/", "<Tab>", "<S-Tab>", "<Enter>", "<Space>"];
export const is_text_key = (token: string): boolean => NAMED_KEYS.includes(token);

export type KeyOutcome =
  | { kind: "pass" }
  // Space in label mode: the view turns the stacking order of overlapping labels.
  | { kind: "rotate" }
  // The key was taken. `picked` is the index of a completed label, or of the hint that text mode picked.
  // `text` is set only in text mode: what was typed, and `active` the best match, the one Enter picks.
  | { kind: "handled"; typed: string; still_possible_: number[]; picked?: number; text?: string | undefined; active?: number | undefined };

// `texts` gives the text of each hint, by the index of its label. It is read when text mode needs it.
export function create_picker(labels: readonly string[], texts: () => readonly string[] = () => []) {
  let typed = "";
  // Undefined is label mode. Text mode keeps the matches best first and which of them is active.
  let text: string | undefined;
  let ranked: number[] = [];
  let active = 0;

  const rank = (query: string): number[] => rank_items(texts(), query).map((item) => item.index);

  const label_outcome = (picked?: number): KeyOutcome => ({ kind: "handled", typed, still_possible_: narrow(labels, typed).still_possible_, ...(picked === undefined ? {} : { picked }) });
  const text_outcome = (picked?: number): KeyOutcome => ({ kind: "handled", typed: "", still_possible_: ranked, text, active: ranked[active], ...(picked === undefined ? {} : { picked }) });

  function on_text_token(token: string, current: string): KeyOutcome {
    if (token === "<Backspace>") {
      if (current === "") {
        text = undefined;
        return label_outcome();
      }
      text = current.slice(0, -1);
      ranked = rank(text);
      active = 0;
      return text_outcome();
    }
    if (token === "<Tab>" || token === "<S-Tab>") {
      if (ranked.length > 0) active = (active + (token === "<Tab>" ? 1 : ranked.length - 1)) % ranked.length;
      return text_outcome();
    }
    if (token === "<Enter>") return text_outcome(ranked[active]);
    const char = token === "<Space>" ? " " : token;
    if (!is_hint_char(char)) return { kind: "pass" };
    const next = current + char;
    const matches = rank(next);
    // A key that matches nothing is taken and dropped, as in label mode.
    if (matches.length === 0) return text_outcome();
    text = next;
    ranked = matches;
    active = 0;
    // Only typed text picks the one match. Entering and leaving text mode never do, and a space alone is no text.
    return text_outcome(matches.length === 1 && next.trim() !== "" ? matches[0] : undefined);
  }

  function on_label_token(token: string): KeyOutcome {
    if (token === "/") {
      typed = "";
      text = "";
      ranked = rank("");
      active = 0;
      return text_outcome();
    }
    if (token === "<Space>") return { kind: "rotate" };
    // These mean nothing before text mode, and must not reach the page.
    if (token === "<Enter>" || token === "<Tab>" || token === "<S-Tab>") return label_outcome();
    if (token === "<Backspace>") {
      typed = typed.slice(0, -1);
      return label_outcome();
    }
    if (!is_hint_char(token)) return { kind: "pass" };
    const next = typed + token.toLowerCase();
    const { still_possible_, complete } = narrow(labels, next);
    // A letter that continues no label is taken and dropped, so a slip does not leak into the page.
    if (still_possible_.length === 0) return label_outcome();
    typed = next;
    return label_outcome(complete);
  }

  return {
    typed: () => typed,
    on_token_: (token: string): KeyOutcome => {
      if (is_chord(token)) return { kind: "pass" };
      return text === undefined ? on_label_token(token) : on_text_token(token, text);
    },
  };
}
