// What a picked hint does to its element.

export type HintAction = "here" | "tab" | "background" | "window" | "select" | "copy" | "copy_text" | "delete" | "focus";

export type Place = "here" | "tab" | "background" | "window";

export const OPEN_PLACES: readonly HintAction[] = ["tab", "background", "window"];

// Actions that no piece has built yet. The command refuses them before it enters hint mode.
export const UNBUILT_ACTIONS: readonly HintAction[] = ["select"];

export type ActionDeps = {
  open_link: (url: string, place: Place) => void;
  copy: (text: string) => void;
};

type Target = Pick<HTMLElement, "click" | "focus" | "remove"> & { textContent?: string | null; href?: unknown; localName: string; type?: unknown; isContentEditable?: boolean };

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

export function perform(action: HintAction, target: Target, deps: ActionDeps): void {
  if (action === "delete") return target.remove();
  if (action === "focus") return target.focus();
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
