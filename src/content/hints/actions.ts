// What a picked hint does to its element.

export type HintAction = "here" | "tab" | "background" | "window" | "caret" | "visual" | "copy" | "copy_text" | "delete" | "focus";

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

type Target = Pick<HTMLElement, "click" | "focus" | "remove"> & { tabIndex?: number; hasAttribute?: (name: string) => boolean; setAttribute?: (name: string, value: string) => void; style?: CSSStyleDeclaration } & { textContent?: string | null; href?: unknown; localName: string; type?: unknown; isContentEditable?: boolean };

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

const FLASH_MS = 700;

// A box with no tabindex cannot take focus. tabindex=-1 lets a script focus it and leaves the tab order alone. A page's own tabindex stays.
function focus_target(target: Target): void {
  if (!takes_typing(target) && target.hasAttribute?.("tabindex") === false) target.setAttribute?.("tabindex", "-1");
  target.focus();
  if (takes_typing(target) || !target.style) return;
  // Shows which element took the focus. The old inline outline comes back after a moment.
  const { style } = target;
  const previous = [style.getPropertyValue("outline"), style.getPropertyPriority("outline")] as const;
  style.setProperty("outline", "2px solid currentColor", "important");
  setTimeout(() => style.setProperty("outline", previous[0], previous[1]), FLASH_MS);
}

export function perform(action: HintAction, target: Target, deps: ActionDeps): void | Promise<unknown> {
  if (action === "delete") return target.remove();
  if (action === "focus") return focus_target(target);
  if (starts_caret(action)) return deps.start_caret(target as unknown as Element, action);
  // A copy of the address falls back to the text for an element that is no link.
  if (action === "copy") return deps.copy(link_address(target) ?? (target.textContent ?? "").trim());
  if (action === "copy_text") return deps.copy((target.textContent ?? "").trim());
  if (action === "tab" || action === "background" || action === "window") {
    const address = link_address(target);
    if (address === undefined) return target.click();
    return deps.open_link(address, action);
  }
  if (takes_typing(target)) return target.focus();
  target.click();
}
