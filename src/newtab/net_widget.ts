// The one way a new tab card reaches the network: a fetch with no credentials and a short timeout, and a result kept in `storage.local` so a reopened tab draws at once. A card calls this only after its own setting is on and the page is not private. Nothing here checks either, so the caller must.
// One storage key per card, so two cards that finish together never overwrite each other's answer.
export const net_cache_key = (name: string): string => `newtab_net_cache_${name}`;
export const NET_TIMEOUT_MS = 5000;

type StoredEntry = { key: string; at: number; value: unknown };

export type NetEnv = {
  fetch: typeof fetch;
  now: () => number;
  storage: { get: (key: string) => Promise<Record<string, unknown>>; set: (items: Record<string, unknown>) => Promise<void> };
};

export const browser_net_env = (): NetEnv => ({ fetch: (input, init) => fetch(input, init), now: Date.now, storage: browser.storage.local });

// The body text, or undefined on a network error, a timeout or a status that is not 2xx. A failure never throws, so a card that depends on it draws nothing.
export async function fetch_text(url: string, env: NetEnv): Promise<string | undefined> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), NET_TIMEOUT_MS);
  try {
    // `redirect: "error"` keeps a provider from bouncing the request to a host the settings text does not name.
    const response = await env.fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error", signal: abort.signal });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function read_entry(name: string, env: NetEnv): Promise<StoredEntry | undefined> {
  try {
    const entry = (await env.storage.get(net_cache_key(name)))[net_cache_key(name)] as StoredEntry | undefined;
    return entry && typeof entry.key === "string" && typeof entry.at === "number" ? entry : undefined;
  } catch {
    return undefined;
  }
}

async function write_entry(name: string, entry: StoredEntry, env: NetEnv): Promise<void> {
  try {
    await env.storage.set({ [net_cache_key(name)]: entry });
  } catch {
    // A full or missing store only costs the next page a fetch.
  }
}

export type CachedFetch<T> = {
  // One slot per card, such as "weather".
  name: string;
  // What the value depends on, such as the place and the units. A stored value with another key is never shown.
  key: string;
  ttl_ms: number;
  // A stored value older than this is never shown, even when a refresh fails, so an offline page does not show an arbitrarily old answer.
  max_age_ms: number;
  // Makes the value from the network, or undefined on any failure. `is_value` rechecks what storage returns.
  produce: () => Promise<T | undefined>;
  is_value: (stored: unknown) => stored is T;
};

// Shows a stored value of the same key at once, within `max_age_ms`. Fetches only when that value is missing or older than the TTL, and shows the new value when it lands. A failed fetch keeps what is on screen and draws nothing new. Resolves true when a value for this key is on screen at the end, so a caller that drew a value for another key knows to take it down.
export async function load_cached<T>(spec: CachedFetch<T>, env: NetEnv, show: (value: T) => void): Promise<boolean> {
  const stored = await read_entry(spec.name, env);
  const usable = stored?.key === spec.key && env.now() - stored.at < spec.max_age_ms && spec.is_value(stored.value) ? stored : undefined;
  if (usable) show(usable.value as T);
  if (usable && env.now() - usable.at < spec.ttl_ms) return true;
  const value = await spec.produce();
  if (value === undefined) return usable !== undefined;
  await write_entry(spec.name, { key: spec.key, at: env.now(), value }, env);
  show(value);
  return true;
}

// The stored value of a slot whose key starts with `key_prefix` and is younger than `max_age_ms`, or undefined. It lets a card draw before it knows its full key, such as before a position arrives. `key_suffix` also pins the end of the key, such as the units setting. The caller must then run `load_cached`, which refreshes or replaces the value.
export async function peek_cached<T>(name: string, key_prefix: string, max_age_ms: number, is_value: (stored: unknown) => stored is T, env: NetEnv, key_suffix = ""): Promise<T | undefined> {
  const stored = await read_entry(name, env);
  return stored?.key.startsWith(key_prefix) && stored.key.endsWith(key_suffix) && env.now() - stored.at < max_age_ms && is_value(stored.value) ? stored.value : undefined;
}

// `net` with a stop: once `is_live` is false it sends no request and writes no cache. A card whose run a redraw replaces uses it, so a late answer never overwrites the newer card.
export function stoppable_net(net: NetEnv, is_live: () => boolean): NetEnv {
  const stopped_answer = () => new Response(null, { status: 503 });
  return { ...net, fetch: (input, init) => (is_live() ? net.fetch(input, init) : Promise.resolve(stopped_answer())), storage: { get: (key) => net.storage.get(key), set: async (items) => (is_live() ? net.storage.set(items) : undefined) } };
}
