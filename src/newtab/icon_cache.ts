import { keep_chain } from "../shared/swallow.ts";

// Site icons for the cards, kept in `storage.local` so the page loads no remote icon. Each is a 32x32 PNG data: URL that the background redraws from the tab icon (`background/favicon_saver.ts`).
export const FAVICON_CACHE_KEY = "favicon_cache";
export const FAVICON_SIZE = 32;
// A 32x32 PNG is at most about 4.2 KB of bytes even as noise, which is under 5.7k characters of base64 with the prefix, so 6144 leaves room. At 200 hosts the whole cache is under 1.3 MB of the 5 MB `storage.local` quota.
export const FAVICON_ENTRY_MAX_CHARS = 6144;
export const FAVICON_CACHE_MAX_ENTRIES = 200;

// `source` is a short key of the tab icon the PNG was redrawn from, so an unchanged icon is not redrawn. The list is in save order, oldest first, so the front is what the cap drops.
export type FaviconEntry = { host: string; icon: string; source: string };

export function site_host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function cacheable_icon(icon: string | undefined): icon is string {
  return !!icon && /^data:image\//i.test(icon) && icon.length <= FAVICON_ENTRY_MAX_CHARS;
}

// The same list when the host already holds this icon from this source, so the caller can skip the write.
export function with_icon(entries: readonly FaviconEntry[], next: FaviconEntry): readonly FaviconEntry[] {
  if (!next.host || !cacheable_icon(next.icon)) return entries;
  if (entries.some((entry) => entry.host === next.host && entry.icon === next.icon && entry.source === next.source)) return entries;
  return [...entries.filter((entry) => entry.host !== next.host), next].slice(-FAVICON_CACHE_MAX_ENTRIES);
}

export function icons_by_host(stored: unknown): Map<string, string> {
  const found = new Map<string, string>();
  if (!Array.isArray(stored)) return found;
  for (const entry of stored as Partial<FaviconEntry>[]) {
    if (typeof entry?.host === "string" && cacheable_icon(entry.icon)) found.set(entry.host, entry.icon);
  }
  return found;
}

type CacheStorage = { get: (key: string) => Promise<Record<string, unknown>>; set: (items: Record<string, unknown>) => Promise<void>; remove: (key: string) => Promise<void> };

export function make_favicon_cache(storage: CacheStorage, warn: (message: string, error: unknown) => void = (message, error) => console.warn(message, error)) {
  // Writes queue, so two saves that finish together do not overwrite each other's read.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = keep_chain(run);
    return run;
  };
  // Each clear starts a new generation. A save carries the generation it began in, and a save from before a clear is dropped, so a fetch that finishes late cannot bring the data back.
  let generation = 0;
  let warned_full = false;
  const stored = async () => {
    const value = (await storage.get(FAVICON_CACHE_KEY))[FAVICON_CACHE_KEY];
    return Array.isArray(value) ? (value as FaviconEntry[]) : [];
  };
  return {
    read: async () => icons_by_host(await stored()),
    entry_for: async (host: string) => (await stored()).find((entry) => entry.host === host),
    generation: () => generation,
    // A full storage warns once until a write succeeds again, because every page load would repeat it.
    save: (entry: FaviconEntry, started_in: number) =>
      enqueue(async () => {
        if (started_in !== generation) return;
        const before = await stored();
        const after = with_icon(before, entry);
        if (after === before) return;
        try {
          await storage.set({ [FAVICON_CACHE_KEY]: after });
          warned_full = false;
        } catch (error) {
          if (!warned_full) warn("desertfox: favicon_cache.save (storage full?)", error);
          warned_full = true;
        }
      }),
    clear: () => {
      generation++;
      return enqueue(() => storage.remove(FAVICON_CACHE_KEY));
    },
  };
}

export type FaviconCache = ReturnType<typeof make_favicon_cache>;
