// Keeps the candidates a person can see and click. Every page read goes through `PageProbe`, so the rules run on a fake page in tests.

export type Rect = { left: number; top: number; right: number; bottom: number };

export type PageProbe<T> = {
  // The IntersectionObserver result: the target shows inside every scrolling box that holds it.
  is_intersecting: (target: T) => boolean;
  // Position in the viewport of the document that holds the target, and the size of the part a click can reach (without scrollbars).
  // One box per line a wrapped link covers; the bounding box when there are none.
  rects_of: (target: T) => Rect[];
  // The visible boxes of every scrolling ancestor, in the same coordinates as `rects_of`. A point outside one of them is clipped away, so it cannot hit the target.
  clips_of: (target: T) => Rect[];
  viewport_of: (target: T) => { width: number; height: number };
  is_hidden_by_style: (target: T) => boolean;
  // Whether the topmost thing at the point is the target, inside it or around it.
  is_reachable_at: (target: T, x: number, y: number) => boolean;
};

// The middle of the part of the box that is on screen, or undefined when none of it is.
export function visible_point(rect: Rect, viewport: { width: number; height: number }): { x: number; y: number } | undefined {
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, viewport.width);
  const bottom = Math.min(rect.bottom, viewport.height);
  if (right <= left || bottom <= top) return undefined;
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

const MAX_LINE_BOXES = 4;
const CORNER_INSET = 2;

// The points to try for one link, cheapest and likeliest first: the middle of each line box, then the corners of the first box.
// At most MAX_LINE_BOXES + 4 points, so a page with thousands of links stays fast. One middle point alone misses a wrapped link (its middle lands on plain text) and an item part covered by a sticky header.
export function points_to_probe(rects: readonly Rect[], viewport: { width: number; height: number }): { x: number; y: number }[] {
  // Cap after dropping off-screen boxes, so a long wrapped link that starts above the screen keeps its visible lines.
  const shown = rects
    .flatMap((rect) => {
      const middle = visible_point(rect, viewport);
      return middle === undefined ? [] : [{ rect, middle }];
    })
    .slice(0, MAX_LINE_BOXES);
  const points = shown.map((entry) => entry.middle);
  const first = shown[0]?.rect;
  if (first === undefined) return points;
  const left = Math.max(first.left, 0);
  const top = Math.max(first.top, 0);
  const right = Math.min(first.right, viewport.width);
  const bottom = Math.min(first.bottom, viewport.height);
  const inset_x = Math.min(CORNER_INSET, (right - left) / 2);
  const inset_y = Math.min(CORNER_INSET, (bottom - top) / 2);
  for (const x of [left + inset_x, right - inset_x]) {
    for (const y of [top + inset_y, bottom - inset_y]) points.push({ x, y });
  }
  return points;
}

type Sized = { clientWidth: number; clientHeight: number };

// The click-reachable size, without a classic scrollbar. In quirks mode the viewport is the body's client box, since the root's is the page height.
export function viewport_size(
  doc: { compatMode: string; documentElement: Sized; body: Sized | null },
  win: { innerWidth: number; innerHeight: number },
): { width: number; height: number } {
  const box = doc.compatMode === "BackCompat" && doc.body !== null ? doc.body : doc.documentElement;
  return { width: box.clientWidth || win.innerWidth, height: box.clientHeight || win.innerHeight };
}

const has_area = (rect: Rect) => rect.right > rect.left && rect.bottom > rect.top;

export function clip_to(rect: Rect, clips: readonly Rect[]): Rect {
  return clips.reduce((r, c) => ({ left: Math.max(r.left, c.left), top: Math.max(r.top, c.top), right: Math.min(r.right, c.right), bottom: Math.min(r.bottom, c.bottom) }), rect);
}

const MAX_FALLBACK_DEPTH = 3;
const MAX_FALLBACK_CHILDREN = 20;

// The elements that own the boxes of an element: itself, or when it has no box with an area (`display: contents`, a wrapper of floats), its children's owners.
// An IntersectionObserver reports nothing for a `display: contents` element, so the observer has to watch these instead.
export function box_owners<T>(element: T, rects: (e: T) => Rect[], children: (e: T) => T[], depth = MAX_FALLBACK_DEPTH): T[] {
  if (rects(element).some(has_area) || depth === 0) return [element];
  return children(element).slice(0, MAX_FALLBACK_CHILDREN).flatMap((child) => box_owners(child, rects, children, depth - 1));
}

export function boxes_with_fallback<T>(element: T, rects: (e: T) => Rect[], children: (e: T) => T[]): Rect[] {
  return box_owners(element, rects, children).flatMap((owner) => rects(owner).filter(has_area));
}

