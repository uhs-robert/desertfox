// The range of visual item mode: two ends in the list of items, the anchor where `v` was pressed and the cursor that the keys move. Only keys and last known places are kept, never nodes, because a page that redraws its list replaces them.

// The key that finds the item again after a redraw, and the place it last stood at.
export type End = [key: string, index: number];

const href_of = (item: Element) => (item.matches("a[href]") ? item : item.querySelector("a[href]"))?.getAttribute("href");
const id_of = (item: Element) => item.getAttribute("data-id");

// One scheme for the whole read, never one per item, so two keys never mix schemes: the link address when every item has its own, else `data-id`, else the row index.
export function keys_of(items: readonly Element[]): string[] {
  for (const read of [href_of, id_of]) {
    const values = items.map((item) => read(item) ?? "");
    if (values.every(Boolean) && new Set(values).size === values.length) return values;
  }
  return items.map((_, index) => `${index}`);
}

const end_at = (keys: readonly string[], index: number): End => [keys[index]!, index];

// The places of both ends in a fresh read: the item of the same key, else the item that now stands at the last known place, clamped to the list (the nearest neighbour of a removed item). Undefined for an empty list, which ends the selection. A partial loss never does.
export const settle = (keys: readonly string[], ends: readonly End[]): number[] | undefined => (keys.length ? ends.map(([key, index]) => (keys.includes(key) ? keys.indexOf(key) : Math.min(index, keys.length - 1))) : undefined);

export type SelectionDeps = {
  items_: () => Element[];
  in_visual_: () => boolean;
  // Makes the item the start of the next move, so a cursor that follows a redrawn node keeps its place.
  follow_: (item: Element) => void;
  // The whole list is gone.
  ended_: () => void;
};

export function create_selection(deps: SelectionDeps) {
  // The anchor, then the cursor.
  let ends: End[] | undefined;
  // The next land sets both ends, as `v` does.
  let restart = false;
  const read = () => {
    const items = deps.items_();
    return { items, keys: keys_of(items) };
  };
  // Finds both ends again and stores what it found, so the next read is exact. The selection ends with the mode, however the mode ended.
  const resolve = () => {
    const held = deps.in_visual_() ? ends : undefined;
    if (!held) return (ends = undefined);
    const { items, keys } = read();
    const places = settle(keys, held);
    if (!places) return (ends = undefined), deps.ended_(), undefined;
    ends = places.map((place) => end_at(keys, place));
    return { items, anchor_: places[0]!, cursor_: places[1]! };
  };

  return {
    start_next_land_: (on: boolean) => void (restart = on),
    // A land of the cursor: the item takes the cursor, or both ends on a start. Lands outside visual item mode touch nothing.
    land_: (item: Element) => {
      if (!deps.in_visual_()) return;
      const before = restart ? undefined : resolve();
      const { items, keys } = read();
      const end = end_at(keys, items.indexOf(item));
      if (end[1] >= 0) ends = [before ? ends![0]! : end, end];
    },
    // Finds the cursor again after a redraw and hands back its item, for the box. The same read keeps the marks and the count right.
    tick_: (): Element | undefined => {
      const found = resolve();
      const cursor = found?.items[found.cursor_];
      if (cursor) deps.follow_(cursor);
      return cursor;
    },
    // The other end becomes the cursor.
    swap_: (): Element | undefined => {
      const found = resolve();
      if (!found) return undefined;
      ends = [ends![1]!, ends![0]!];
      return found.items[found.anchor_];
    },
    // The items from the anchor to the cursor in document order, with the anchor's own item.
    range_: (): { items_: Element[]; anchor_: Element } | undefined => {
      const found = resolve();
      return found && { items_: found.items.slice(Math.min(found.anchor_, found.cursor_), Math.max(found.anchor_, found.cursor_) + 1), anchor_: found.items[found.anchor_]! };
    },
  };
}
export type ItemSelection = ReturnType<typeof create_selection>;
