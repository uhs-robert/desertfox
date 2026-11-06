// Which matches of a character find to draw: those on screen and about a screen around it. Pure.

import { PAINT_CAP } from "./find_paint.ts";

// Widens the range by its own length on each side, so a box that layout puts out of order still gets its highlight.
export function pad_range(first: number, last: number, length: number): { first: number; last: number } {
  const span = Math.max(last - first, 0);
  return { first: Math.max(first - span, 0), last: Math.min(last + span, length - 1) };
}

const lower_bound = (sorted: number[], value: number): number => {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
};

// The indexes of the sorted `positions` that lie in [first, last]. Past the cap, a cap-sized run around `center`, an index into `positions`, stays.
export function indexes_in_range(positions: number[], first: number, last: number, center: number, cap = PAINT_CAP): number[] {
  let start = lower_bound(positions, first);
  let end = lower_bound(positions, last + 1);
  if (end - start > cap) {
    start = Math.min(Math.max(center - Math.floor(cap / 2), start), end - cap);
    end = start + cap;
  }
  return Array.from({ length: Math.max(end - start, 0) }, (_, at) => start + at);
}