type Ancestor = { position: string; clips_x: boolean; clips_y: boolean; box: Rect };

// The boxes that clip a target, from its chain of ancestors (nearest first, each with its computed position, the axes its overflow clips, and its visible box).
// A box clips only the axes that its overflow clips. An absolutely positioned target escapes the clip of ancestors above it until its containing block, and a fixed one escapes them all.
export function clipping_boxes(own_position: string, ancestors: readonly Ancestor[]): Rect[] {
  if (own_position === "fixed") return [];
  let escaping = own_position === "absolute";
  const boxes: Rect[] = [];
  for (const ancestor of ancestors) {
    if (escaping && ancestor.position === "static") continue;
    escaping = false;
    if (!ancestor.clips_x && !ancestor.clips_y) continue;
    const { box } = ancestor;
    boxes.push({
      left: ancestor.clips_x ? box.left : -Infinity,
      right: ancestor.clips_x ? box.right : Infinity,
      top: ancestor.clips_y ? box.top : -Infinity,
      bottom: ancestor.clips_y ? box.bottom : Infinity,
    });
  }
  return boxes;
}

// Page reads behind `scroll_clips_of`, so tests run on fake elements.
export type ClipReads<T> = {
  parent_of: (element: T) => T | null;
  tag_of: (element: T) => string;
  style_of: (element: T) => { position: string; display: string; overflow_x: string; overflow_y: string };
  // The padding box, which is what an overflow clips to.
  box_of: (element: T) => Rect;
};

// A body or root overflow goes to the viewport, which the probe already clips to. An inline or `contents` box has no client box of its own to clip to.
const CANNOT_CLIP_TAGS = new Set(["body", "html"]);
const CANNOT_CLIP_DISPLAYS = new Set(["inline", "contents"]);

export function scroll_clips_of<T>(element: T, reads: ClipReads<T>): Rect[] {
  const ancestors: Ancestor[] = [];
  for (let up = reads.parent_of(element); up !== null; up = reads.parent_of(up)) {
    if (CANNOT_CLIP_TAGS.has(reads.tag_of(up))) continue;
    const style = reads.style_of(up);
    const can_clip = !CANNOT_CLIP_DISPLAYS.has(style.display);
    const clips_x = can_clip && style.overflow_x !== "visible";
    const clips_y = can_clip && style.overflow_y !== "visible";
    ancestors.push({ position: style.position, clips_x, clips_y, box: clips_x || clips_y ? reads.box_of(up) : { left: 0, top: 0, right: 0, bottom: 0 } });
  }
  return clipping_boxes(reads.style_of(element).position, ancestors);
}

export function keep_visible<T>(targets: readonly T[], probe: PageProbe<T>): T[] {
  return targets.filter((target) => {
    if (!probe.is_intersecting(target) || probe.is_hidden_by_style(target)) return false;
    const clips = probe.clips_of(target);
    const rects = probe.rects_of(target).map((rect) => clip_to(rect, clips)).filter(has_area);
    const points = points_to_probe(rects, probe.viewport_of(target));
    return points.some((point) => probe.is_reachable_at(target, point.x, point.y));
  });
}

type Climbable = { parentNode: unknown; host?: unknown };

// Walks up through shadow roots, which a plain `contains` does not cross.
export function contains_composed(ancestor: unknown, node: unknown): boolean {
  for (let current = node as Climbable | null; current; current = (current.parentNode ?? current.host) as Climbable | null) {
    if (current === ancestor) return true;
  }
  return false;
}

type Topmost = { ownerDocument: { elementFromPoint: (x: number, y: number) => unknown } };
type FrameBox = Topmost & { getBoundingClientRect: () => Rect; clientLeft: number; clientTop: number };

// The page test at the point, repeated in each parent document: the element, then its innermost frame, out to the outermost.
// Each frame is tested as a whole, since the parent cannot see inside it.
export function uncovered_through_frames(found: { element: Topmost; frames: readonly FrameBox[] }, x: number, y: number): boolean {
  let target: Topmost = found.element;
  let point = { x, y };
  for (let depth = found.frames.length; depth >= 0; depth--) {
    const top = target.ownerDocument.elementFromPoint(point.x, point.y);
    if (top !== null && !contains_composed(target, top) && !contains_composed(top, target)) return false;
    if (depth === 0) return true;
    const frame = found.frames[depth - 1]!;
    const box = frame.getBoundingClientRect();
    point = { x: point.x + box.left + frame.clientLeft, y: point.y + box.top + frame.clientTop };
    target = frame;
  }
  return true;
}
