// Draws a key sequence as one cap per key. Pages share it, so keys look the same on the help page and the new tab page.

import { parse_sequence } from "./keys/notation.ts";

// `gt`, `<Space> g t` and `<C-x>` give one cap per key. Spaces only separate words. A word the key notation refuses stays as one literal cap.
export function key_caps(text: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "desertfox-keycaps";
  const tokens = text.split(/\s+/).flatMap((word) => (word === "" ? [] : parse_sequence(word).tokens ?? [word]));
  for (const token of tokens) {
    const cap = document.createElement("kbd");
    cap.className = "desertfox-keycap";
    cap.textContent = token;
    wrap.append(cap);
  }
  return wrap;
}
