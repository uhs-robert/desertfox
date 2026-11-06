// What a picked hint does to its element.

import { hover, leave_toward } from "./hover.ts";

export type HintAction = "here" | "tab" | "background" | "window" | "caret" | "visual" | "copy" | "copy_text" | "copy_image" | "download" | "delete" | "focus" | "hover" | "double_click" | "play_pause" | "mute" | "fullscreen";

export type Place = "here" | "tab" | "background" | "window";

export const OPEN_PLACES: readonly HintAction[] = ["tab", "background", "window"];

export type CaretMode = "caret" | "visual";

export const starts_caret = (action: HintAction): action is CaretMode => action === "caret" || action === "visual";

export type ActionDeps = {
  // A promise settles when the action is finished, so the sequence that started the hints goes on after it.
  open_link: (url: string, place: Place) => void | Promise<unknown>;
  copy: (text: string) => void | Promise<unknown>;
  // The background fetches the address. The content script never does, because the page's rules would block a picture from another site.
  image_action: (action: "copy_image" | "download", address: string) => Promise<unknown>;
  start_caret: (target: Element, mode: CaretMode) => void;
};

type Target = Pick<HTMLElement, "click" | "focus" | "remove"> & { dispatchEvent?: (event: Event) => boolean; getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } } & { tabIndex?: number; setAttribute?: (name: string, value: string) => void; style?: CSSStyleDeclaration } & { textContent?: string | null; href?: unknown; localName: string; type?: unknown; isContentEditable?: boolean } & { currentSrc?: string; src?: string; getAttribute?: (name: string) => string | null; ownerDocument?: Document; baseURI?: string };

const NON_TEXT_INPUTS = new Set(["button", "submit", "reset", "checkbox", "radio", "image", "file", "color", "range"]);

// A field takes the focus. Anything else is clicked.
export function takes_typing(target: Target): boolean {
  if (target.localName === "textarea" || target.localName === "select" || target.isContentEditable === true) return true;
  return target.localName === "input" && !NON_TEXT_INPUTS.has(String(target.type));
}

const MAX_INLINE_ADDRESS = 8 * 1024;

// Firefox refuses a `data:` URL in `tabs.create` ("Illegal URL"), so an inline address copies but does not open.
export const is_inline = (address: string): boolean => /^data:/i.test(address);

// The first url("...") of a computed `background-image`. Firefox computes it absolute and quoted, so a `)` inside the quotes stays.
const background_url = (target: Target): string | undefined =>
  target.ownerDocument?.defaultView?.getComputedStyle(target as unknown as Element).backgroundImage.match(/url\("(.*?)"\)/)?.[1];

// A lazy loader's attribute is often relative, and the open path would read it as typed text.
const lazy_source = (target: Target): string | undefined => {
  const raw = target.getAttribute?.("data-src");
  return raw && URL.canParse(raw, target.baseURI) ? new URL(raw, target.baseURI).href : undefined;
};

// A lazy image holds a tiny inline placeholder in `src` until a script swaps in the real one, so a web address wins over an inline one.
function image_source(target: Target): string | undefined {
  const sources = [target.currentSrc, target.src, lazy_source(target)].filter((source) => source);
  return sources.find((source) => !is_inline(source!)) ?? sources[0];
}

export const is_image_element = (target: Target): boolean => target.localName === "img" || (target.localName === "input" && target.type === "image");

export const is_frame_element = (target: { localName: string }): boolean => target.localName === "iframe" || target.localName === "frame";

const is_web_address = (address: string | undefined): address is string => address !== undefined && address !== "" && !/^about:/i.test(address);

