// The hls.js driver: a site player that keeps its hls.js instance on the page global `html5player.hlsobj`. The hls.js level API is public and stable. The handle name is the site's own and can change.

import type { Driver, PlayerLevel } from "./driver.ts";
import { copy_of } from "./driver.ts";

type Hls = { levels?: unknown; currentLevel?: number; nextLevel?: number };

export type HlsPage = { html5player?: { hlsobj?: Hls } };

export function hls_driver(page: HlsPage): Driver | undefined {
  const hls = page.html5player?.hlsobj;
  if (typeof (hls?.levels as { length?: unknown } | undefined)?.length !== "number") return undefined;

  // The level index 0 is the lowest. Both calls: `currentLevel` switches now, `nextLevel` keeps the choice for the next fragment.
  const handle = hls as Hls;
  const switch_to = (index: number): void => {
    handle.currentLevel = index;
    handle.nextLevel = index;
  };

  return {
    levels: () =>
      (copy_of(handle.levels) as { height?: unknown }[])
        .flatMap((level, index): PlayerLevel[] =>
        typeof level.height === "number" && Number.isFinite(level.height) && level.height > 0 ? [{ height: level.height, label: `${level.height}p`, active: handle.currentLevel === index, pick: () => switch_to(index) }] : [],
        )
        .sort((a, b) => a.height - b.height),
    auto: () => (switch_to(-1), true),
    // The site offers a related list, not a next or previous video.
    skip: () => false,
  };
}
