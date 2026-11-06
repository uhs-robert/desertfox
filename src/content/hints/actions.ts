// What a picked hint does to its element.

import { hover, leave_toward } from "./hover.ts";

export type HintAction = "here" | "tab" | "background" | "window" | "caret" | "visual" | "copy" | "copy_text" | "delete" | "focus" | "hover" | "play_pause" | "mute" | "fullscreen";

export type Place = "here" | "tab" | "background" | "window";

export const OPEN_PLACES: readonly HintAction[] = ["tab", "background", "window"];

export type CaretMode = "caret" | "visual";

export const starts_caret = (action: HintAction): action is CaretMode => action === "caret" || action === "visual";

export type ActionDeps = {
  // A promise settles when the action is finished, so the sequence that started the hints goes on after it.
  open_link: (url: string, place: Place) => void | Promise<unknown>;
  copy: (text: string) => void | Promise<unknown>;
  start_caret: (target: Element, mode: CaretMode) => void;
};

type Target = Pick<HTMLElement, "click" | "focus" | "remove"> & { dispatchEvent?: (event: Event) => boolean; getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } } & { tabIndex?: number; setAttribute?: (name: string, value: string) => void; style?: CSSStyleDeclaration } & { textContent?: string | null; href?: unknown; localName: string; type?: unknown; isContentEditable?: boolean };

const NON_TEXT_INPUTS = new Set(["button", "submit", "reset", "checkbox", "radio", "image", "file", "color", "range"]);

// A field takes the focus. Anything else is clicked.
export function takes_typing(target: Target): boolean {
  if (target.localName === "textarea" || target.localName === "select" || target.isContentEditable === true) return true;
  return target.localName === "input" && !NON_TEXT_INPUTS.has(String(target.type));
}

// A link that can open in another place. A script address would run in the wrong place.
export function link_address(target: Target): string | undefined {
  const href = target.href;
  return typeof href === "string" && href !== "" && !/^javascript:/i.test(href) ? href : undefined;
}

export const is_media = (target: { localName: string }): boolean => target.localName === "video" || target.localName === "audio";

export type MouseEventName =
  | "pointerover" | "pointerenter" | "pointermove" | "pointerout" | "pointerleave" | "pointerdown" | "pointerup"
  | "mouseover" | "mouseenter" | "mousemove" | "mouseout" | "mouseleave" | "mousedown" | "mouseup";

export function center_of(target: Target): { x: number; y: number } {
  const box = target.getBoundingClientRect?.();
  return { x: box ? box.left + box.width / 2 : 0, y: box ? box.top + box.height / 2 : 0 };
}

// One mouse-side event as the left button sends it. Returns false when the page cancelled it. The enter and leave events do not bubble. The point defaults to the middle of the target. A move across several elements passes one point, so every event of it agrees.
export function dispatch_mouse_event(target: Target, type: MouseEventName, related_target: EventTarget | null = null, at = center_of(target)): boolean {
  if (!target.dispatchEvent) return true;
  const stays_inside = /(enter|leave)$/.test(type);
  const init = { bubbles: !stays_inside, cancelable: true, composed: !stays_inside, button: 0, buttons: type.endsWith("down") ? 1 : 0, relatedTarget: related_target, clientX: at.x, clientY: at.y };
  return target.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, { ...init, pointerType: "mouse", isPrimary: true }) : new MouseEvent(type, init));
}

// The events a real click gives, so a widget that opens on mousedown or pointerdown opens. A browser skips the mouse events after a cancelled pointerdown and the focus after a cancelled mousedown, and a widget such as Chosen relies on that to keep its own focus. The click comes last, from click(), so a link or button acts once.
function click_like_a_mouse(target: Target): void {
  for (const type of ["pointerover", "pointerenter", "mouseover"] as const) dispatch_mouse_event(target, type);
  const pointer_pressed = dispatch_mouse_event(target, "pointerdown");
  if (pointer_pressed && dispatch_mouse_event(target, "mousedown")) target.focus();
  dispatch_mouse_event(target, "pointerup");
  if (pointer_pressed) dispatch_mouse_event(target, "mouseup");
  target.click();
}

const FLASH_MS = 700;

// The outline an element had before its flash, and the timer that puts it back. A second focus inside the flash must not save the flash as the old outline.
const flashes = new WeakMap<object, { previous: readonly [string, string]; timer: ReturnType<typeof setTimeout> }>();

// A box that is not focusable (tabIndex below 0) cannot take focus. tabindex=-1 lets a script focus it and leaves the tab order alone. A link, a button or a page tabindex stays as it is.
function focus_target(target: Target): void {
  if (!takes_typing(target) && (target.tabIndex ?? 0) < 0) target.setAttribute?.("tabindex", "-1");
  target.focus();
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

// The outermost ancestor that is as big as the media element, so a site player keeps its controls and subtitles in fullscreen. The page body is never a player box.
export function player_box(media: Element): Element {
  const size = media.getBoundingClientRect();
  let box = media;
  for (let up = media.parentElement; up && up !== up.ownerDocument.body && up !== up.ownerDocument.documentElement; up = up.parentElement) {
    const outer = up.getBoundingClientRect();
    if (Math.abs(outer.width - size.width) > SAME_SIZE_PX || Math.abs(outer.height - size.height) > SAME_SIZE_PX) break;
    box = up;
  }
  return box;
}

// The refusal of play() or requestFullscreen() comes back as the promise, so the pick shows it.
function act_on_media(action: "play_pause" | "mute" | "fullscreen", target: Target): void | Promise<unknown> {
  const media = target as unknown as HTMLMediaElement;
  if (action === "mute") {
    media.muted = !media.muted;
    return;
  }
  if (action === "play_pause") return media.paused ? media.play() : media.pause();
  const doc = media.ownerDocument;
  return doc.fullscreenElement ? doc.exitFullscreen() : player_box(media).requestFullscreen();
}

export function perform(action: HintAction, target: Target, deps: ActionDeps): void | Promise<unknown> {
  if (action !== "hover") leave_toward(target);
  if (action === "delete") return target.remove();
  if (action === "focus") return focus_target(target);
  if (action === "hover") return hover(target);
  if (action === "play_pause" || action === "mute" || action === "fullscreen") return act_on_media(action, target);
  if (starts_caret(action)) return deps.start_caret(target as unknown as Element, action);
  // A copy of the address falls back to the text for an element that is no link.
  if (action === "copy") return deps.copy(link_address(target) ?? (target.textContent ?? "").trim());
  if (action === "copy_text") return deps.copy((target.textContent ?? "").trim());
  if (action === "tab" || action === "background" || action === "window") {
    const address = link_address(target);
    if (address === undefined) return click_like_a_mouse(target);
    return deps.open_link(address, action);
  }
  if (takes_typing(target)) return target.focus();
  click_like_a_mouse(target);
}