// A frame from another site throws on `contentDocument`, and a same-site frame that still loads shows `about:blank`. Its `src` stands in for both, which can differ from the page after a redirect. A frame with no address of its own (`about:blank`, `srcdoc`) has none to give.
function frame_address(target: Target): string | undefined {
  if (target.getAttribute?.("srcdoc") != null) return undefined;
  let shown: string | undefined;
  try {
    shown = (target as unknown as HTMLIFrameElement).contentDocument?.URL;
  } catch {
    // Another site: `src` stands in.
  }
  if (is_web_address(shown)) return shown;
  return is_web_address(target.src) ? target.src : undefined;
}

const own_source = (target: Target, with_background: boolean): string | undefined => {
  if (is_frame_element(target)) return frame_address(target);
  if (target.localName === "img") return image_source(target);
  if (target.localName === "input" && target.type === "image") return target.src;
  if (is_media(target)) return target.currentSrc || target.src;
  return with_background ? background_url(target) : undefined;
};

// Where the element itself points: a link's href, an image's picture, a media element's source. Never an ancestor's. A script or `blob:` address is no use outside the page, and an inline `data:` one over 8 KB is too long to copy. `with_background` is for the images filter: the element then stands for its picture, so a background image wins over the href of a link.
export function element_address(target: Target, with_background = false): string | undefined {
  if (!with_background && typeof target.href === "string" && target.href !== "") return /^javascript:/i.test(target.href) ? undefined : target.href;
  const source = own_source(target, with_background);
  if (!source || /^(javascript|blob):/i.test(source)) return undefined;
  return is_inline(source) && source.length > MAX_INLINE_ADDRESS ? undefined : source;
}

// Whether an element can take the action by its address: an open needs one that can open, and the images filter needs any.
export function has_usable_address(target: Target, with_background: boolean, opens_elsewhere: boolean): boolean {
  const address = element_address(target, with_background);
  return address !== undefined && !(opens_elsewhere && is_inline(address));
}

export const is_media = (target: { localName: string }): boolean => target.localName === "video" || target.localName === "audio";

export type MouseEventName =
  | "pointerover" | "pointerenter" | "pointermove" | "pointerout" | "pointerleave" | "pointerdown" | "pointerup"
  | "mouseover" | "mouseenter" | "mousemove" | "mouseout" | "mouseleave" | "mousedown" | "mouseup" | "click" | "dblclick";

export function center_of(target: Target): { x: number; y: number } {
  const box = target.getBoundingClientRect?.();
  return { x: box ? box.left + box.width / 2 : 0, y: box ? box.top + box.height / 2 : 0 };
}

// One mouse-side event as the left button sends it. Returns false when the page cancelled it. The enter and leave events do not bubble. The point defaults to the middle of the target. A move across several elements passes one point, so every event of it agrees. `detail` is the click count.
export function dispatch_mouse_event(target: Target, type: MouseEventName, related_target: EventTarget | null = null, at = center_of(target), detail = 0): boolean {
  if (!target.dispatchEvent) return true;
  const stays_inside = /(enter|leave)$/.test(type);
  const init = { bubbles: !stays_inside, cancelable: true, composed: !stays_inside, button: 0, buttons: type.endsWith("down") ? 1 : 0, relatedTarget: related_target, clientX: at.x, clientY: at.y };
  return target.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, { ...init, pointerType: "mouse", isPrimary: true }) : new MouseEvent(type, { ...init, detail }));
}

// The pointer and mouse events of one press and release. A browser skips the mouse events after a cancelled pointerdown and the focus after a cancelled mousedown, and a widget such as Chosen relies on that to keep its own focus.
function press_and_release(target: Target, detail: number): void {
  const pointer_pressed = dispatch_mouse_event(target, "pointerdown", null, undefined, detail);
  if (pointer_pressed && dispatch_mouse_event(target, "mousedown", null, undefined, detail)) target.focus();
  dispatch_mouse_event(target, "pointerup", null, undefined, detail);
  if (pointer_pressed) dispatch_mouse_event(target, "mouseup", null, undefined, detail);
}

const enter_like_a_mouse = (target: Target): void => {
  for (const type of ["pointerover", "pointerenter", "mouseover"] as const) dispatch_mouse_event(target, type);
};

