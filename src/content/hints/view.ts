// Draws the labels in a closed shadow root and keeps them over their elements.

import { create_surface, SURFACE_DEFAULT_VARIABLES } from "../surface.ts";
import type { Found } from "./candidates.ts";

const MESSAGE_MS = 1500;

// Same mapping as the which-key panel: yellow secondary for the keys, blue accent for the frame.
// The defaults repeat the which-key ones, so a page that sets no `--oasisfox-*` variable still gets the oasis look.
export const STYLE = `
.oasisfox-hints {${SURFACE_DEFAULT_VARIABLES}
  --primary: var(--oasisfox-accent, #7fa3c9);
  --secondary: var(--oasisfox-secondary, #e6c87a);
  font: bold 12px/1 ui-monospace, monospace;
}
.oasisfox-hint {
  position: fixed; padding: 2px 4px; border-radius: 3px; text-transform: uppercase;
  background: var(--oasisfox-bg); color: var(--secondary); border: 1px solid var(--primary); box-shadow: 0 1px 3px #0008;
}
.oasisfox-hint b { color: color-mix(in srgb, var(--oasisfox-fg) 55%, var(--oasisfox-bg)); font-weight: inherit; }
.oasisfox-hint-message {
  position: fixed; left: 50%; bottom: 48px; transform: translateX(-50%); padding: 8px 12px;
  background: var(--oasisfox-bg); color: var(--oasisfox-fg); font: var(--oasisfox-font); border-radius: var(--oasisfox-radius);
}`;

// Where the element sits on the top page: its own box plus the box of every frame around it.
export function top_page_position(found: Found): { left: number; top: number } {
  const own = found.element.getBoundingClientRect();
  let left = own.left;
  let top = own.top;
  for (const frame of found.frames) {
    const box = frame.getBoundingClientRect();
    left += box.left + frame.clientLeft;
    top += box.top + frame.clientTop;
  }
  return { left, top };
}

type DrawnLabel = { found: Found; text: string; node: HTMLElement; typed_part: HTMLElement; rest_part: HTMLElement };

export function create_view() {
  const surface = create_surface("oasisfox-hints", STYLE);
  let drawn: DrawnLabel[] = [];
  let message_timer: ReturnType<typeof setTimeout> | undefined;

  const mount = () => document.documentElement.append(surface.host);

  // All reads first, then all writes, so the page lays out once.
  function reposition(): void {
    const positions = drawn.map((label) => top_page_position(label.found));
    drawn.forEach((label, index) => {
      const { left, top } = positions[index]!;
      label.node.style.left = `${Math.max(left, 0)}px`;
      label.node.style.top = `${Math.max(top, 0)}px`;
    });
  }

  return {
    show: (items: { found: Found; text: string }[]): void => {
      drawn = items.map(({ found, text }) => {
        const node = document.createElement("div");
        node.className = "oasisfox-hint";
        const typed_part = document.createElement("b");
        const rest_part = document.createElement("span");
        rest_part.textContent = text;
        node.append(typed_part, rest_part);
        return { found, text, node, typed_part, rest_part };
      });
      surface.text.append(...drawn.map((label) => label.node));
      mount();
      reposition();
    },
    reposition,
    // Labels that no longer start with the typed text hide. The typed part of the others dims.
    show_progress: (typed: string, still_possible: ReadonlySet<number>): void => {
      drawn.forEach((label, index) => {
        label.node.style.display = still_possible.has(index) ? "" : "none";
        label.typed_part.textContent = typed;
        label.rest_part.textContent = label.text.slice(typed.length);
      });
    },
    show_message: (message: string): void => {
      const note = document.createElement("div");
      note.className = "oasisfox-hint-message";
      note.textContent = message;
      surface.text.replaceChildren(note);
      mount();
      clearTimeout(message_timer);
      message_timer = setTimeout(() => surface.host.remove(), MESSAGE_MS);
    },
    // Leaves a message that is still showing.
    clear_labels: (): void => {
      for (const label of drawn) label.node.remove();
      drawn = [];
      if (surface.text.childElementCount === 0) surface.host.remove();
    },
  };
}

export type HintView = ReturnType<typeof create_view>;
