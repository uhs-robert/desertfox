import { is_shown } from "../shown.ts";
import { follow_end } from "./ends.ts";
import { thumbnail } from "./hover.ts";
import type { EndPage } from "./ends.ts";
import type { Outcome } from "../../shared/messages.ts";

export type MoveDirection = "down" | "up" | "left" | "right";
export type ItemDirection = MoveDirection | "first" | "last" | "current";
// With no selector (undefined, or the empty text the validator fills in) the items come from the derived row (`ItemPage.derived`).
export type ItemArgs = { selector?: string; link?: string; direction: ItemDirection; times?: number; hover?: boolean };
export type Box = { top: number; bottom: number; left: number; right: number };

// Where the move starts. `on_item` is false when no item holds the focus or was the last move, and `index` is then the first item not above the view, or the item count when all are above it.
export type Place = { index: number; on_item: boolean };

const middle = (low: number, high: number) => (low + high) / 2;

// Two boxes share a row when they overlap vertically by more than half the shorter one, so a justified grid with ragged tops still reads as rows.
const same_row = (a: Box, b: Box): boolean => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.bottom - a.top, b.bottom - b.top) / 2;

// One step to the nearest item ahead. Down and up look at other rows only, left and right at any item whose height overlaps. Items whose span across the direction overlaps the current item's come first, so a masonry tile goes to the tile in its own column and a left-aligned list of unequal widths goes to the next line. Among them the nearest one sets the row or column, which is every item that shares its extent along the direction. The one that overlaps the current item most across wins, and a tie goes to the nearer. With none overlapping, the smallest gap across stands in for the overlap.
export function step_from(boxes: readonly Box[], from: number, direction: MoveDirection): number | undefined {
  const here = boxes[from]!;
  const sideways = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  const extent = (box: Box, across: boolean): [number, number] => (sideways !== across ? [box.left, box.right] : [box.top, box.bottom]);
  const along = (box: Box) => middle(...extent(box, false));
  const overlap = (a: Box, b: Box, across: boolean) => Math.min(extent(a, across)[1], extent(b, across)[1]) - Math.max(extent(a, across)[0], extent(b, across)[0]);
  const along_gap = (index: number) => Math.abs(along(boxes[index]!) - along(here));
  const ahead = boxes.map((_, index) => index).filter((index) => sign * (along(boxes[index]!) - along(here)) > 0 && (sideways ? overlap(boxes[index]!, here, true) > 0 : !same_row(here, boxes[index]!)));
  const aligned = ahead.filter((index) => overlap(boxes[index]!, here, true) > 0);
  const pool = aligned.length > 0 ? aligned : ahead;
  const nearest = boxes[pool.sort((a, b) => along_gap(a) - along_gap(b))[0]!]!;
  // The row is the items that share the nearest one's extent along the direction, as same_row reads it for rows.
  const in_row = pool.filter((index) => overlap(boxes[index]!, nearest, false) > Math.min(...[boxes[index]!, nearest].map((box) => extent(box, false)[1] - extent(box, false)[0])) / 2);
  return in_row.sort((a, b) => overlap(boxes[b]!, here, true) - overlap(boxes[a]!, here, true) || along_gap(a) - along_gap(b))[0];
}

export type ItemPick = { index: number } | { end: true };

// A count that runs past the last item stops on it. A first step with nowhere to go is the stop the user sees as a toast.
export function pick_item(boxes: readonly Box[], place: Place, direction: MoveDirection, steps: number): ItemPick {
  // From no item, forward lands on the first one in view and backward on the one before it, as `page.focus_field` does.
  let index: number | undefined = place.on_item ? place.index : place.index - +(direction === "up" || direction === "left");
  if (!boxes[index]) return { end: true };
  for (let step = place.on_item ? 0 : 1; step < steps; step++) {
    const next = step_from(boxes, index, direction);
    if (next === undefined) return step === 0 ? { end: true } : { index };
    index = next;
  }
  return { index };
}

