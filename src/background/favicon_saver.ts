// Saves a 32x32 copy of each visited site's icon for the new tab page. Firefox hands the background every tab icon as a data: image (any size or format), so nothing here makes a request. The page then reads only the small copies.
import { FAVICON_CACHE_MAX_ENTRIES, FAVICON_ENTRY_MAX_CHARS, FAVICON_SIZE, site_host, type FaviconCache } from "../newtab/icon_cache.ts";

// An input larger than this is not worth decoding for a 32px tile.
const MAX_SOURCE_CHARS = 512 * 1024;
// A host that changes its icon all the time (an unread count, a timer) is saved at most once per window. The skipped events are not queued: the next event after the window saves the icon it carries.
const THROTTLE_MS = 3 * 60 * 1000;
const FAILED_MAX_HOSTS = 100;

export type SaverTab = { url: string | undefined; icon: string | undefined; incognito: boolean };

// Returns a PNG data: URL, or throws.
export type IconRedraw = (source: string) => Promise<string>;

// A short stand-in for the source string: the length and a 32-bit hash. It tells an unchanged icon from a changed one without keeping the string.
export function source_key(source: string): string {
  let hash = 5381;
  for (let index = 0; index < source.length; index++) hash = ((hash << 5) + hash + source.charCodeAt(index)) | 0;
  return `${source.length}:${(hash >>> 0).toString(36)}`;
}

// Cheap checks only, with no storage read: a private tab, a non-web page and an icon that is not a data: image all stop here.
function eligible(tab: SaverTab): { host: string; source: string } | undefined {
  if (tab.incognito || !tab.url || !tab.icon || !/^https?:\/\//i.test(tab.url)) return undefined;
  if (!/^data:image\//i.test(tab.icon) || tab.icon.length > MAX_SOURCE_CHARS) return undefined;
  const host = site_host(tab.url);
  return host ? { host, source: tab.icon } : undefined;
}

export function make_favicon_saver(cache: FaviconCache, redraw: IconRedraw, now: () => number = Date.now) {
  // host -> source key of its stored entry, in the order of the stored list and capped like it. Loaded from storage once, so a busy page costs no read per event. Memory only.
  const stored_keys = new Map<string, string>();
  // host -> source key of an icon that failed to redraw, so it is not tried again until the icon changes.
  const failed = new Map<string, string>();
  // host -> when its last redraw started, for the throttle.
  const last_start = new Map<string, number>();
  const in_flight = new Set<string>();
  let loaded: Promise<void> | undefined;

  const remember = (map: Map<string, string | number>, host: string, value: string | number, cap: number) => {
    map.delete(host);
    map.set(host, value);
    if (map.size > cap) map.delete(map.keys().next().value!);
  };
  const load_once = (started_in: number) => {
    loaded ??= cache.sources().then((entries) => {
      // A clear that ran meanwhile emptied the cache, so what was read is stale.
      if (started_in !== cache.generation()) return;
      for (const [host, key] of entries) stored_keys.set(host, key);
    });
    return loaded;
  };

  const save = async (host: string, source: string, key: string, started_in: number) => {
    let icon: string;
    try {
      icon = await redraw(source);
    } catch {
      if (started_in === cache.generation()) remember(failed, host, key, FAILED_MAX_HOSTS);
      return;
    }
    await cache.save({ host, icon, source: key }, started_in);
    if (started_in === cache.generation()) remember(stored_keys, host, key, FAVICON_CACHE_MAX_ENTRIES);
  };

  return {
    // Called for every finished load and icon change. Resolves when the work for this event is done.
    on_tab: async (tab: SaverTab): Promise<void> => {
      const found = eligible(tab);
      if (!found) return;
      const { host, source } = found;
      const started_in = cache.generation();
      await load_once(started_in);
      const key = source_key(source);
      if (started_in !== cache.generation() || stored_keys.get(host) === key || failed.get(host) === key) return;
      const started = last_start.get(host);
      if (started !== undefined && now() - started < THROTTLE_MS) return;
      const flight = `${started_in}:${host}`;
      if (in_flight.has(flight)) return;
      in_flight.add(flight);
      remember(last_start, host, now(), FAVICON_CACHE_MAX_ENTRIES);
      try {
        await save(host, source, key, started_in);
      } finally {
        in_flight.delete(flight);
      }
    },
    clear: () => {
      stored_keys.clear();
      failed.clear();
      last_start.clear();
      loaded = Promise.resolve();
      return cache.clear();
    },
  };
}

export type FaviconSaver = ReturnType<typeof make_favicon_saver>;

// The browser part: decode the data: image and redraw it at 32x32, centered with its aspect kept.
export const redraw_icon_png: IconRedraw = async (source) => {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = FAVICON_SIZE;
  canvas.height = FAVICON_SIZE;
  const wide = image.naturalWidth || FAVICON_SIZE;
  const high = image.naturalHeight || FAVICON_SIZE;
  const scale = Math.min(FAVICON_SIZE / wide, FAVICON_SIZE / high);
  const width = wide * scale;
  const height = high * scale;
  canvas.getContext("2d")!.drawImage(image, (FAVICON_SIZE - width) / 2, (FAVICON_SIZE - height) / 2, width, height);
  const png = canvas.toDataURL("image/png");
  if (png.length > FAVICON_ENTRY_MAX_CHARS) throw new Error("redrawn icon still too large");
  return png;
};
