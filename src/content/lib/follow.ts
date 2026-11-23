// Repositions the labels on the next animation frame after any scroll or resize in the given windows.

export function follow_windows(windows: Window[], reposition: () => void): () => void {
  let frame_requested = false;
  const on_change = () => {
    if (frame_requested) return;
    frame_requested = true;
    requestAnimationFrame(() => {
      frame_requested = false;
      reposition();
    });
  };
  for (const win of windows) {
    win.addEventListener("scroll", on_change, { capture: true, passive: true });
    win.addEventListener("resize", on_change, { passive: true });
  }
  return () => {
    for (const win of windows) {
      win.removeEventListener("scroll", on_change, true);
      win.removeEventListener("resize", on_change);
    }
  };
}
