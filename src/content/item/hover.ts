// The pointer events a real mouse sends when it rests on an item and leaves it, so a page's hover effect (a video preview on a thumbnail tile) starts. The events are untrusted, which the pages measured do not check. Pages bind different ones (a native mouseover, a mouseenter on each ancestor), so it sends the whole sequence of a browser at one point inside the item, through the sender the hover pick shares (`../pointer_events.ts`). It sends no press, click or move.

import { center_of, enter_events, leave_events } from "../pointer_events.ts";

// A thumbnail is a picture at least this wide. A favicon or an avatar beside a text result is none, so a result with only text gets no hover card opened.
const THUMBNAIL_MIN_PX = 96;

export const thumbnail = (item: Element) => Array.from(item.querySelectorAll<HTMLElement>("img, video")).find((media) => media.offsetWidth >= THUMBNAIL_MIN_PX);

// Hovers the item's thumbnail, else the item, at its centre, and returns the function that unhovers it.
export function hover_at(item: Element): () => void {
  const media = thumbnail(item) ?? item;
  enter_events(media, undefined, center_of(media));
  return () => {
    if (!media.isConnected) return;
    // The page has scrolled since, so the point is read again. The thumbnail always gets its exit, whatever is at the point now. A page often swaps a layer in under the point once the hover starts (a preview), and that layer is left as well when it lies in the item.
    const at = center_of(media);
    const found = document.elementFromPoint(at.x, at.y);
    const layer = found && found !== media && item.contains(found) ? found : undefined;
    leave_events({ element_: media, at_: at }, layer);
    if (layer) leave_events({ element_: layer, at_: at }, undefined);
  };
}
