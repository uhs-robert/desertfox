// Finds the elements a hint filter can label. Visibility is decided later, in visible.ts.

import { shadow_root_of } from "../shadow.ts";
import { LAYER_ATTRIBUTE } from "../../shared/layers.ts";
import { is_scroll_box } from "../scroll_box.ts";
import { element_address, is_image_element, takes_typing } from "./actions.ts";
import { keep_visible, scroll_clips_of, viewport_size } from "./visible.ts";
import type { PageProbe, Rect } from "./visible.ts";

export type HintFilter = "all" | "every" | "clickable" | "buttons" | "inputs" | "links" | "prose" | "scrollable" | "draggable" | "swipeable" | "media" | "images" | "frames" | "custom";

const TEXT_FIELDS = 'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable=""], [contenteditable="true"]';
const LINKS = "a[href]";
const BUTTONS = ["button", '[role="button"]', ...["button", "submit", "reset", "image"].map((type) => `input[type="${type}"]`)].map((selector) => `${selector}:not([disabled])`).join(", ");
const CLICKABLE_BY_ACTION = `${LINKS}, button:not([disabled]), summary, [onclick], [role=button], [role=link], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], [role=checkbox], [role=switch], [role=option], [role=radio], label[for], ${TEXT_FIELDS}`;
const CLICKABLE = `${CLICKABLE_BY_ACTION}, [tabindex]:not([tabindex="-1"])`;
// A roving-tabindex widget keeps one item at tabindex 0 and the rest at -1, so -1 alone says nothing. A click-like role, or a place inside a menu, does.
const ROVING_ITEM = `${["button", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "option", "checkbox", "switch", "radio"].map((role) => `[tabindex="-1"][role=${role}]`).join(", ")}`;
// Menus built from plain lists carry no role. Their roving group still shows: one item at tabindex 0 and its siblings at -1.
const ROVING_GROUP = '[tabindex="0"] ~ [tabindex="-1"], [tabindex="-1"]:has(~ [tabindex="0"])';
const MENU_ITEM = `${ROVING_ITEM}, ${ROVING_GROUP}, :is([role=menu], [role=menubar], menu) [tabindex="-1"]:not(:is([role=menu], [role=menubar], [role=none], [role=presentation], [role=separator], [role=group]))`;
const ALL = `${CLICKABLE}, h1, h2, h3, h4, h5, h6, p, li, img, td, th, pre, code, blockquote`;


// What a filter labels: the elements that match the selector and pass the test, if there is one.
// The test holds what a selector cannot say, such as a fact about the content or the layout.
export type ElementTest = (element: Element) => boolean;
export type Query = { selector: string; test?: ElementTest };

// Tags whose text is code, markup data or form state, not prose a person reads. Any other tag counts, so custom elements and inline tags get hints.
export const NO_OWN_TEXT = new Set(["script", "style", "noscript", "template", "textarea", "option", "title", "meta", "link", "head", "svg", "math", "text", "tspan", "desc", "defs", "mi", "mn", "mo", "mtext", "annotation", "datalist", "optgroup", "select"]);

// A wrapper whose text sits in its children is no hit, so a card of spans gets a hint per span.
export const has_own_text = (element: Element): boolean => {
  if (NO_OWN_TEXT.has(element.localName) || (element as HTMLElement).hidden) return false;
  return Array.from(element.childNodes).some((node) => node.nodeType === 3 && (node.nodeValue ?? "").trim() !== "");
};

// A picture with a side under this is an icon, a spacer or a tracking pixel. Rendered size counts, because a lazy image has no natural size before it loads.
export const MIN_IMAGE_SIDE = 24;

const image_has_size = (element: Element): boolean => {
  const box = element.getBoundingClientRect();
  return box.width >= MIN_IMAGE_SIDE && box.height >= MIN_IMAGE_SIDE;
};

// An `img` (a `picture` always holds one), an image button, or a box with a CSS background image. Inline `svg` has no address, so it gets no label. The size check comes first, because it is cheaper than the style read every element would need.
export const is_image = (element: Element): boolean => {
  if (!image_has_size(element)) return false;
  if (is_image_element(element as HTMLElement)) return true;
  return window_of(element).getComputedStyle(element).backgroundImage.includes("url(");
};

const is_own_layer_frame = (element: Element): boolean => (element.getRootNode?.() as ShadowRoot | undefined)?.host?.hasAttribute?.(LAYER_ATTRIBUTE) === true;

// A frame of the page that is big enough to hold something. A frame from another site gets its label too: the pick focuses it from the outside.
export const is_pickable_frame = (element: Element): boolean => image_has_size(element) && !is_own_layer_frame(element);

