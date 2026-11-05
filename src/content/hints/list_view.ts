// The headings panel: one row per heading in document order, indented by level, each with a hint label.
// It draws in its own closed shadow root and takes the same label typing as the hint labels, so the picker is shared.

import { LAYERS } from "../../shared/layers.ts";
import { create_surface, mount_surface } from "../surface.ts";
import { heading_level, rendered_text } from "./candidates.ts";
import type { Found } from "./candidates.ts";
import { STYLE as HINT_STYLE } from "./view.ts";

export const MAX_ROW_TEXT = 100;

// How far each key moves the panel, in panel heights.
export const PANEL_SCROLL_KEYS: Record<string, number> = { "<PageDown>": 1, "<PageUp>": -1, "<C-d>": 0.5, "<C-u>": -0.5 };

// While the headings load, a panel key waits like a label letter does, so it cannot scroll the page instead.
export const waits_for_panel = (filter: string, token: string): boolean => filter === "headings" && token in PANEL_SCROLL_KEYS;

export function row_of(element: Element): { level: number; text: string } {
  const text = rendered_text(element).replace(/\s+/g, " ");
  return { level: heading_level(element), text: text.length > MAX_ROW_TEXT ? `${text.slice(0, MAX_ROW_TEXT)}...` : text };
}

const INDENT_PX = 14;

// The panel scrolls inside its own height, so a long page cannot push rows off the screen. A row hidden by typing leaves the rest in place.
const STYLE = `${HINT_STYLE}
.oasisfox-headings {
  position: fixed; top: 10vh; left: 50%; transform: translateX(-50%); width: min(640px, 90vw); max-height: 80vh; overflow-y: auto; box-sizing: border-box; padding: 6px;
  background: var(--oasisfox-bg-core, #0c0e13); color: var(--oasisfox-fg-core, #f5f5dc); border: 1px solid var(--primary); border-radius: var(--oasisfox-radius, 6px); box-shadow: 0 4px 16px #000a;
  font: var(--oasisfox-font, 14px system-ui, sans-serif);
}
.oasisfox-heading-row { display: flex; gap: 8px; align-items: baseline; padding: 3px 4px; white-space: nowrap; }
.oasisfox-heading-row .oasisfox-heading-label { flex: none; min-width: 2ch; text-transform: uppercase; font: bold 12px/1 ui-monospace, monospace; color: var(--secondary); }
.oasisfox-heading-label b { color: var(--oasisfox-fg-comment, #69809d); font-weight: inherit; }
.oasisfox-heading-text { overflow: hidden; text-overflow: ellipsis; }`;

type Row = { node: HTMLElement; typed_part: HTMLElement; rest_part: HTMLElement; text: string };

export function create_list_view() {
  const surface = create_surface("oasisfox-hints", STYLE, LAYERS.hints);
  let rows: Row[] = [];

  return {
    show: (items: { found: Found; text: string }[]): void => {
      const panel = document.createElement("div");
      panel.className = "oasisfox-headings";
      rows = items.map(({ found, text }) => {
        const { level, text: heading_text } = row_of(found.element);
        const node = document.createElement("div");
        node.className = "oasisfox-heading-row";
        node.style.paddingLeft = `${4 + (level - 1) * INDENT_PX}px`;
        const label = document.createElement("span");
        label.className = "oasisfox-heading-label";
        const typed_part = document.createElement("b");
        const rest_part = document.createElement("span");
        rest_part.textContent = text;
        label.append(typed_part, rest_part);
        const title = document.createElement("span");
        title.className = "oasisfox-heading-text";
        title.textContent = heading_text;
        node.append(label, title);
        return { node, typed_part, rest_part, text };
      });
      panel.append(...rows.map((row) => row.node));
      surface.text.append(panel);
      mount_surface(surface.host);
    },
    // Rows that no longer start with the typed text hide, as hint labels do.
    show_progress: (typed: string, still_possible: ReadonlySet<number>): void => {
      rows.forEach((row, index) => {
        row.node.style.display = still_possible.has(index) ? "" : "none";
        row.typed_part.textContent = typed;
        row.rest_part.textContent = row.text.slice(typed.length);
      });
    },
    // A fraction of the panel's height, down when positive. The rows below the edge are otherwise out of reach for the keyboard.
    scroll_by: (panel_heights: number): void => {
      const panel = surface.text.firstElementChild;
      if (panel) panel.scrollTop += panel_heights * panel.clientHeight;
    },
    // The panel does not sit over the headings, so scrolling or resizing the page leaves it as it is.
    reposition: (): void => {},
    clear_labels: (): void => {
      surface.host.remove();
      rows = [];
    },
  };
}
