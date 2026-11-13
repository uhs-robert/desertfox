// Saves a 32x32 copy of each visited site's icon for the new tab page. Fetching happens here, once per site, so the page itself never loads a remote icon.
import { FAVICON_ENTRY_MAX_CHARS, FAVICON_SIZE, site_host, type FaviconCache } from "../newtab/icon_cache.ts";

const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
// A failed fetch is not tried again for this long, so a broken icon address costs one request an hour and not one per page event.
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
const MAX_SOURCE_CHARS = 2048;
const MAX_DOWNLOAD_BYTES = 512 * 1024;

export type SaverLimits = { concurrent: number; timeout_ms: number };
export const DEFAULT_LIMITS: SaverLimits = { concurrent: 3, timeout_ms: 8000 };

export type SaverTab = { url: string | undefined; icon: string | undefined; incognito: boolean };

// Returns a PNG data: URL, or throws. It must stop reading when `signal` aborts.
export type IconFetcher = (source: string, signal: AbortSignal) => Promise<string>;

// Cheap checks only, with no storage read: a private tab, a non-web page and an icon of a kind we cannot save all stop here.
function eligible(tab: SaverTab): { host: string; source: string } | undefined {
  if (tab.incognito || !tab.url || !tab.icon || !/^https?:\/\//i.test(tab.url)) return undefined;
  const host = site_host(tab.url);
  if (!host) return undefined;
  const is_data = /^data:image\//i.test(tab.icon) && tab.icon.length <= FAVICON_ENTRY_MAX_CHARS;
  const is_remote = /^https?:\/\//i.test(tab.icon) && tab.icon.length <= MAX_SOURCE_CHARS;
  return is_data || is_remote ? { host, source: tab.icon } : undefined;
}

export function make_favicon_saver(cache: FaviconCache, fetch_icon: IconFetcher, now: () => number = Date.now, limits: SaverLimits = DEFAULT_LIMITS) {
  // host -> the source last handled and when to look at it again. It spares the storage read on the repeat events of a busy page.
  const handled = new Map<string, { source: string; until: number }>();
  const in_flight = new Set<string>();
  const waiting: (() => void)[] = [];
  let running = 0;

  const take_slot = async () => {
    if (running >= limits.concurrent) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
  };
  const give_slot = () => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };

  const fetch_with_timeout = async (source: string): Promise<string> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timed_out = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("favicon fetch timed out"));
      }, limits.timeout_ms);
    });
    try {
      return await Promise.race([fetch_icon(source, controller.signal), timed_out]);
    } finally {
      clearTimeout(timer);
    }
  };

  const save = async (host: string, source: string, started_in: number) => {
    const known = await cache.entry_for(host);
    const is_data = source.startsWith("data:");
    if (known && (is_data ? known.icon === source : known.source === source && now() - known.at < FRESH_MS)) {
      if (!is_data) handled.set(host, { source, until: known.at + FRESH_MS });
      return;
    }
    let icon = source;
    if (!is_data) {
      await take_slot();
      try {
        icon = await fetch_with_timeout(source);
      } catch {
        if (started_in === cache.generation()) handled.set(host, { source, until: now() + RETRY_AFTER_FAILURE_MS });
        return;
      } finally {
        give_slot();
      }
    }
    await cache.save({ host, icon, source: is_data ? "data:" : source, at: now() }, started_in);
    // A fetch that finished after a clear must not mark the host as done.
    if (!is_data && started_in === cache.generation()) handled.set(host, { source, until: now() + FRESH_MS });
  };

  return {
    // Called for every finished load and icon change. Resolves when the work for this event is done.
    on_tab: async (tab: SaverTab): Promise<void> => {
      const found = eligible(tab);
      if (!found) return;
      const { host, source } = found;
      const seen = handled.get(host);
      if (seen && seen.source === source && now() < seen.until && !source.startsWith("data:")) return;
      const started_in = cache.generation();
      const key = `${started_in}:${host}`;
      if (in_flight.has(key)) return;
      in_flight.add(key);
      try {
        await save(host, source, started_in);
      } finally {
        in_flight.delete(key);
      }
    },
    clear: () => {
      handled.clear();
      return cache.clear();
    },
  };
}

export type FaviconSaver = ReturnType<typeof make_favicon_saver>;

// The browser part: fetch from Firefox's HTTP cache where it can, with no cookies, and redraw at 32x32.
export const fetch_icon_png: IconFetcher = async (source, signal) => {
  const response = await fetch(source, { cache: "force-cache", credentials: "omit", referrerPolicy: "no-referrer", signal });
  if (!response.ok) throw new Error(`favicon status ${response.status}`);
  if (!/^image\//i.test(response.headers.get("content-type") ?? "")) throw new Error("favicon is not an image");
  if (Number(response.headers.get("content-length") ?? 0) > MAX_DOWNLOAD_BYTES) throw new Error("favicon too large");
  const blob = await response.blob();
  if (blob.size > MAX_DOWNLOAD_BYTES) throw new Error("favicon too large");
  const object_url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = object_url;
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
    if (png.length > FAVICON_ENTRY_MAX_CHARS) throw new Error("favicon still too large");
    return png;
  } finally {
    URL.revokeObjectURL(object_url);
  }
};