// An element that is a target in itself keeps its hint when it wraps one child: a link, button, label or anything a role or handler makes actionable.
export const KEEPS_ONE_CHILD = `a, button, label, ${CLICKABLE_BY_ACTION}`;
// The page root and body cover the page and would take the first labels.
const PAGE_ROOTS = new Set(["html", "body"]);

// A box with no size or a pass-through wrapper adds nothing the child does not. The child count runs first because it is cheaper than a layout read.
export const is_every_target = (element: Element): boolean => {
  if (PAGE_ROOTS.has(element.localName)) return false;
  if (element.children.length === 1 && !has_own_text(element) && !element.matches(KEEPS_ONE_CHILD)) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
};

// What a drag moves. A plain link, image or button is out unless it sets draggable itself. The selector holds the explicit signs, the test adds the cursor a page sets on a widget it drags.
const DRAGGABLE = [
  '[draggable="true"]',
  "input[type=range]",
  "[role=slider]",
  "[role=scrollbar]",
  "[role=separator][aria-valuenow]",
  "[role=separator][tabindex]",
  "[aria-grabbed]",
  '[aria-roledescription~="sortable" i]',
  '[aria-roledescription~="draggable" i]',
  ".sortable-handle, .ui-sortable-handle, .ui-draggable, .drag-handle, .resize-handle, .gutter",
  "[data-rbd-drag-handle-draggable-id], [data-rfd-drag-handle-draggable-id], [data-dnd-draggable]",
].join(", ");
const DRAG_CURSORS = new Set(["grab", "grabbing", "move", ...["ew", "ns", "col", "row", "nwse", "nesw", "n", "s", "e", "w", "ne", "nw", "se", "sw"].map((direction) => `${direction}-resize`)]);

// The explicit signs skip the style read. Otherwise one read gives two signs: a drag cursor where it starts (it is inherited, so a child of a grab box does not count), and `touch-action: none`, which a pointer-driven widget sets so the browser leaves its drags alone. A widget with none of these signs and no role is reached with the `every` filter.
export const is_draggable = (element: Element): boolean => {
  if (PAGE_ROOTS.has(element.localName)) return false;
  if (element.matches(DRAGGABLE)) return true;
  const style_of = (target: Element) => window_of(target).getComputedStyle(target);
  const style = style_of(element);
  if (style.touchAction === "none") return true;
  if (!DRAG_CURSORS.has(style.cursor)) return false;
  const parent = element.parentElement;
  return parent === null || style_of(parent).cursor !== style.cursor;
};

// What a swipe moves: a carousel container by class, a scroll-snap box, or anything a drag moves.
const SWIPEABLE = ".swiper, .splide, .embla, .glide, .slick-list, .flickity-viewport";
export const is_swipeable = (element: Element): boolean => is_draggable(element) || (!PAGE_ROOTS.has(element.localName) && (element.matches(SWIPEABLE) || window_of(element).getComputedStyle(element).scrollSnapType !== "none"));

const QUERIES: Record<Exclude<HintFilter, "custom">, Query> = {
  all: { selector: ALL },
  every: { selector: "*", test: is_every_target },
  clickable: { selector: CLICKABLE },
  buttons: { selector: BUTTONS },
  inputs: { selector: TEXT_FIELDS },
  links: { selector: LINKS },
  prose: { selector: "*", test: has_own_text },
  draggable: { selector: "*", test: is_draggable },
  swipeable: { selector: "*", test: is_swipeable },
  media: { selector: "video, audio" },
  images: { selector: "*", test: is_image },
  frames: { selector: "iframe, frame", test: is_pickable_frame },
  scrollable: { selector: "*", test: (element) => !takes_typing(element as HTMLElement) && is_scroll_box(element) },
};

export const query_for = (filter: HintFilter, custom_selector: string | undefined): Query =>
  filter === "custom" ? { selector: custom_selector ?? "" } : QUERIES[filter];

// An element and the iframes that hold it, outermost first. The frames give its place on the top page.
// `weak` marks an element that only looks clickable (a pointer cursor, a spot in a menu), see `drop_redundant_weak`. `added` marks a match of a `hint_add` selector, which counts as clickable there.
export type Found = { element: Element; frames: Element[]; weak?: true; added?: true };

const MAX_FRAME_DEPTH = 4;

// A frame from another origin throws. The walk stops there, so a frame inside it gets no label from this page: focus the outer frame, then pick again.
function document_of_frame(frame: Element): Document | null {
  try {
    return (frame as HTMLIFrameElement).contentDocument;
  } catch {
    return null;
  }
}

const is_frame = (element: Element) => element.localName === "iframe" || element.localName === "frame";

// Matches the strong selector, or else the weak test, and records which one did.
export type WeakTest = (element: Element) => boolean;

