// Which element to scroll, and how far. Pure: the DOM side builds the candidates.

export type ScrollAxis = "x" | "y";

export type ScrollCandidate<Ref> = {
  ref: Ref;
  can_scroll_x_: boolean;
  can_scroll_y_: boolean;
  area: number;
};

const can_scroll = (candidate: ScrollCandidate<unknown>, axis: ScrollAxis) =>
  axis === "x" ? candidate.can_scroll_x_ : candidate.can_scroll_y_;

// Order: a scrollable ancestor of the focused element, then the page, then the largest scrollable
// element. `all_candidates` is lazy because it walks the whole document.
export function pick_scroll_target<Ref>(
  focus_chain: readonly ScrollCandidate<Ref>[],
  page: ScrollCandidate<Ref> | undefined,
  all_candidates: () => readonly ScrollCandidate<Ref>[],
  axis: ScrollAxis,
): Ref | undefined {
  const from_focus = focus_chain.find((candidate) => can_scroll(candidate, axis));
  if (from_focus) return from_focus.ref;
  if (page && can_scroll(page, axis)) return page.ref;
  let largest: ScrollCandidate<Ref> | undefined;
  for (const candidate of all_candidates()) {
    if (can_scroll(candidate, axis) && (!largest || candidate.area > largest.area)) largest = candidate;
  }
  return largest?.ref;
}

export const LINE_PIXELS = 5;

export function percent_to_offset(percent: number, scroll_size: number, client_size: number): number {
  const clamped = Math.min(100, Math.max(0, percent));
  return (Math.max(0, scroll_size - client_size) * clamped) / 100;
}
