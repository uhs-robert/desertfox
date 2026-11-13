// The top frame draws the panel for a subframe. Each draw and erase carries the sender's frame and a count, and a message that arrives after a newer one from the same frame is dropped, so a slow draw never repaints a panel that was already erased.

export function create_arrival_guard(): (from_frame: unknown, seq: unknown) => boolean {
  const newest = new Map<unknown, number>();
  return (from_frame, seq) => {
    if (typeof seq !== "number") return false;
    if (seq <= (newest.get(from_frame) ?? 0)) return false;
    newest.set(from_frame, seq);
    return true;
  };
}