// `only_in_view` reads each element's rect first. A box wholly outside its own window skips `matches`, the weak test and its frame, which clips its content. A shadow root is still entered, because fixed content in it can show, and so are the children, because a positioned child can reach into view.
export function collect(root: ParentNode, query: Query, is_weak?: WeakTest, only_in_view = false, frames: Element[] = [], found: Found[] = []): Found[] {
  if (query.selector === "") return found;
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const { width, height } = only_in_view ? viewport_size(doc, doc.defaultView ?? window) : { width: 0, height: 0 };
  for (const element of Array.from(root.querySelectorAll("*"))) {
    const off_screen = only_in_view && is_rect_off_screen(element.getBoundingClientRect(), width, height);
    if (!off_screen) {
      if (element.matches(query.selector) && (query.test?.(element) ?? true)) found.push({ element, frames });
      else if (is_weak?.(element)) found.push({ element, frames, weak: true });
    }
    const shadow = shadow_root_of(element);
    if (shadow) collect(shadow, query, is_weak, only_in_view, frames, found);
    if (!off_screen && is_frame(element) && frames.length < MAX_FRAME_DEPTH) {
      const inner = document_of_frame(element);
      if (inner) collect(inner, query, is_weak, only_in_view, [...frames, element], found);
    }
  }
  return found;
}

// The frame's `hint_add` and `hint_remove` settings, each list already checked to parse.
export type SiteSelectors = { add: string[]; remove: string[] };

// Only the filters that mean "anything to click" take added elements: a `links` or `images` label promises an address.
const TAKES_ADDED = new Set<HintFilter>(["all", "clickable", "every", "draggable"]);

// Added elements count as strong and skip the filter's test. A removed element is one inside a `hint_remove` match in its own tree: `closest` stops at a shadow root.
export function with_site_selectors(root: ParentNode, filter: HintFilter, found: Found[], { add, remove }: SiteSelectors, only_in_view = false): Found[] {
  const added = add.length > 0 && TAKES_ADDED.has(filter) ? collect(root, { selector: add.join(", ") }, undefined, only_in_view).map((item): Found => ({ ...item, added: true })) : [];
  const added_elements = new Set(added.map((item) => item.element));
  const merged = [...found.filter((item) => !added_elements.has(item.element)), ...added];
  if (remove.length === 0 || filter === "custom") return merged;
  const removed = remove.join(", ");
  return merged.filter((item) => item.element.closest(removed) === null);
}

// Page reads behind the weak test, so tests run on fake elements.
export type ClickStyles = { cursor_of_: (element: Element) => string; parent_of: (element: Element) => Element | null };

const NEVER_WEAK = new Set(["html", "body", "head", "script", "style", "option"]);

// A pointer cursor is inherited, so every child of a clickable card has it too. Except for `<a>`, only the element where it starts counts, which is one hint per card.
export function has_click_sign(element: Element, styles: ClickStyles): boolean {
  if (NEVER_WEAK.has(element.localName)) return false;
  if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
  if (styles.cursor_of_(element) !== "pointer") return false;
  // An `<a>` without href is a link whose click a script handles. An inherited pointer still counts: a menu list that sets it on the list must not hide one of its links.
  if (element.localName === "a") return true;
  const parent = styles.parent_of(element);
  return parent === null || styles.cursor_of_(parent) !== "pointer";
}

// An off-screen element never gets here: `collect` drops it before this test.
export const make_weak_test = (styles: ClickStyles): WeakTest => (element) => element.matches(MENU_ITEM) || has_click_sign(element, styles);

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

// An empty box on either axis (`display: none`, `display: contents`, a zero-height card with visible content) is not placed, so it stays a candidate for `keep_visible` to judge, as `has_area` does.
export const is_rect_off_screen = (rect: Box, view_width: number, view_height: number): boolean =>
  rect.width > 0 && rect.height > 0 && (rect.bottom < 0 || rect.right < 0 || rect.top > view_height || rect.left > view_width);

// Judged against the layout viewport of the element's own document, which a pinch zoom leaves alone, and a frame's element by the frame's.
export const is_element_off_screen = (element: Element): boolean => {
  const { width, height } = viewport_size(element.ownerDocument, window_of(element));
  return is_rect_off_screen(element.getBoundingClientRect(), width, height);
};

const dom_styles: ClickStyles = {
  cursor_of_: (element) => (element.ownerDocument.defaultView ?? window).getComputedStyle(element).cursor,
  parent_of: (element) => element.parentElement ?? (element.parentNode as ShadowRoot | null)?.host ?? null,
};

// Only the filters that mean "anything clickable" look for weak candidates. `links`, `buttons`, `inputs` and `custom` are exact.
export const weak_test_for = (filter: HintFilter): WeakTest | undefined => (filter === "clickable" || filter === "all" ? make_weak_test(dom_styles) : undefined);

