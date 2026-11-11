// The element that goes fullscreen for a media element. The hint action `fullscreen` and the `media` command share it, so both keep a site player's controls.

const SAME_SIZE_PX = 1;

type Climbable = { parentElement: Element | null; parentNode: unknown };

// A custom player keeps its video in a shadow root, so the climb steps from the root to its host.
export const parent_across_shadow = (element: Climbable): Element | null => element.parentElement ?? (element.parentNode as { host?: Element } | null)?.host ?? null;

// The outermost ancestor that is as big as the media element, so a site player keeps its controls and subtitles in fullscreen. The page body is never a player box.
export function player_box(media: Element): Element {
  const size = media.getBoundingClientRect();
  let box = media;
  for (let up = parent_across_shadow(media); up && up !== up.ownerDocument.body && up !== up.ownerDocument.documentElement; up = parent_across_shadow(up)) {
    const outer = up.getBoundingClientRect();
    if (Math.abs(outer.width - size.width) > SAME_SIZE_PX || Math.abs(outer.height - size.height) > SAME_SIZE_PX) break;
    box = up;
  }
  return box;
}
