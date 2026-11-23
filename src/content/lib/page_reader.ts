// What the item finder, the load step and the `]]` detector share to read a page: a `PageReader` and the walks and block tests over it.

// The order of the declarations below keeps next_page.js under its size guard. Build before you reorder.

export type Box = { x: number; y: number; w: number; h: number };

// Layout facts about one node. `box_` is in page coordinates and undefined for a node with no box or one hidden by visibility or opacity.
export type PageReader<N> = {
  root_: N;
  parent_: (node: N) => N | null;
  children_: (node: N) => readonly N[];
  tag_: (node: N) => string;
  attr_: (node: N, name: string) => string | null;
  text_: (node: N) => string;
  // The length of the node's text with spaces trimmed, for a prose block that holds more text than its links.
  text_length_: (node: N) => number;
  box_: (node: N) => Box | undefined;
  // The elements of the page that a CSS selector list matches, also inside the shadow roots `children_` has opened: one native query per root, where a walk would read every element.
  query_all_: (selector: string) => N[];
  scrolls_sideways_: (node: N) => boolean;
  pinned_: (node: N) => boolean;
  // Whether a link goes to the page being read, the fragment aside (an empty address too). Only the item finder reads it, so the detector's reader leaves it out.
  same_page_?: (link: N) => boolean;
  // Where a pointer cursor starts (the same rule as a hint's click sign), for a control that has no role. Only the load step reads it, so the item finder's reader leaves it out.
  pointer_?: (node: N) => boolean;
  view_: () => { w: number; h: number; page_h: number };
};

const CAROUSEL_CLASS = /carousel|swiper|slider|slick|glide|splide|scroller|flickity/i;

// The smallest repeated item: at least 24 by 120 px, so icons and chips are not items.
export const is_item_size = (box: Box | undefined): box is Box => box !== undefined && box.h >= 24 && box.w >= 120;

// The answer of `read` per node, read once. A reader serves one read of the page (a `]]` press or a finder run), so the answers go with it.
export const once = <N, T>(read: (node: N) => T): ((node: N) => T) => {
  const seen = new Map<N, T>();
  return (node) => (seen.has(node) ? seen.get(node)! : seen.set(node, read(node)).get(node)!);
};

// A carousel by its role or class, a sideways scroller, or a box beside one (the arrows of a track sit next to it).
export const in_carousel = <N>(reader: PageReader<N>, node: N): boolean =>
  [...ancestors(reader, node, 3)].some(
    (box) =>
      normalize(reader.attr_(box, "aria-roledescription") ?? "").includes("carousel") ||
      CAROUSEL_CLASS.test(reader.attr_(box, "class") ?? "") ||
      reader.scrolls_sideways_(box) ||
      reader.children_(box).some((sibling) => reader.scrolls_sideways_(sibling) && !is_wide_content(reader, sibling)),
  );

// A code block or a table scrolls sideways because its content is wide, not because it is a track of cards.
const is_wide_content = <N>(reader: PageReader<N>, node: N): boolean => [node, ...ancestors(reader, node)].some((at) => /^(pre|table)$/.test(reader.tag_(at)));

// Three or more items of one signature stacked in at least three rows: a list, not a toolbar or a carousel track.
export function stacked_items<N>(reader: PageReader<N>, items: readonly N[]): boolean {
  const rows = new Set<number>();
  for (const item of items) rows.add(Math.round(reader.box_(item)!.y / 8));
  return items.length >= 3 && rows.size >= 3;
}


export const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

// An item of a repeated block reads as its tag and first class, so siblings built from one template share it.
export const signature = <N>(reader: PageReader<N>, node: N): string => `${reader.tag_(node)}.${(reader.attr_(node, "class") ?? "").trim().split(/\s+/)[0]}`;

export function* ancestors<N>(reader: PageReader<N>, node: N, limit = Infinity): Generator<N> {
  for (let at = reader.parent_(node); at !== null && limit-- > 0; at = reader.parent_(at)) yield at;
}

// In page order, only those `keep` takes. A loop, not a recursive generator, whose cost grows with the depth of the tree.
export function descendants<N>(reader: PageReader<N>, node: N, keep: (node: N) => boolean = () => true): N[] {
  const found: N[] = [];
  const stack = [node];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (next !== node && keep(next)) found.push(next);
    const children = reader.children_(next);
    for (let at = children.length; at-- > 0; ) stack.push(children[at]!);
  }
  return found;
}
