// Keeps the candidates a person can see and click. Every page read goes through `PageProbe`, so the rules run on a fake page in tests.

export type Rect = { left: number; top: number; right: number; bottom: number };

export type PageProbe<T> = {
  // The IntersectionObserver result: the target shows inside every scrolling box that holds it.
  is_intersecting: (target: T) => boolean;
  // Position in the viewport of the document that holds the target, and the size of the part a click can reach (without scrollbars).
  // One box per line a wrapped link covers; the bounding box when there are none.
  rects_of: (target: T) => Rect[];
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

export function keep_visible<T>(targets: readonly T[], probe: PageProbe<T>): T[] {
  return targets.filter((target) => {
    if (!probe.is_intersecting(target) || probe.is_hidden_by_style(target)) return false;
    const points = points_to_probe(probe.rects_of(target), probe.viewport_of(target));
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
