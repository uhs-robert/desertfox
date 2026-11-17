export type ItemDirection = "down" | "up" | "left" | "right";
export type ItemArgs = { selector: string; link?: string; direction: ItemDirection; times?: number };
export type Box = { top: number; bottom: number; left: number; right: number };

// Where the move starts. `on_item` is false when no item holds the focus or was the last move, and `index` is then the first item not above the view, or the item count when all are above it.
export type Place = { index: number; on_item: boolean };

const middle = (low: number, high: number) => (low + high) / 2;

// Two boxes share a row when they overlap vertically by more than half the shorter one, so a justified grid with ragged tops still reads as rows.
const same_row = (a: Box, b: Box): boolean => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.bottom - a.top, b.bottom - b.top) / 2;

// One step to the nearest item ahead, by the distance along the direction plus an eighth of the distance across it. Down and up look at other rows only, left and right at the same row only.
export function step_from(boxes: readonly Box[], from: number, direction: ItemDirection): number | undefined {
  const here = boxes[from]!;
  const sideways = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  const along = (box: Box) => (sideways ? middle(box.left, box.right) : middle(box.top, box.bottom));
  const across = (box: Box) => (sideways ? middle(box.top, box.bottom) : middle(box.left, box.right));
  const cost = (index: number) => Math.abs(along(boxes[index]!) - along(here)) + Math.abs(across(boxes[index]!) - across(here)) / 8;
  const ahead = boxes.map((_, index) => index).filter((index) => sign * (along(boxes[index]!) - along(here)) > 0 && same_row(here, boxes[index]!) === sideways);
  return ahead.sort((a, b) => cost(a) - cost(b))[0];
}

export type ItemPick = { index: number } | { end: true };

// A count that runs past the last item stops on it. A first step with nowhere to go is the stop the user sees as a toast.
export function pick_item(boxes: readonly Box[], place: Place, direction: ItemDirection, steps: number): ItemPick {
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

// The item that holds the focus, else the last one moved to while it is on screen, else the first one not above the view.
export function place_of(items: readonly Element[], focused: Element | null, last: Element | undefined, boxes: readonly Box[], view_height: number): Place {
  const in_view = (index: number) => boxes[index]!.bottom > 0 && boxes[index]!.top < view_height;
  // A focus left behind off screen, after a scroll far away, gives way to the start rules.
  const found = focused ? items.findIndex((item) => item.contains(focused)) : -1;
  const holding = found !== -1 && in_view(found) ? found : -1;
  const remembered = items.indexOf(last as Element);
  const held = holding !== -1 || remembered === -1 || !in_view(remembered) ? holding : remembered;
  if (held !== -1) return { index: held, on_item: true };
  const first_in_view = boxes.findIndex((box) => box.bottom > 0);
  return { index: first_in_view === -1 ? boxes.length : first_in_view, on_item: false };
}

// What the handler needs from the page, so a test passes fakes.
export type ItemPage = {
  doc: Document;
  view: Window;
  focused: () => Element | null;
  toast: (message: string) => void;
  // The page scroll of the plain keys, for a page where no item matches.
  scroll_by: (dx: number, dy: number) => void;
  // Draws the box around the item.
  highlight: (item: Element) => void;
};

const SCROLL_PX = 50;
const SCROLL = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] } as const;

let last_item: WeakRef<Element> | undefined;

// A row that names a link and finds none in an item (a comment among stories) focuses the item itself. An item that is not focusable takes tabindex -1, so a script can focus it and the tab order stays as it was.
function focus_target(item: Element, link_selector: string | undefined): HTMLElement {
  const own = item as HTMLElement;
  const target = link_selector ? (item.querySelector<HTMLElement>(link_selector) ?? own) : own.tabIndex >= 0 ? own : (item.querySelector<HTMLElement>("a[href]") ?? own);
  if (target.tabIndex < 0) target.setAttribute("tabindex", "-1");
  return target;
}

export function move_item(page: ItemPage, args: ItemArgs): void {
  // A selector the browser cannot parse throws its own error, which the host reports as a failed command.
  // A box the browser hides or that has no size cannot be moved to.
  const items = Array.from(page.doc.querySelectorAll(args.selector)).filter((element) => element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && element.getClientRects().length > 0);
  const steps = args.times ?? 1;
  const scroll = () => page.scroll_by(...(SCROLL[args.direction].map((sign) => sign * SCROLL_PX * steps) as [number, number]));
  // A page the row covers but the selector does not fit (a text page, an image tab) keeps the scroll the key had before.
  if (items.length === 0) return scroll();
  const boxes = items.map((item) => item.getBoundingClientRect());
  const place = place_of(items, page.focused(), last_item?.deref(), boxes, page.view.innerHeight);
  const vertical = args.direction === "down" || args.direction === "up";
  // Down and up read a long item to its end before they leave it: they scroll while the item runs past the view edge in their direction.
  if (vertical && place.on_item && (args.direction === "down" ? boxes[place.index]!.bottom > page.view.innerHeight : boxes[place.index]!.top < 0)) return scroll();
  const pick = pick_item(boxes, place, args.direction, steps);
  // At the last item down and up scroll on, so the page below the results stays reachable. Left and right say they are at the end.
  if ("end" in pick) return vertical ? scroll() : page.toast(`No ${args.direction === "right" ? "next" : "previous"} item`);
  const item = items[pick.index]!;
  focus_target(item, args.link || undefined).focus({ preventScroll: true });
  const { top, left, bottom, right } = item.getBoundingClientRect();
  if (top < 0 || left < 0 || bottom > page.view.innerHeight || right > page.view.innerWidth) item.scrollIntoView({ block: bottom - top > page.view.innerHeight ? "start" : "center", inline: "nearest", behavior: "instant" });
  last_item = new WeakRef(item);
  page.highlight(item);
}
