// How far a view must scroll so a box lies inside it, with a margin past the edge. Zero when it already does.
export type Span = { low: number; high: number };

export const scroll_delta = (box: Span, view: Span, margin: number): number =>
  box.low < view.low ? box.low - view.low - margin : box.high > view.high ? box.high - view.high + margin : 0;
