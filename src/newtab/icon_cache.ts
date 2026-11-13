import { keep_chain } from "../shared/swallow.ts";

// Site icons for bookmark and link cards, kept in `storage.local` so the page needs no network. Only a data: icon is stored, because a stored https address would make the card fetch it.
export const FAVICON_CACHE_KEY = "favicon_cache";
export const FAVICON_CACHE_MAX_ENTRIES = 200;
export const FAVICON_MAX_CHARS = 2048;

// Oldest entry first. A site that loads again moves to the end, so the front is what the cap drops.
export type FaviconEntry = { host: string; icon: string };

export function site_host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function cacheable_icon(icon: string | undefined): icon is string {
  return !!icon && /^data:image\//i.test(icon) && icon.length <= FAVICON_MAX_CHARS;
}

// A private tab, a non-web address or an icon that does not qualify changes nothing.
export function with_icon(entries: readonly FaviconEntry[], tab: { url: string | undefined; icon: string | undefined; incognito: boolean }): readonly FaviconEntry[] {
  if (tab.incognito || !tab.url || !/^https?:\/\//i.test(tab.url) || !cacheable_icon(tab.icon)) return entries;
  const host = site_host(tab.url);
  if (!host) return entries;
  return [...entries.filter((entry) => entry.host !== host), { host, icon: tab.icon }].slice(-FAVICON_CACHE_MAX_ENTRIES);
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

export function make_favicon_cache(storage: CacheStorage) {
  // Writes queue, so two tabs that finish together do not overwrite each other's read.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = keep_chain(run);
    return run;
  };
  const stored = async () => {
    const value = (await storage.get(FAVICON_CACHE_KEY))[FAVICON_CACHE_KEY];
    return Array.isArray(value) ? (value as FaviconEntry[]) : [];
  };
  return {
    read: async () => icons_by_host(await stored()),
    store: (tab: { url: string | undefined; icon: string | undefined; incognito: boolean }) =>
      enqueue(async () => {
        const before = await stored();
        const after = with_icon(before, tab);
        if (after !== before) await storage.set({ [FAVICON_CACHE_KEY]: after });
      }),
    clear: () => enqueue(() => storage.remove(FAVICON_CACHE_KEY)),
  };
}

export type FaviconCache = ReturnType<typeof make_favicon_cache>;
