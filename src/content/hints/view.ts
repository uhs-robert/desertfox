// Draws the labels in a closed shadow root and keeps them over their elements.

import { LAYERS } from "../../shared/layers.ts";
import { create_surface, mount_surface } from "../surface.ts";
import type { Found } from "./candidates.ts";
import { anchor_box } from "./visible.ts";

const MESSAGE_MS = 1500;

// A filled label in the brand color. The 1px border keeps the box size of the older outlined label. Typed letters fade to half the text color.
// Defaults are var() fallbacks, never declarations: a declaration here would shadow a value the page or host sets.
export const STYLE = `
.desertfox-hints {
  --primary: var(--desertfox-primary, #7fa3c9);
  --label-text: var(--desertfox-bg-core, #0c0e13);
  font: bold 12px/1 ui-monospace, monospace;
}
.desertfox-hint {
  position: fixed; padding: 2px 4px; border-radius: 3px; text-transform: uppercase;
  background: var(--primary); color: var(--label-text); border: 1px solid var(--primary); box-shadow: 0 1px 3px #0008;
}
.desertfox-hint b { opacity: .6; font-weight: inherit; }
.desertfox-hint-message {
  position: fixed; left: 50%; bottom: 48px; transform: translateX(-50%); padding: 8px 12px;
  background: var(--desertfox-bg-core, #0c0e13); color: var(--desertfox-fg-core, #f5f5dc); font: var(--desertfox-font, 14px system-ui, sans-serif); border-radius: var(--desertfox-radius, 6px);
}`;

// Where the element sits on the top page: its anchor box plus the box of every frame around it. Undefined when the element has no box to anchor to.
export function top_page_position(found: Found): { left: number; top: number } | undefined {
  const own = anchor_box(
    found.element,
    (element) => element.getBoundingClientRect(),
    (element) => Array.from(element.getClientRects()),
    (element) => Array.from(element.children),
  );
  if (own === undefined) return undefined;
  let left = own.left;
  let top = own.top;
  for (const frame of found.frames) {
    const box = frame.getBoundingClientRect();
    left += box.left + frame.clientLeft;
    top += box.top + frame.clientTop;
  }
  return { left, top };
}

type LabelStyle = Pick<CSSStyleDeclaration, "display" | "visibility" | "left" | "top">;

// Two writers hide a label, each with its own property so neither undoes the other: typing a prefix owns `display`, a missing anchor box owns `visibility`.
export function filter_label(style: LabelStyle, matches: boolean): void {
  style.display = matches ? "" : "none";
}

export function place_label(style: LabelStyle, position: { left: number; top: number } | undefined): void {
  style.visibility = position === undefined ? "hidden" : "";
  if (position === undefined) return;
  style.left = `${Math.max(position.left, 0)}px`;
  style.top = `${Math.max(position.top, 0)}px`;
}

type DrawnLabel = { found: Found; text: string; node: HTMLElement; typed_part_: HTMLElement; rest_part_: HTMLElement };

export function create_view() {
  const surface = create_surface("desertfox-hints", STYLE, LAYERS.hints);
  let drawn: DrawnLabel[] = [];
  let message_timer: ReturnType<typeof setTimeout> | undefined;

  const mount = () => mount_surface(surface.host);

  // All reads first, then all writes, so the page lays out once.
  function reposition(): void {
    const positions = drawn.map((label) => top_page_position(label.found));
    drawn.forEach((label, index) => place_label(label.node.style, positions[index]));
  }

  return {
    show: (items: { found: Found; text: string }[]): void => {
      drawn = items.map(({ found, text }) => {
        const node = document.createElement("div");
        node.className = "desertfox-hint";
        const typed_part_ = document.createElement("b");
        const rest_part_ = document.createElement("span");
        rest_part_.textContent = text;
        node.append(typed_part_, rest_part_);
        return { found, text, node, typed_part_, rest_part_ };
      });
      surface.text.append(...drawn.map((label) => label.node));
      mount();
      reposition();
    },
    reposition,
    // Labels that no longer start with the typed text hide. The typed part of the others dims.
    show_progress_: (typed: string, still_possible: ReadonlySet<number>): void => {
      drawn.forEach((label, index) => {
        filter_label(label.node.style, still_possible.has(index));
        label.typed_part_.textContent = typed;
        label.rest_part_.textContent = label.text.slice(typed.length);
      });
    },
    show_message_: (message: string): void => {
      const note = document.createElement("div");
      note.className = "desertfox-hint-message";
      note.textContent = message;
      surface.text.replaceChildren(note);
      mount();
      clearTimeout(message_timer);
      message_timer = setTimeout(() => surface.host.remove(), MESSAGE_MS);
    },
    // Leaves a message that is still showing.
    clear_labels_: (): void => {
      for (const label of drawn) label.node.remove();
      drawn = [];
      if (surface.text.childElementCount === 0) surface.host.remove();
    },
  };
}

export type HintView = ReturnType<typeof create_view>;
