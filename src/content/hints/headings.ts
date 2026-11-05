// The headings of the page for the `heading` command: which elements count, the list the command line shows, and the jump.
// The list is a snapshot, taken when the line first reads it and dropped when the line is done with it.

import type { HeadingItem } from "../../shared/messages.ts";
import { best_match } from "../../shared/score.ts";
import { collect, scroll_clips_in_page } from "./candidates.ts";
import type { Found } from "./candidates.ts";
import { boxes_with_fallback, clip_to } from "./visible.ts";
import type { PageProbe, Rect } from "./visible.ts";

const HEADINGS = "h1, h2, h3, h4, h5, h6, [role=heading]";
const DEFAULT_HEADING_LEVEL = 2;
// Boxes thinner than this are the "visually hidden" trick (1px, clipped), made for screen readers only.
const MIN_BOX_SIDE = 2;

// The text a person reads: it leaves out hidden text and script text, which `textContent` would add. A fake element in a test has no `innerText`.
// A heading often keeps its text in a child span, so the test reads the rendered text and not the text nodes of the element.
export const rendered_text = (element: Element): string => ((element as HTMLElement).innerText ?? element.textContent ?? "").trim();

// The role wins over the tag, so `<h2 role=presentation>` and `<h2 role=button>` are no heading. An empty heading is no jump target.
export const is_heading = (element: Element): boolean => {
  const role = element.getAttribute("role")?.trim().split(/\s+/)[0]?.toLowerCase();
  return (role === undefined || role === "" || role === "heading") && rendered_text(element) !== "";
};

// aria-level wins over the tag. A role=heading with no usable level is level 2, the ARIA default.
export function heading_level(element: Element): number {
  const level = Number(element.getAttribute("aria-level"));
  if (Number.isInteger(level) && level >= 1 && level <= 6) return level;
  return /^h[1-6]$/.test(element.localName) ? Number(element.localName[1]) : DEFAULT_HEADING_LEVEL;
}

export function row_of(element: Element): HeadingItem {
  const text = rendered_text(element).replace(/\s+/g, " ");
  return { level: heading_level(element), text };
}

// The list shows off-screen headings, so it skips the viewport and cover tests of `keep_visible`.
// A heading stays when it has a box of real size that no scrolling ancestor clips away and the page does not hide, by `display`, `visibility` or a closed `<details>`.
export function keep_present<T>(targets: readonly T[], probe: Pick<PageProbe<T>, "rects_of" | "clips_of"> & { is_hidden: (target: T) => boolean }): T[] {
  const has_size = (rect: Rect) => rect.right - rect.left >= MIN_BOX_SIDE && rect.bottom - rect.top >= MIN_BOX_SIDE;
  return targets.filter((target) => {
    if (probe.is_hidden(target)) return false;
    const clips = probe.clips_of(target);
    return probe.rects_of(target).some((rect) => has_size(clip_to(rect, clips)));
  });
}

function keep_present_headings(candidates: Found[]): Found[] {
  const own_rects = (element: Element) => Array.from(element.getClientRects());
  const children = (element: Element) => Array.from(element.children);
  const keep_present_elements = (elements: Element[]) =>
    new Set(
      keep_present(elements, {
        rects_of: (element) => boxes_with_fallback(element, own_rects, children),
        clips_of: scroll_clips_in_page,
        // `checkVisibility` also catches the content of a closed `<details>`, which Firefox still gives a box.
        is_hidden: (element) => !element.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
      }),
    );
  // A heading in a hidden or clipped frame is as hidden as the frame, so each frame passes the same rules as the heading.
  const kept_frames = keep_present_elements([...new Set(candidates.flatMap((found) => found.frames))]);
  const kept_elements = keep_present_elements(candidates.map((found) => found.element));
  return candidates.filter((found) => kept_elements.has(found.element) && found.frames.every((frame) => kept_frames.has(frame)));
}

const NUMBER_PICK = /^(\d+)(?:\s+(.*))?$/s;

// `3 Install` is what a completion pick puts in the line: the heading at place 3 of the list, then its text. The number wins over the text,
// because the text may have changed since the pick. A number past the end of the list is part of the text, so "2024" finds a heading titled 2024.
// Other text is the best fuzzy match, the same ranking the list shows. An equal tie takes the one that comes first on the page.
export function pick_heading(rows: readonly HeadingItem[], typed: string): number {
  const text = typed.trim();
  const numbered = NUMBER_PICK.exec(text);
  if (numbered) {
    const place = Number(numbered[1]);
    if (place >= 1 && place <= rows.length) return place - 1;
  }
  const match = best_match(text, rows.map((row, index) => ({ row, index })), ({ row }) => ({ name: row.text, description: `h${row.level}` }));
  if (match.found === "none") throw new Error(`No heading matches ${text}`);
  return (match.found === "one" ? match.item : match.first).index;
}

// `scrollIntoView` moves only the document of the element, so each frame that holds it scrolls to the top in turn, innermost first.
// It leaves focus, selection and the address alone, which a focus or a fragment would not.
export function scroll_to_top(element: Element, frames: readonly Element[]): void {
  for (const target of [element, ...[...frames].reverse()]) target.scrollIntoView({ block: "start", behavior: "instant" });
}

export type Snapshot = { found: Found[]; rows: HeadingItem[] };

// The heading may have left the page since the list was read, with its frame or alone.
export function jump_in({ found, rows }: Snapshot, typed: string): void {
  const chosen = found[pick_heading(rows, typed)]!;
  if (!chosen.element.isConnected || !chosen.frames.every((frame) => frame.isConnected)) throw new Error("That heading is gone");
  scroll_to_top(chosen.element, chosen.frames);
}

let snapshot: Snapshot | undefined;

export function take_snapshot(): Snapshot {
  const found = keep_present_headings(collect(document, { selector: HEADINGS, test: is_heading }));
  snapshot = { found, rows: found.map(({ element }) => row_of(element)) };
  return snapshot;
}

// Holds no element after this, so a page can drop a heading.
export const clear_snapshot = (): void => {
  snapshot = undefined;
};

// Without a snapshot the line never read the list (the user typed the pick), so the page is read now and the read is dropped after the jump.
export function go_to_heading(typed: string): void {
  const held = snapshot;
  try {
    jump_in(held ?? take_snapshot(), typed);
  } finally {
    if (!held) clear_snapshot();
  }
}
