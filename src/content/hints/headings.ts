// The headings of the page for the `heading` command: which elements count, the list the command line shows, and the jump.
// The list is a snapshot, taken when the line first reads it and dropped when the line is done with it.

import { RuntimeRefusal } from "../../shared/command.ts";
import type { HeadingJump } from "../align_target.ts";
import type { HeadingItem } from "../../shared/messages.ts";
import { best_match } from "../../shared/score.ts";
import { collect, scroll_clips_in_page } from "./candidates.ts";
import { HEADINGS, is_heading, rendered_text } from "./heading_match.ts";
import type { Found } from "./candidates.ts";
import { boxes_with_fallback, clip_to } from "./visible.ts";
import type { PageProbe, Rect } from "./visible.ts";

const DEFAULT_HEADING_LEVEL = 2;
// Boxes thinner than this are the "visually hidden" trick (1px, clipped), made for screen readers only.
const MIN_BOX_SIDE = 2;

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
export function keep_present<T>(targets: readonly T[], probe: Pick<PageProbe<T>, "rects_of_" | "clips_of_"> & { is_hidden_: (target: T) => boolean }): T[] {
  const has_size = (rect: Rect) => rect.right - rect.left >= MIN_BOX_SIDE && rect.bottom - rect.top >= MIN_BOX_SIDE;
  return targets.filter((target) => {
    if (probe.is_hidden_(target)) return false;
    const clips = probe.clips_of_(target);
    return probe.rects_of_(target).some((rect) => has_size(clip_to(rect, clips)));
  });
}

