// The YouTube driver: the `#movie_player` element carries an unofficial quality API on the page's own object. The public iframe API dropped these calls in 2019, the player on youtube.com still answers them.

import type { Driver, PlayerLevel, PlayerVolume } from "./driver.ts";
import { copy_of } from "./driver.ts";

type Quality = { quality?: unknown; qualityLabel?: unknown; isPlayable?: unknown };

type MoviePlayer = {
  getAvailableQualityLevels?: () => unknown;
  getAvailableQualityData?: () => unknown;
  getPlaybackQuality?: () => unknown;
  setPlaybackQualityRange?: (low: string, high: string) => void;
  setPlaybackQuality?: (quality: string) => void;
  getVideoData?: () => unknown;
  nextVideo?: () => void;
  previousVideo?: () => void;
  toggleSubtitles?: () => void;
  getOption?: (module: string, option: string) => unknown;
  getVolume?: () => unknown;
  setVolume?: (volume: number) => void;
};

export type YouTubePage = { document: { getElementById: (id: string) => unknown } };

// The player's own names, by height.
const HEIGHTS: Readonly<Record<string, number>> = { tiny: 144, small: 240, medium: 360, large: 480, hd720: 720, hd1080: 1080, hd1440: 1440, hd2160: 2160, hd2880: 2880, highres: 4320 };

// The player's own volume, 0 to 100. A write to the video element is put back by the player, so the volume goes through the player. Undefined when the page has no player with both calls.
export function youtube_volume(page: YouTubePage): PlayerVolume | undefined {
  const player = page.document.getElementById("movie_player") as MoviePlayer | null;
  if (typeof player?.getVolume !== "function" || typeof player.setVolume !== "function") return undefined;
  return {
    get: () => {
      const volume = player.getVolume?.();
      return typeof volume === "number" && Number.isFinite(volume) ? volume : undefined;
    },
    set: (volume) => player.setVolume?.(volume),
  };
}

export function youtube_driver(page: YouTubePage): Driver | undefined {
  const player = page.document.getElementById("movie_player") as MoviePlayer | null;
  if (typeof player?.getAvailableQualityLevels !== "function") return undefined;

  const levels = (): PlayerLevel[] => {
    // The player answers "unknown" until it plays, and has no levels to pick before then.
    const playing = player.getPlaybackQuality?.();
    if (playing === "unknown") return [];
    const found = new Map<string, PlayerLevel>();
    // The data lists the best level first and may list a Premium twin of a level under the same code, which a level pick cannot tell apart. The plain one stays.
    const data = player.getAvailableQualityData ? copy_of(player.getAvailableQualityData()) : copy_of(player.getAvailableQualityLevels?.()).map((quality) => ({ quality }));
    for (const entry of data as Quality[]) {
      if (typeof entry !== "object" || entry === null) continue;
      const code = String(entry.quality);
      // An own-property read: a page code of `constructor` is no level.
      const height = Object.hasOwn(HEIGHTS, code) ? HEIGHTS[code] : undefined;
      if (height === undefined || entry.isPlayable === false) continue;
      const label = typeof entry.qualityLabel === "string" ? entry.qualityLabel : `${height}p`;
      if (found.has(code) && label.includes("Premium")) continue;
      found.set(code, { height, label, active: code === playing, pick: () => set_range(code, code) });
    }
    return [...found.values()].sort((a, b) => a.height - b.height);
  };

  // The range call is the one that holds. The single-level call is the older name, for a player without it.
  const set_range = (low: string, high: string): void => {
    if (player.setPlaybackQualityRange) player.setPlaybackQualityRange(low, high);
    else player.setPlaybackQuality?.(high);
  };

  const code_of = (level: PlayerLevel): string => Object.keys(HEIGHTS).find((code) => HEIGHTS[code] === level.height) as string;

  return {
    levels,
    auto: () => {
      const all = levels();
      if (all.length === 0) return false;
      set_range(code_of(all[0]!), code_of(all[all.length - 1]!));
      return true;
    },
    video_id: () => {
      const id = (player.getVideoData?.() as { video_id?: unknown } | undefined)?.video_id;
      return typeof id === "string" ? id : undefined;
    },
    // Unofficial and unverified on the current site: a player without the call refuses.
    toggle_captions: () => {
      if (typeof player.toggleSubtitles !== "function") return undefined;
      player.toggleSubtitles();
      // An object with keys is a chosen track, an empty one means off. Anything else (no call, no answer) leaves the state unsaid.
      const track = player.getOption?.("captions", "track");
      return typeof track === "object" && track !== null ? { on: Object.keys(track).length > 0 } : {};
    },
    skip: (forward) => {
      const go = forward ? player.nextVideo : player.previousVideo;
      if (typeof go !== "function") return false;
      go.call(player);
      return true;
    },
  };
}