// The item that holds the focus, else the last one moved to while it is on screen (or pinned), else the first one not above the view.
export function place_of(items: readonly Element[], focused: Element | null, last: Element | undefined, boxes: readonly Box[], view_height: number, pinned = false): Place {
  const in_view = (index: number) => boxes[index]!.bottom > 0 && boxes[index]!.top < view_height;
  // A focus left behind off screen, after a scroll far away, gives way to the start rules.
  const found = focused ? items.findIndex((item) => item.contains(focused)) : -1;
  const holding = found !== -1 && in_view(found) ? found : -1;
  const remembered = items.indexOf(last as Element);
  const held = holding !== -1 || remembered === -1 || (!pinned && !in_view(remembered)) ? holding : remembered;
  if (held !== -1) return { index: held, on_item: true };
  const first_in_view = boxes.findIndex((box) => box.bottom > 0);
  return { index: first_in_view === -1 ? boxes.length : first_in_view, on_item: false };
}

// What the handler needs from the page, so a test passes fakes.
export type ItemPage = EndPage & {
  doc: Document;
  view: Window;
  focused: () => Element | null;
  toast: (message: string) => void;
  // The page scroll of the plain keys, for a page where no item matches.
  scroll_by: (dx: number, dy: number) => void;
  // Draws the box around the item, which follows the focus among the items the selector matches.
  highlight: (item: Element, selector: string, hover?: () => boolean) => void;
  // Whether the box still shows an item. The pin ends with the box, which clears when the user scrolls or moves the focus.
  box_shown: () => boolean;
  // The finder's row, read when a move has no selector: the shown items, the link of each that takes the focus, a selector for the box to follow a page script's focus by, a fresh read when the list grew past its end, and whether it is a grid.
  derived?: { items_: () => Element[]; link_of_: (item: Element) => Element | undefined; selector_: () => string; grew_: () => boolean; grid_: () => boolean };
};

const SCROLL_PX = 50;
const SCROLL = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] } as const;

// `pin_y_` is the page scroll an end landing (gg, G) on the page scroller left, so the item stays the start of the next move while the box still shows it at that scroll, even off screen. A list in its own panel keeps its end item in view and takes no pin.
let last_move: { item_: WeakRef<Element>; args_: ItemArgs; pin_y_: number | undefined } | undefined;

// The box followed a focus that a page script moved, so the next move and `]]` start from that item.
export const follow_item = (item: Element) => last_move && (last_move.item_ = new WeakRef(item));

// What `]]` reads of the last move, to carry the box onto the first item a load adds. `item_` is gone once the page dropped the item and nothing else holds it.
export type ItemCursor = { item_: Element | undefined; selector_: string; shown_: boolean; land_: (item: Element) => void };

export function read_cursor(page: ItemPage, shown_: boolean): ItemCursor | undefined {
  const args = last_move?.args_;
  // A move through the derived row has no selector to find the items again by, so `]]` leaves the box where it is.
  return args?.selector ? { item_: last_move!.item_.deref(), selector_: args.selector, shown_, land_: (item) => land_on(page, item, args) } : undefined;
}

// A row that names a link and finds none in an item (a comment among stories) focuses the item itself. An item that is not focusable takes tabindex -1, so a script can focus it and the tab order stays as it was.
function focus_target(item: Element, link_selector: string | undefined, found_link: Element | undefined): HTMLElement {
  const own = item as HTMLElement;
  const target = found_link ? (found_link as HTMLElement) : link_selector ? (item.querySelector<HTMLElement>(link_selector) ?? own) : own.tabIndex >= 0 ? own : (item.querySelector<HTMLElement>("a[href]") ?? own);
  if (target.tabIndex < 0) target.setAttribute("tabindex", "-1");
  return target;
}

// What the box follows a page script's focus by: the row's selector, or the derived row's.
const row_selector = (page: ItemPage, args: ItemArgs): string => args.selector || page.derived?.selector_() || "";

// A row that names its selector asks for the hover outright. The finder's items get it only while one holds a thumbnail, checked again when the wait ends, so a text result gets no hover card opened.
const hover_check = (args: ItemArgs, item: Element) => (args.hover ? () => !!args.selector || !!thumbnail(item) : undefined);

