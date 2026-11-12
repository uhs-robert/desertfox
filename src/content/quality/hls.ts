// The hls.js driver: a site player that keeps its hls.js instance on the page global `html5player.hlsobj`. The hls.js level API is public and stable. The handle name is the site's own and can change.

import type { Driver, PlayerLevel } from "./driver.ts";
import { copy_of } from "./driver.ts";

type Hls = { levels?: unknown; url?: unknown; loadLevel?: number; nextLevel?: number };

export type HlsPage = { html5player?: { hlsobj?: Hls } };

export function hls_driver(page: HlsPage): Driver | undefined {
  const hls = page.html5player?.hlsobj;
  if (typeof (hls?.levels as { length?: unknown } | undefined)?.length !== "number") return undefined;

  // The level index 0 is the lowest. `nextLevel` only: a write to `currentLevel` flushes the buffer and pauses the media, and the switch then applies from the next fragment.
  const handle = hls as Hls;
  const switch_to = (index: number): void => {
    handle.nextLevel = index;
  };

  return {
    // `loadLevel` is the level being loaded. `currentLevel` reads -1 until a fragment is buffered, so a poll that waited on it would switch again and again.
    levels: () =>
      (copy_of(handle.levels) as { height?: unknown }[])
        .flatMap((level, index): PlayerLevel[] =>
        typeof level.height === "number" && Number.isFinite(level.height) && level.height > 0 ? [{ height: level.height, label: `${level.height}p`, active: handle.loadLevel === index, pick: () => switch_to(index) }] : [],
        )
        .sort((a, b) => a.height - b.height),
    auto: () => (switch_to(-1), true),
    // The address hls.js loaded, which changes with the video.
    video_id: () => (typeof handle.url === "string" ? handle.url : undefined),
    // The site offers a related list, not a next or previous video.
    skip: () => false,
  };
}
