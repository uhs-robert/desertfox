// A reply kept in `storage.local` for a short time, so opening tabs in a row asks a service once.
export const CACHE_TTL_MS = 5 * 60 * 1000;

export type CacheArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type Entry<T> = { at: number; params: string; value: T };

// `params` names what the reply answers, such as the coordinates and units: a changed setting must not read an older answer.
// A failed fetch (null) is neither cached nor shown, so the next tab tries again.
export async function cached<T>(area: CacheArea, key: string, params: string, now: number, fetch_value: () => Promise<T | null>): Promise<T | null> {
  const stored: Record<string, unknown> = await area.get(key).catch(() => ({}));
  const entry = stored[key] as Entry<T> | undefined;
  if (entry && entry.params === params && now - entry.at >= 0 && now - entry.at < CACHE_TTL_MS) return entry.value;
  const value = await fetch_value();
  if (value === null) return null;
  await area.set({ [key]: { at: now, params, value } satisfies Entry<T> }).catch(() => {});
  return value;
}