// The events a real click gives, so a widget that opens on mousedown or pointerdown opens. The click comes last, from click(), so a link or button acts once.
function click_like_a_mouse(target: Target): void {
  enter_like_a_mouse(target);
  press_and_release(target, 1);
  target.click();
}

// A link is no target: its first click would navigate away before the second press. The climb covers the children of a link, across shadow roots, because their click bubbles to it.
export function is_inside_link(element: Element): boolean {
  for (let up: Element | null = element; up; up = parent_across_shadow(up)) if (up.matches("a[href]")) return true;
  return false;
}

// The word segment that holds the offset, or the one that starts there. A space or punctuation holds none.
export function word_range_at(text: string, offset: number): [number, number] | undefined {
  for (const part of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) {
    if (offset >= part.index && offset < part.index + part.segment.length) return part.isWordLike ? [part.index, part.index + part.segment.length] : undefined;
  }
  return undefined;
}

// The word under the point, for a text node only. Firefox selects nothing for a synthetic double-click. A field keeps its own selection rules and is left alone, and a point on a box with no text changes nothing. The range is set directly, because the move and extend by word depend on the platform at a word start.
function select_word_at(target: Target, at: { x: number; y: number }): void {
  const doc = target.ownerDocument;
  const root = (target as unknown as Node).getRootNode?.() as ShadowRoot | undefined;
  const shadow_roots = root?.host ? [root] : [];
  const position = doc?.caretPositionFromPoint?.(at.x, at.y, { shadowRoots: shadow_roots });
  const text = position?.offsetNode as Text | undefined;
  if (!position || text?.nodeType !== Node.TEXT_NODE || takes_typing(target) || !(target as unknown as Node).contains(text)) return;
  const word = word_range_at(text.data, position.offset);
  if (!word) return;
  const range = doc!.createRange();
  range.setStart(text, word[0]);
  range.setEnd(text, word[1]);
  const selection = doc!.defaultView?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

// Two presses with click counts 1 and 2, a click after each, then dblclick, as a mouse sends them. The clicks are events and not click(), because click() carries no count. A link would act on the first, so links are not offered as targets.
function double_click_like_a_mouse(target: Target): void {
  enter_like_a_mouse(target);
  for (const detail of [1, 2]) {
    press_and_release(target, detail);
    dispatch_mouse_event(target, "click", null, undefined, detail);
  }
  dispatch_mouse_event(target, "dblclick", null, undefined, 2);
  select_word_at(target, center_of(target));
}

const FLASH_MS = 700;

// The outline an element had before its flash, and the timer that puts it back. A second focus inside the flash must not save the flash as the old outline.
const flashes = new WeakMap<object, { previous: readonly [string, string]; timer: ReturnType<typeof setTimeout> }>();

// A box that is not focusable (tabIndex below 0) cannot take focus. tabindex=-1 lets a script focus it and leaves the tab order alone. A link, a button or a page tabindex stays as it is.
function focus_target(target: Target): void {
  if (!takes_typing(target) && (target.tabIndex ?? 0) < 0) target.setAttribute?.("tabindex", "-1");
  target.focus();
  // Gecko leaves the focus outside a frame of another site on the element's focus(). Its window's focus() is one of the few calls another site allows, and it enters the frame.
  if (is_frame_element(target)) (target as unknown as HTMLIFrameElement).contentWindow?.focus();
  if (takes_typing(target) || !target.style) return;
  // Shows which element took the focus. The old inline outline comes back after a moment.
  const { style } = target;
  const pending = flashes.get(target);
  if (pending) clearTimeout(pending.timer);
  const previous = pending?.previous ?? ([style.getPropertyValue("outline"), style.getPropertyPriority("outline")] as const);
  style.setProperty("outline", "2px solid currentColor", "important");
  const timer = setTimeout(() => {
    style.setProperty("outline", previous[0], previous[1]);
    flashes.delete(target);
  }, FLASH_MS);
  flashes.set(target, { previous, timer });
}

const SAME_SIZE_PX = 1;

type Climbable = { parentElement: Element | null; parentNode: unknown };

// A custom player keeps its video in a shadow root, so the climb steps from the root to its host.
const parent_across_shadow = (element: Climbable): Element | null => element.parentElement ?? (element.parentNode as { host?: Element } | null)?.host ?? null;

// The outermost ancestor that is as big as the media element, so a site player keeps its controls and subtitles in fullscreen. The page body is never a player box.
export function player_box(media: Element): Element {
  const size = media.getBoundingClientRect();
  let box = media;
  for (let up = parent_across_shadow(media); up && up !== up.ownerDocument.body && up !== up.ownerDocument.documentElement; up = parent_across_shadow(up)) {
    const outer = up.getBoundingClientRect();
    if (Math.abs(outer.width - size.width) > SAME_SIZE_PX || Math.abs(outer.height - size.height) > SAME_SIZE_PX) break;
    box = up;
  }
  return box;
}

// play() and requestFullscreen() need the user activation of the pick keydown. A refusal becomes a failed outcome, because a rejected promise from an action reads as a page that went away and cancels silently.
type Refusal = { ok: false; message: string };

const NO_WEB_ADDRESS: Refusal = { ok: false, message: "This element has no web address" };

const refusal_as_outcome = (pending: Promise<unknown>): Promise<unknown> =>
  pending.then(() => undefined, (error: unknown) => ({ ok: false, message: String((error as Error)?.message ?? error) }));

function act_on_media(action: "play_pause" | "mute" | "fullscreen", target: Target): void | Refusal | Promise<unknown> {
  // The schema cannot tie these actions to the media filter, so `--links` or `--all` can pick any element.
  if (!is_media(target)) return { ok: false, message: "Not a media element" };
  const media = target as unknown as HTMLMediaElement;
  if (action === "mute") {
    media.muted = !media.muted;
    return;
  }
  if (action === "play_pause") return media.paused ? refusal_as_outcome(media.play()) : media.pause();
  const doc = media.ownerDocument;
  return refusal_as_outcome(doc.fullscreenElement ? doc.exitFullscreen() : player_box(media).requestFullscreen());
}

export function perform(action: HintAction, target: Target, deps: ActionDeps, with_background = false): void | Refusal | Promise<unknown> {
  if (action !== "hover") leave_toward(target);
  if (action === "delete") return target.remove();
  if (action === "focus") return focus_target(target);
  if (action === "hover") return hover(target);
  if (action === "double_click") return double_click_like_a_mouse(target);
  if (action === "play_pause" || action === "mute" || action === "fullscreen") return act_on_media(action, target);
  if (starts_caret(action)) return deps.start_caret(target as unknown as Element, action);
  const address = element_address(target, with_background);
  // A copy of the address falls back to the text for an element that has none, except a picture, whose text is empty.
  if (action === "copy") return address === undefined && (is_image_element(target) || is_media(target) || is_frame_element(target)) ? NO_WEB_ADDRESS : deps.copy(address ?? (target.textContent ?? "").trim());
  if (action === "copy_image" || action === "download") return address === undefined ? NO_WEB_ADDRESS : deps.image_action(action, address);
  if (action === "copy_text") return is_frame_element(target) ? { ok: false, message: "A frame has no text" } : deps.copy((target.textContent ?? "").trim());
  if (action === "tab" || action === "background" || action === "window") {
    // A click on a frame does nothing, so it must not stand in for an open.
    if (address === undefined) return is_frame_element(target) ? NO_WEB_ADDRESS : click_like_a_mouse(target);
    return deps.open_link(address, action);
  }
  if (takes_typing(target)) return target.focus();
  if (is_frame_element(target)) return focus_target(target);
  click_like_a_mouse(target);
}
