// Finds the elements a hint filter can label. Visibility is decided later, in visible.ts.

import { keep_visible } from "./visible.ts";
import type { PageProbe } from "./visible.ts";

export type HintFilter = "all" | "clickable" | "inputs" | "links" | "custom";

const TEXT_FIELDS = 'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable=""], [contenteditable="true"]';
const LINKS = "a[href]";
const CLICKABLE = `${LINKS}, button:not([disabled]), summary, [onclick], [tabindex]:not([tabindex="-1"]), [role=button], [role=link], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], [role=checkbox], [role=switch], [role=option], [role=radio], label[for], ${TEXT_FIELDS}`;
// A roving-tabindex widget keeps one item at tabindex 0 and the rest at -1, so -1 alone says nothing. A click-like role, or a place inside a menu, does.
const ROVING_ITEM = `${["button", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "option", "checkbox", "switch", "radio"].map((role) => `[tabindex="-1"][role=${role}]`).join(", ")}`;
const MENU_ITEM = `${ROVING_ITEM}, :is([role=menu], [role=menubar], menu) [tabindex="-1"]:not(:is([role=menu], [role=menubar], [role=none], [role=presentation], [role=separator], [role=group]))`;
const ALL = `${CLICKABLE}, h1, h2, h3, h4, h5, h6, p, li, img, td, th, pre, code, blockquote`;

const SELECTORS: Record<Exclude<HintFilter, "custom">, string> = { all: ALL, clickable: CLICKABLE, inputs: TEXT_FIELDS, links: LINKS };

export const selector_for = (filter: HintFilter, custom_selector: string | undefined): string =>
  filter === "custom" ? (custom_selector ?? "") : SELECTORS[filter];

// An element and the iframes that hold it, outermost first. The frames give its place on the top page.
// `weak` marks an element that only looks clickable (a pointer cursor, a spot in a menu), see `drop_redundant_weak`.
export type Found = { element: Element; frames: Element[]; weak?: true };

const MAX_FRAME_DEPTH = 4;

// Firefox gives content scripts closed shadow roots through this property.
const shadow_root_of = (element: Element): ShadowRoot | null =>
  (element as Element & { openOrClosedShadowRoot?: ShadowRoot | null }).openOrClosedShadowRoot ?? element.shadowRoot;

// A frame from another origin throws, and the content script of that frame hints it by itself.
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

// Walks the whole tree once, so shadow hosts and same-origin frames are found where they stand.
export function collect(root: ParentNode, selector: string, is_weak?: WeakTest, frames: Element[] = [], found: Found[] = []): Found[] {
  if (selector === "") return found;
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (element.matches(selector)) found.push({ element, frames });
    else if (is_weak?.(element)) found.push({ element, frames, weak: true });
    const shadow = shadow_root_of(element);
    if (shadow) collect(shadow, selector, is_weak, frames, found);
    if (is_frame(element) && frames.length < MAX_FRAME_DEPTH) {
      const inner = document_of_frame(element);
      if (inner) collect(inner, selector, is_weak, [...frames, element], found);
    }
  }
  return found;
}

// Page reads behind the weak test, so tests run on fake elements.
export type ClickStyles = { cursor_of: (element: Element) => string; parent_of: (element: Element) => Element | null };

const NEVER_WEAK = new Set(["html", "body", "head", "script", "style", "option"]);

// A pointer cursor is inherited, so every child of a clickable card has it too. Except for `<a>`, only the element where it starts counts, which is one hint per card.
export function has_click_sign(element: Element, styles: ClickStyles): boolean {
  if (NEVER_WEAK.has(element.localName)) return false;
  if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
  if (styles.cursor_of(element) !== "pointer") return false;
  // An `<a>` without href is a link whose click a script handles. An inherited pointer still counts: a menu list that sets it on the list must not hide one of its links.
  if (element.localName === "a") return true;
  const parent = styles.parent_of(element);
  return parent === null || styles.cursor_of(parent) !== "pointer";
}

export const make_weak_test = (styles: ClickStyles): WeakTest => (element) => element.matches(MENU_ITEM) || has_click_sign(element, styles);

const dom_styles: ClickStyles = {
  cursor_of: (element) => (element.ownerDocument.defaultView ?? window).getComputedStyle(element).cursor,
  parent_of: (element) => element.parentElement ?? (element.parentNode as ShadowRoot | null)?.host ?? null,
};

// Only the filters that mean "anything clickable" look for weak candidates. `links`, `inputs` and `custom` are exact.
export const weak_test_for = (filter: HintFilter): WeakTest | undefined => (filter === "clickable" || filter === "all" ? make_weak_test(dom_styles) : undefined);

type Climbable = { parentNode: unknown; host?: unknown };

// One hint per thing to click. A weak candidate gives way to a candidate inside it (the innermost wins) and to a strong candidate around it (that one gets the hint).
// Only a candidate of the clickable kind counts as that stronger one: with the `all` filter a plain `li` or `p` must not hide the link in it.
export function drop_redundant_weak(found: Found[]): Found[] {
  const weak = new Set<unknown>(found.filter((item) => item.weak).map((item) => item.element));
  if (weak.size === 0) return found;
  const clickable = found.filter((item) => item.weak || item.element.matches(CLICKABLE));
  const strong = new Set<unknown>(clickable.filter((item) => !item.weak).map((item) => item.element));
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

// Visibility comes first: a wrapper must not give way to a hidden or off-screen candidate that gets no hint.
export const keep_visible_deduplicated = (found: Found[], probe: PageProbe<Found>): Found[] => drop_redundant_weak(keep_visible(found, probe));

// The visible text holds the needle, ignoring case. The needle arrives already lower-cased.
// An empty innerText means the text is hidden, so only a missing innerText falls back to textContent.
export const has_text = (element: Element, lower_needle: string): boolean =>
  ((element as HTMLElement).innerText ?? element.textContent ?? "").toLowerCase().includes(lower_needle);
