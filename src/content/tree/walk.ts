// The moves of a thread tree, on a flat list of the shown items in page order with the depth of each. Pure, so a test needs no DOM.

export type TreeRow<T> = { item: T; depth: number };

// The nearest item above with a lower depth.
export function parent_of<T>(rows: readonly TreeRow<T>[], index: number): number | undefined {
  for (let at = index - 1; at >= 0; at--) if (rows[at]!.depth < rows[index]!.depth) return at;
  return undefined;
}

// The next item, when it is one level deeper. A folded item has none, because its replies are hidden and not in the list.
export function child_of<T>(rows: readonly TreeRow<T>[], index: number): number | undefined {
  return rows[index + 1] && rows[index + 1]!.depth === rows[index]!.depth + 1 ? index + 1 : undefined;
}

// The first item at the same depth in the direction, before the walk meets a lower depth (the end of the parent's replies).
export function sibling_of<T>(rows: readonly TreeRow<T>[], index: number, step: 1 | -1): number | undefined {
  for (let at = index + step; rows[at] && rows[at]!.depth >= rows[index]!.depth; at += step) if (rows[at]!.depth === rows[index]!.depth) return at;
  return undefined;
}
