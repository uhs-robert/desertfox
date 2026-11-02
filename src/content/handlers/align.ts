import type { AlignFocus, AlignPosition, AlignSelection } from "../align_target.ts";
import { choose_align_target, SCROLL_BLOCK } from "../align_target.ts";
import { last_blurred_element } from "./page.ts";
import type { ContentHandler } from "./types.ts";

function focused_element(): AlignFocus<Element> | undefined {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  if (!focused) return undefined;
  return { ref: focused, is_page_root: focused === document.body || focused === document.documentElement };
}

function selection_target(blurred: Element | undefined): AlignSelection<Element> | undefined {
  const node = getSelection()?.focusNode;
  const parent = node instanceof HTMLElement ? node : node?.parentElement;
  // A blurred field leaves the selection on body, which says nothing about where the user was.
  if (!parent || parent === document.body || parent === document.documentElement) return undefined;
  return {
    parent,
    editable: (parent.isContentEditable && parent.closest("[contenteditable]")) || undefined,
    holds_remembered: !!blurred && parent.contains(blurred),
  };
}

export const scroll_align: ContentHandler = {
  run: (args) => {
    const last_blurred = last_blurred_element();
    const blurred = last_blurred?.isConnected ? last_blurred : undefined;
    const target = choose_align_target(focused_element(), selection_target(blurred), blurred);
    if (!target) throw new Error("Nothing focused or selected to align");
    target.scrollIntoView({ block: SCROLL_BLOCK[args.position as AlignPosition], behavior: "instant" });
  },
};