export function move_item(page: ItemPage, args: ItemArgs): void | Outcome | Promise<void> {
  // A selector the browser cannot parse throws its own error, which the host reports as a failed command.
  // A box the browser hides or that has no size cannot be moved to.
  const read_items = () => (args.selector ? Array.from(page.doc.querySelectorAll(args.selector)).filter(is_shown) : (page.derived?.items_() ?? []));
  const items = read_items();
  const { direction } = args;
  // The ends ignore the focus and the count. With no item they do nothing: the shipped rows guard them with `when_present`, so the plain keys run then. With no selector (the finder's gg and G) they refuse instead, and content.js scrolls to the top or bottom.
  // The finder's list can start screens below the top, so with no selector an end item off screen after the scroll takes no focus, no box and no pin: the next j starts from the view and does not jump back.
  // Only the first land reveals. The follow lands again on a row the page redrew, and a reveal then would drag a panel the user has scrolled since.
  let revealed = false;
  if (direction === "first" || direction === "last") {
    if (!args.selector && !items[0]) return { ok: false, message: "No item" };
    // Each poll of the follow asks first whether the page added something after the last item, so the answer kept for the first item does not hide it.
    const read_grown = () => (args.selector ? undefined : page.derived?.grew_(), read_items());
    return follow_end(page, read_grown, direction === "last", (item, on_page) => {
      const { top, bottom } = item.getBoundingClientRect();
      if (args.selector || (top < page.view.innerHeight && bottom > 0)) land_on(page, item, args, !on_page && !revealed, on_page);
      revealed = true;
    });
  }
  const boxes = items.map((item) => item.getBoundingClientRect());
  const place = place_of(items, page.focused(), last_move?.item_.deref(), boxes, page.view.innerHeight, last_move?.pin_y_ === page.view.scrollY && page.box_shown());
  // Current stays on the item the move would start from, or takes the first one in view, so a key sent next lands on an item and not on a toolbar button that holds the focus.
  if (direction === "current") return items.length === 0 ? undefined : land_on(page, items[Math.min(place.index, items.length - 1)]!, args);
  const steps = args.times ?? 1;
  const scroll = () => page.scroll_by(...(SCROLL[direction].map((sign) => sign * SCROLL_PX * steps) as [number, number]));
  // A page the row covers but the selector does not fit (a text page, an image tab) keeps the scroll the key had before.
  if (items.length === 0) return scroll();
  const vertical = direction === "down" || direction === "up";
  // The finder binds h and l on every page: off a grid they keep their sideways scroll.
  if (!args.selector && !vertical && !page.derived?.grid_()) return scroll();
  // The finder's list can start screens below: the first press lands only on an item in view. From no item the place is the first item not above the view.
  if (!args.selector && !place.on_item && !((boxes[place.index]?.top ?? Infinity) < page.view.innerHeight)) return scroll();
  // Down and up read a long item to its end before they leave it: they scroll while the item runs past the view edge in their direction. The box goes back on the item, since a focus move may have cleared it.
  const held = boxes[place.index];
  // A pinned item off screen has no end in view to read to.
  if (vertical && place.on_item && held!.bottom > 0 && held!.top < page.view.innerHeight && (direction === "down" ? held!.bottom > page.view.innerHeight : held!.top < 0)) {
    page.highlight(items[place.index]!, row_selector(page, args), hover_check(args, items[place.index]!));
    return scroll();
  }
  const pick = pick_item(boxes, place, direction, steps);
  if ("end" in pick && direction === "down" && !args.selector && page.derived?.grew_()) return move_item(page, args);
  // At the last item down and up scroll on, so the page below the results stays reachable. Left and right say they are at the end.
  if ("end" in pick) return vertical ? scroll() : page.toast(`No ${direction === "right" ? "next" : "previous"} item`);
  land_on(page, items[pick.index]!, args);
}

// Focuses the item, brings it into view (unless `reveal` is false) and draws the box. `]]` lands here too, on the first item a load added. The page-scroller ends skip the reveal so gg stays at the page top and G at the bottom, with the box on an item that may lie off screen.
function land_on(page: ItemPage, item: Element, args: ItemArgs, reveal = true, pin = false): void {
  focus_target(item, args.link || undefined, args.selector ? undefined : page.derived?.link_of_(item)).focus({ preventScroll: true });
  const { top, left, bottom, right } = item.getBoundingClientRect();
  if (reveal && (top < 0 || left < 0 || bottom > page.view.innerHeight || right > page.view.innerWidth)) item.scrollIntoView({ block: bottom - top > page.view.innerHeight ? "start" : "center", inline: "nearest", behavior: "instant" });
  last_move = { item_: new WeakRef(item), args_: args, pin_y_: pin ? page.view.scrollY : undefined };
  page.highlight(item, row_selector(page, args), hover_check(args, item));
}
