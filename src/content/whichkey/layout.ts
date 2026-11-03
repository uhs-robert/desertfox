// Where the panel goes. A short list is a column in the corner above the mode badge. A long one is a grid along the bottom.

export type WhichKeyLayout = "column" | "grid";

const ROW_HEIGHT_PX = 22;
// Room the column leaves for the badge, the page margin and some page above it.
const RESERVED_HEIGHT_PX = 96;
const MAX_COLUMN_ROWS = 20;

export function choose_layout(row_count: number, viewport_height_px: number): WhichKeyLayout {
  const rows_that_fit = Math.min(MAX_COLUMN_ROWS, Math.floor((viewport_height_px - RESERVED_HEIGHT_PX) / ROW_HEIGHT_PX));
  return row_count <= rows_that_fit ? "column" : "grid";
}
