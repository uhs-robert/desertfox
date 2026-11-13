// Matches hint labels to the coverage page's targets. Pure, so test/rivals_match_labels.test.ts covers it; framescript.js cannot import, so it sends raw rects and run.mjs matches in node.
// A label is a { left, top, width, height } rect, a target a { name, visible, rect } with a { left, top, right, bottom } rect.
const to_label = (label) => ({ x: label.left + label.width / 2, y: label.top + label.height / 2 });

// Targets are 60 px apart, so a limit under 30 px keeps a label from reaching the neighbour of its own target.
export const MAX_DISTANCE = 25;

const distance_to = (point, rect) => Math.hypot(Math.max(rect.left - point.x, 0, point.x - rect.right), Math.max(rect.top - point.y, 0, point.y - rect.bottom));

// Returns the names of the labelled targets, the labels beyond the first on one target (duplicates) and the labels near no target (stray).
// A non-zero duplicates or stray count means the label count and the labelled-target count disagree, so the credit cannot be trusted.
export function match_labels(labels, targets) {
  const labelled = new Set();
  let duplicates = 0;
  let stray = 0;
  for (const label of labels) {
    const point = to_label(label);
    let nearest = null;
    let nearest_distance = Infinity;
    for (const target of targets) {
      const distance = distance_to(point, target.rect);
      if (distance < nearest_distance) { nearest = target; nearest_distance = distance; }
    }
    if (nearest === null || nearest_distance > MAX_DISTANCE) stray++;
    else if (labelled.has(nearest.name)) duplicates++;
    else labelled.add(nearest.name);
  }
  return { labelled: [...labelled], duplicates, stray };
}
