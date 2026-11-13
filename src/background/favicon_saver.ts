// Saves a 32x32 copy of each visited site's icon for the new tab page. Firefox hands the background every tab icon as a data: image (any size or format), so nothing here makes a request. The page then reads only the small copies.
import { FAVICON_ENTRY_MAX_CHARS, FAVICON_SIZE, site_host, type FaviconCache } from "../newtab/icon_cache.ts";

// An input larger than this is not worth decoding for a 32px tile.
const MAX_SOURCE_CHARS = 512 * 1024;
const HANDLED_MAX_HOSTS = 500;

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

export function make_favicon_saver(cache: FaviconCache, redraw: IconRedraw) {
  // host -> the key of the source last handled, a redraw that worked or one that failed, so neither repeats on the next event of a busy page. Memory only, and the oldest host drops at the cap.
  const handled = new Map<string, string>();
  const in_flight = new Set<string>();
  const mark_handled = (host: string, key: string, started_in: number) => {
    // A clear that ran meanwhile emptied the cache, so the host is not done.
    if (started_in !== cache.generation()) return;
    handled.delete(host);
    handled.set(host, key);
    if (handled.size > HANDLED_MAX_HOSTS) handled.delete(handled.keys().next().value!);
  };

  const save = async (host: string, source: string, started_in: number) => {
    const key = source_key(source);
    const known = await cache.entry_for(host);
    if (known?.source === key) return mark_handled(host, key, started_in);
    let icon: string | undefined;
    try {
      icon = await redraw(source);
    } catch {
      return mark_handled(host, key, started_in);
    }
    await cache.save({ host, icon, source: key }, started_in);
    mark_handled(host, key, started_in);
  };

  return {
    // Called for every finished load and icon change. Resolves when the work for this event is done.
    on_tab: async (tab: SaverTab): Promise<void> => {
      const found = eligible(tab);
      if (!found) return;
      const { host, source } = found;
      if (handled.get(host) === source_key(source)) return;
      const started_in = cache.generation();
      const flight = `${started_in}:${host}`;
      if (in_flight.has(flight)) return;
      in_flight.add(flight);
      try {
        await save(host, source, started_in);
      } finally {
        in_flight.delete(flight);
      }
    },
    clear: () => {
      handled.clear();
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
