// How many columns the panel needs. Rows fill the corner above the mode badge, and a list too tall for the viewport grows sideways.

const ROW_HEIGHT_PX = 22;
// Room the panel leaves for the badge, the page margin and some page above it.
const RESERVED_HEIGHT_PX = 96;
const MAX_ROWS_PER_COLUMN = 20;
const MAX_COLUMNS = 4;

export function choose_columns(row_count: number, viewport_height_px: number): number {
  const rows_per_column = Math.max(1, Math.min(MAX_ROWS_PER_COLUMN, Math.floor((viewport_height_px - RESERVED_HEIGHT_PX) / ROW_HEIGHT_PX)));
  return Math.min(MAX_COLUMNS, Math.max(1, Math.ceil(row_count / rows_per_column)));
}