type Climbable = { parentNode: unknown; host?: unknown };

// One hint per thing to click. A weak candidate gives way to a candidate inside it (the innermost wins) and to a strong candidate around it (that one gets the hint).
// Only a candidate of the clickable kind counts as that stronger one: with the `all` filter a plain `li` or `p` must not hide the link in it.
export function drop_redundant_weak(found: Found[]): Found[] {
  const weak = new Set<unknown>(found.filter((item) => item.weak).map((item) => item.element));
  if (weak.size === 0) return found;
  const clickable = found.filter((item) => item.weak || item.added || item.element.matches(CLICKABLE));
  // A container that is only focusable (an ARIA menu with tabindex 0) must not hide the items in it, so as an ancestor it needs a click sign.
  const strong = new Set<unknown>(clickable.filter((item) => !item.weak && (item.added || item.element.matches(CLICKABLE_BY_ACTION))).map((item) => item.element));
  const dropped = new Set<unknown>();
  for (const item of clickable) {
    const own_weak = item.weak === true;
    for (let up = (item.element as unknown as Climbable).parentNode as Climbable | null; up; up = (up.parentNode ?? up.host) as Climbable | null) {
      if (weak.has(up)) dropped.add(up);
      if (own_weak && strong.has(up)) dropped.add(item.element);
    }
  }
  return found.filter((item) => !dropped.has(item.element));
}

// No rect read follows a write, so the layout flushes once. A box outside its window cannot intersect it, so dropping it spares `keep_visible` the observer hop and the style reads. `collect` does this during the walk. The viewport scope of `copy.links` takes every link and calls this.
export const drop_off_screen = (found: Found[]): Found[] => found.filter((item) => !is_element_off_screen(item.element));

// Visibility comes first: a wrapper must not give way to a hidden or off-screen candidate that gets no hint.
export const keep_visible_deduplicated = (found: Found[], probe: PageProbe<Found>): Found[] => drop_redundant_weak(keep_visible(found, probe));

// The `text` param keeps the links whose text holds it.
export const keep_text_matches = (found: Found[], lower_needle: string): Found[] =>
  found.filter((item) => element_address(item.element as HTMLAnchorElement) !== undefined && has_text(item.element, lower_needle));

// The visible text holds the needle, ignoring case. The needle arrives already lower-cased.
// An empty innerText means the text is hidden, so only a missing innerText falls back to textContent.
export const has_text = (element: Element, lower_needle: string): boolean =>
  ((element as HTMLElement).innerText ?? element.textContent ?? "").toLowerCase().includes(lower_needle);

const TEXT_CHARS = 400;
const squeezed = (text: unknown): string => (typeof text === "string" ? text : "").replace(/\s+/g, " ").trim();

// What names an element, best first: its own text (the caller says which reading of it), else aria-label, title, the alt of a picture in it, or the value of an input. A button's `value` is the form data it sends, not a name, and a password is a secret, so only other inputs offer a value.
export function name_candidates(element: Element, own_text: unknown): string[] {
  const is_named_input = element.localName === "input" && (element as HTMLInputElement).type !== "password";
  const alt = element.querySelector("img[alt]")?.getAttribute("alt") ?? element.getAttribute("alt");
  const texts = [own_text, element.getAttribute("aria-label"), element.getAttribute("title"), alt, is_named_input ? (element as HTMLInputElement).value : ""];
  return texts.map(squeezed).filter((text) => text !== "");
}

// The text that typed hint text is matched against. A wrapper can hold a whole page of text, so only the start counts.
export const text_of = (element: Element): string => (name_candidates(element, (element as HTMLElement).innerText ?? element.textContent)[0] ?? "").slice(0, TEXT_CHARS);

export const window_of = (element: Element): Window => element.ownerDocument.defaultView ?? window;

const parent_of = (element: Element): Element | null => element.parentElement ?? (element.parentNode as ShadowRoot | null)?.host ?? null;

// The visible boxes of the scrolling ancestors of a page element, in the coordinates of its own window.
export function scroll_clips_in_page(element: Element): Rect[] {
  const win = window_of(element);
  return scroll_clips_of(element, {
    parent_of,
    tag_of: (e) => e.localName,
    style_of_: (e) => {
      const style = win.getComputedStyle(e);
      return { position: style.position, display: style.display, overflow_x_: style.overflowX, overflow_y_: style.overflowY };
    },
    box_of: (e) => {
      const box = e.getBoundingClientRect();
      const left = box.left + e.clientLeft;
      const top = box.top + e.clientTop;
      return { left, top, right: left + e.clientWidth, bottom: top + e.clientHeight };
    },
  });
}
