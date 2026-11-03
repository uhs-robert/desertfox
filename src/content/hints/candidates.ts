// Finds the elements a hint filter can label. Visibility is decided later, in visible.ts.

export type HintFilter = "all" | "clickable" | "inputs" | "links" | "custom";

const TEXT_FIELDS = 'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable=""], [contenteditable="true"]';
const LINKS = "a[href]";
const CLICKABLE = `${LINKS}, button:not([disabled]), summary, [onclick], [tabindex]:not([tabindex="-1"]), [role=button], [role=link], [role=menuitem], [role=tab], [role=checkbox], [role=switch], [role=option], label[for], ${TEXT_FIELDS}`;
const ALL = `${CLICKABLE}, h1, h2, h3, h4, h5, h6, p, li, img, td, th, pre, code, blockquote`;

const SELECTORS: Record<Exclude<HintFilter, "custom">, string> = { all: ALL, clickable: CLICKABLE, inputs: TEXT_FIELDS, links: LINKS };

export const selector_for = (filter: HintFilter, custom_selector: string | undefined): string =>
  filter === "custom" ? (custom_selector ?? "") : SELECTORS[filter];

// An element and the iframes that hold it, outermost first. The frames give its place on the top page.
export type Found = { element: Element; frames: Element[] };

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

// Walks the whole tree once, so shadow hosts and same-origin frames are found where they stand.
export function collect(root: ParentNode, selector: string, frames: Element[] = [], found: Found[] = []): Found[] {
  if (selector === "") return found;
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (element.matches(selector)) found.push({ element, frames });
    const shadow = shadow_root_of(element);
    if (shadow) collect(shadow, selector, frames, found);
    if (is_frame(element) && frames.length < MAX_FRAME_DEPTH) {
      const inner = document_of_frame(element);
      if (inner) collect(inner, selector, [...frames, element], found);
    }
  }
  return found;
}

// The visible text holds the needle, ignoring case. The needle arrives already lower-cased.
// An empty innerText means the text is hidden, so only a missing innerText falls back to textContent.
export const has_text = (element: Element, lower_needle: string): boolean =>
  ((element as HTMLElement).innerText ?? element.textContent ?? "").toLowerCase().includes(lower_needle);