export function keep_present_found(candidates: Found[]): Found[] {
  const own_rects = (element: Element) => Array.from(element.getClientRects());
  const children = (element: Element) => Array.from(element.children);
  const keep_present_elements = (elements: Element[]) =>
    new Set(
      keep_present(elements, {
        rects_of_: (element) => boxes_with_fallback(element, own_rects, children),
        clips_of_: scroll_clips_in_page,
        // `checkVisibility` also catches the content of a closed `<details>`, which Firefox still gives a box.
        is_hidden_: (element) => !element.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
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
  if (match.found === "none") throw new RuntimeRefusal(`No heading matches ${text}`);
  return (match.found === "one" ? match.item : match.first).index;
}

// `scrollIntoView` moves only the document of the element, so each frame that holds it scrolls to the top in turn, innermost first.
// It leaves focus, selection and the address alone, which a focus or a fragment would not.
// `inset` is the height of a fixed or sticky bar that covers the top of the view: the target ends just below it, not under it.
// The scroll margin makes `scrollIntoView` leave the room in any scroller, which `scrollBy` on the window does not do for a scrolling div.
// A bar that sticks only once the layout runs (or below the top edge) is missed by the first read, so `reread_inset` reads again after the jump and the jump repeats once for a taller bar.
export function scroll_to_top(element: Element, frames: readonly Element[], inset = 0, reread_inset: () => number = () => 0): void {
  const jump = (bar: number) => {
    const { style } = element as HTMLElement;
    const page_margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    const room = scroll_room(bar, page_margin, scroll_padding_above(element));
    const kept = style.scrollMarginTop;
    if (room !== page_margin) style.scrollMarginTop = `${room}px`;
    for (const target of [element, ...[...frames].reverse()]) target.scrollIntoView({ block: "start", behavior: "instant" });
    style.scrollMarginTop = kept;
  };
  jump(inset);
  const covering = reread_inset();
  if (covering > inset) jump(covering);
}

// The browser leaves margin plus the scroller's padding above the target. The page may set either for its own bar, so the room never drops below the page's margin and the padding counts toward the bar.
export const scroll_room = (bar: number, page_margin: number, padding: number): number => Math.max(bar - padding, page_margin);

// The first `scroll-padding-top` set on the target or above it: a close enough stand-in for the scroller, which `scrollIntoView` reads it from.
function scroll_padding_above(element: Element): number {
  for (let at: Element | null = element.parentElement; at; at = at.parentElement) {
    const padding = parseFloat(getComputedStyle(at).scrollPaddingTop);
    if (padding > 0) return padding;
  }
  return 0;
}

// A bar taller than this share of the view is a wall or an overlay, not a header, and the scroll stays as it is.
const MAX_INSET_SHARE = 1 / 3;

// The bottom edge of the fixed or sticky element at the top of the view, or 0. One point at the top edge finds it: the element under the point, or the ancestor that sticks.
export function covering_inset(hit: Element | null, position_of: (element: Element) => string, view_height: number): number {
  for (let element = hit; element; element = element.parentElement) {
    const position = position_of(element);
    if (position !== "fixed" && position !== "sticky") continue;
    const bottom = element.getBoundingClientRect().bottom;
    return bottom > 0 && bottom <= view_height * MAX_INSET_SHARE ? Math.ceil(bottom) : 0;
  }
  return 0;
}

export const top_inset = (): number => covering_inset(document.elementFromPoint(window.innerWidth / 2, 1), (element) => getComputedStyle(element).position, window.innerHeight);

type JumpSlot = { desertfox_heading_jump?: HeadingJump };
let clears_slot = false;

// The jump leaves the heading in the slot `scroll.align` reads (the page bundle, which cannot see this module). A focus or selection change after the jump
// empties the slot again, so the newest of the three wins. A focus change inside a frame goes unseen here, and the next jump replaces the slot.
function keep_for_align(element: Element, frames: readonly Element[]): void {
  const slot = window as unknown as JumpSlot;
  slot.desertfox_heading_jump = { element: new WeakRef(element), frames: frames.map((frame) => new WeakRef(frame)) };
  if (clears_slot) return;
  clears_slot = true;
  const clear = () => {
    delete (window as unknown as JumpSlot).desertfox_heading_jump;
  };
  document.addEventListener("focusin", clear, true);
  document.addEventListener("selectionchange", clear);
}

export type HeadingDirection = "next" | "prev" | "first" | "last" | "next_block" | "prev_block";

// The block set of `{` and `}`: headings plus the elements that hold running text.
const BLOCKS = `${HEADINGS}, p, pre, blockquote`;
const TEXT_BLOCKS = new Set(["p", "pre", "blockquote"]);
// A one-line caption or a stub like "Skip to content" is no stop.
const MIN_BLOCK_CHARS = 40;
// The page frame around the text. A `header` is the page banner unless an article, aside, main, nav or section holds it, so an article keeps its own title header.
const CHROME = "nav, footer, aside, form, dialog, header:not(:is(article, aside, main, nav, section) header), [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=search]";

// A blockquote that holds paragraphs counts once, as the blockquote, so a text block inside another one is no stop of its own.
export function is_block(element: Element): boolean {
  if (element.closest(CHROME)) return false;
  if (!TEXT_BLOCKS.has(element.localName)) return is_heading(element);
  if (element.parentElement?.closest("blockquote")) return false;
  return rendered_text(element).replace(/\s+/g, " ").length >= MIN_BLOCK_CHARS;
}

// A heading whose top is within this many pixels of the view top is the one the last jump put there, so the next move passes it.
const AT_TOP_SLACK = 1;

// `tops` are the heading tops in page order, relative to the view top. `from` is the index of the remembered heading, which the move steps from. Without it the move starts at the view top.
// A count that runs past the end stops on the last heading, and `undefined` means there is none in that direction.
// `first` and `last` are the ends of the page, whatever the view top or the remembered heading is, and take no count.
export function pick_heading_step(tops: readonly number[], direction: HeadingDirection, steps: number, from?: number): number | undefined {
  if (direction === "first" || direction === "last") return tops.length === 0 ? undefined : direction === "first" ? 0 : tops.length - 1;
  const first =
    from !== undefined
      ? direction === "next" ? from + 1 : from - 1
      : direction === "next" ? tops.findIndex((top) => top > AT_TOP_SLACK) : tops.findLastIndex((top) => top < -AT_TOP_SLACK);
  if (first < 0 || first >= tops.length) return undefined;
  const index = direction === "next" ? first + steps - 1 : first - steps + 1;
  return Math.min(Math.max(index, 0), tops.length - 1);
}

// `}` and `{` step the way `]h` and `[h` do, over a different set.
export const step_of = (direction: HeadingDirection): "next" | "prev" | "first" | "last" =>
  direction === "next_block" ? "next" : direction === "prev_block" ? "prev" : direction;

export const NO_HEADING: Record<HeadingDirection, string> = {
  next: "No next heading",
  prev: "No previous heading",
  first: "No headings",
  last: "No headings",
  next_block: "No next section",
  prev_block: "No previous section",
};

// The view-top rule alone gets stuck on a heading near the page end, which cannot scroll to the top, so it would be picked again and again.
// The last jump target is the start while it is still on screen. A weak reference, so a page can still drop the heading.
let last_heading: WeakRef<Element> | undefined;

// A heading in a frame is placed by the frames that hold it, so its top is counted from the top view.
const top_in_view = ({ element, frames }: Found): number => [element, ...frames].reduce((sum, target) => sum + target.getBoundingClientRect().top, 0);

// Returns the notice when there is no heading that way.
export function step_heading(direction: HeadingDirection, steps: number): string | undefined {
  const by_block = direction === "next_block" || direction === "prev_block";
  const found = keep_present_found(collect(document, by_block ? { selector: BLOCKS, test: is_block } : { selector: HEADINGS, test: is_heading }));
  if (found.length === 0) return by_block ? "No sections" : NO_HEADING[direction];
  // The covering bar is the top line: a heading parked just below it counts as at the top, so the next press passes it.
  const inset = top_inset();
  const tops = found.map((item) => top_in_view(item) - inset);
  const remembered = last_heading?.deref();
  const at = remembered === undefined ? -1 : found.findIndex(({ element }) => element === remembered);
  const on_screen = at !== -1 && tops[at]! >= -AT_TOP_SLACK && tops[at]! < window.innerHeight;
  const index = pick_heading_step(tops, step_of(direction), steps, on_screen ? at : undefined);
  if (index === undefined) return NO_HEADING[direction];
  const { element, frames } = found[index]!;
  scroll_to_top(element, frames, inset, top_inset);
  keep_for_align(element, frames);
  last_heading = new WeakRef(element);
  return undefined;
}

export type Snapshot = { found: Found[]; rows: HeadingItem[] };

// The heading may have left the page since the list was read, with its frame or alone.
export function jump_in({ found, rows }: Snapshot, typed: string, inset = 0, reread_inset?: () => number): Found {
  const chosen = found[pick_heading(rows, typed)]!;
  if (!chosen.element.isConnected || !chosen.frames.every((frame) => frame.isConnected)) throw new RuntimeRefusal("That heading is gone");
  scroll_to_top(chosen.element, chosen.frames, inset, reread_inset);
  return chosen;
}

let snapshot: Snapshot | undefined;

export function take_snapshot(): Snapshot {
  const found = keep_present_found(collect(document, { selector: HEADINGS, test: is_heading }));
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
    const { element, frames } = jump_in(held ?? take_snapshot(), typed, top_inset(), top_inset);
    keep_for_align(element, frames);
  } finally {
    if (!held) clear_snapshot();
  }
}
