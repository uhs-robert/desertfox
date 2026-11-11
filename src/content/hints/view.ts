// Draws the labels in a closed shadow root and keeps them over their elements.

import { LAYERS } from "../../shared/layers.ts";
import { create_surface, mount_surface } from "../surface.ts";
import type { Found } from "./candidates.ts";
import { anchor_box } from "./visible.ts";
import { overlap_groups, rotate } from "./labels.ts";

const MESSAGE_MS = 1500;

// Hard-coded: the hints bundle does not see the keymap, and these keys are read as literals in pick.ts.
export const KEY_LINE_LABELS = "/: type text \u00b7 Space: turn labels";
export const KEY_LINE_TEXT = "Enter: pick \u00b7 Tab: next \u00b7 Backspace: labels";

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
.desertfox-hint-text {
  position: fixed; left: 50%; bottom: 48px; transform: translateX(-50%); padding: 4px 10px; border-radius: 3px; white-space: pre;
  background: var(--primary); color: var(--label-text); font: inherit;
}
.desertfox-hint-keys {
  position: fixed; right: 16px; bottom: 8px; padding: 4px 8px; pointer-events: none; white-space: pre;
  background: var(--desertfox-bg-core, #0c0e13); color: var(--desertfox-fg-core, #f5f5dc); font: var(--desertfox-font, 14px system-ui, sans-serif); border-radius: var(--desertfox-radius, 6px);
}
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

// The active hint swaps the label colors, so it stands out from the rest.
export function mark_active(style: Pick<CSSStyleDeclaration, "background" | "color">, active: boolean): void {
  style.background = active ? "var(--label-text)" : "";
  style.color = active ? "var(--primary)" : "";
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

  // The typed text, shown while text mode is on. Undefined means label mode and takes the box away.
  let text_box: HTMLElement | undefined;
  function show_text_mode(text: string | undefined): void {
    if (text === undefined) {
      text_box?.remove();
      text_box = undefined;
      return;
    }
    if (!text_box) {
      text_box = document.createElement("div");
      text_box.className = "desertfox-hint-text";
      surface.text.append(text_box);
    }
    text_box.textContent = `text: ${text}`;
  }

  // The key line sits where the mode badge is, which is hidden in hint mode. It outlives text mode, so it is not part of the text box. It goes first in the container so labels paint over it.
  let key_line: HTMLElement | undefined;
  function show_key_line(text: string | undefined): void {
    if (key_line === undefined) return;
    key_line.textContent = text === undefined ? KEY_LINE_LABELS : KEY_LINE_TEXT;
  }

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
    add_key_line_: (): void => {
      key_line = document.createElement("div");
      key_line.className = "desertfox-hint-keys";
      surface.text.prepend(key_line);
      show_key_line(undefined);
    },
    // Labels that no longer start with the typed text hide. The typed part of the others dims.
    show_progress_: (typed: string, still_possible: ReadonlySet<number>, text?: string, active?: number): void => {
      drawn.forEach((label, index) => {
        filter_label(label.node.style, still_possible.has(index));
        label.typed_part_.textContent = typed;
        label.rest_part_.textContent = label.text.slice(typed.length);
        mark_active(label.node.style, index === active);
      });
      show_text_mode(text);
      show_key_line(text);
    },
    // Turns the stacking order of every set of overlapping labels by one, so a covered label comes to the top. Overlaps are read again on each call, because scrolling changes them.
    rotate_overlaps_: (): void => {
      const shown = Array.from(surface.text.querySelectorAll<HTMLElement>(".desertfox-hint")).filter((node) => node.style.display !== "none" && node.style.visibility !== "hidden");
      const boxes = shown.map((node) => node.getBoundingClientRect());
      for (const group of overlap_groups(boxes)) {
        const stack = group.map((index) => shown[index]!);
        stack[0]!.before(rotate(stack)[0]!);
      }
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
      show_text_mode(undefined);
      key_line?.remove();
      key_line = undefined;
      if (surface.text.childElementCount === 0) surface.host.remove();
    },
  };
}

export type HintView = ReturnType<typeof create_view>;
