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

// The title is the group chain joined like which-key.nvim's breadcrumb. When it is too wide, whole groups drop from the start so the deepest group stays,
// and "…" stands for them. `overflows` says whether a candidate text is wider than the panel allows.
// The cut is not CSS `direction: rtl` with `text-overflow`, because bidi reordering moves the "+" and the "»" to the wrong side.
export const TITLE_SEPARATOR = " » ";

export function fit_title(chain: readonly string[], overflows: (text: string) => boolean): string {
  for (let dropped = 0; dropped < chain.length - 1; dropped++) {
    const text = (dropped === 0 ? chain : ["…", ...chain.slice(dropped)]).join(TITLE_SEPARATOR);
    if (!overflows(text)) return text;
  }
  // One group is left. If it alone is too wide, CSS cuts its end.
  return (chain.length > 1 ? ["…", chain.at(-1)!] : chain).join(TITLE_SEPARATOR);
}
