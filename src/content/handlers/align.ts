import { RuntimeRefusal } from "../../shared/command.ts";
import type { AlignFocus, AlignPosition, AlignSelection, HeadingJump } from "../align_target.ts";
import { choose_align_target, live_heading_jump, SCROLL_BLOCK } from "../align_target.ts";
import { deepest_focused_element } from "../editable.ts";

function focused_element(): AlignFocus<Element> | undefined {
  const focused = deepest_focused_element();
  if (!focused) return undefined;
  return { ref: focused, is_page_root_: focused === document.body || focused === document.documentElement };
}

function selection_target(blurred: Element | undefined): AlignSelection<Element> | undefined {
  const node = getSelection()?.focusNode;
  const parent = node instanceof HTMLElement ? node : node?.parentElement;
  // A blurred field leaves the selection on body, which says nothing about where the user was.
  if (!parent || parent === document.body || parent === document.documentElement) return undefined;
  return {
    parent,
    editable: (parent.isContentEditable && parent.closest("[contenteditable]")) || undefined,
    holds_remembered_: !!blurred && parent.contains(blurred),
  };
}

// The page itself holds the slot, because the hints bundle that writes it shares no module with this one.
const jump_slot = window as unknown as { desertfox_heading_jump?: HeadingJump };

// `last_blurred_` comes from the host: this file runs in the page bundle, which has no copy of the blur state.
export function align_focus(position: AlignPosition, last_blurred: Element | undefined): void {
  const blurred = last_blurred?.isConnected ? last_blurred : undefined;
  const heading = live_heading_jump(jump_slot.desertfox_heading_jump);
  const target = choose_align_target(focused_element(), selection_target(blurred), blurred, heading?.element);
  if (!target) throw new RuntimeRefusal("Nothing focused or selected to align");
  // `scrollIntoView` moves only the document of the element, so a heading in a frame also needs its frames aligned, innermost first.
  const chain = target === heading?.element ? [target, ...[...heading.frames].reverse()] : [target];
  for (const element of chain) element.scrollIntoView({ block: SCROLL_BLOCK[position], behavior: "instant" });
}
