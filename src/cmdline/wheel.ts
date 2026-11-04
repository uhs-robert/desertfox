// Turns wheel events into whole rows. A trackpad sends many small pixel deltas, so the pixels add up and the view moves
// only when the sum passes one row. A classic notch (3 lines) moves 3 rows.

const PAGE_ROWS = 10;
// WheelEvent.deltaMode values.
const MODE_LINE = 1;
const MODE_PAGE = 2;

export type Wheel_state = { remainder_px: number };

export function wheel_rows(state: Wheel_state, delta_y: number, delta_mode: number, row_height_px: number): number {
  const unit_px = delta_mode === MODE_LINE ? row_height_px : delta_mode === MODE_PAGE ? row_height_px * PAGE_ROWS : 1;
  const total_px = state.remainder_px + delta_y * unit_px;
  const rows = Math.trunc(total_px / row_height_px);
  state.remainder_px = total_px - rows * row_height_px;
  return rows;
}
