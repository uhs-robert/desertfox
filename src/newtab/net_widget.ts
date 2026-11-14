// The one way a new tab card reaches the network: a fetch with no credentials and a short timeout, and a result kept in `storage.local` so a reopened tab draws at once. A card calls this only after its own setting is on and the page is not private. Nothing here checks either, so the caller must.
export const NET_CACHE_KEY = "newtab_net_cache";
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
    const all = (await env.storage.get(NET_CACHE_KEY))[NET_CACHE_KEY] as Record<string, StoredEntry> | undefined;
    const entry = all?.[name];
    return entry && typeof entry.key === "string" && typeof entry.at === "number" ? entry : undefined;
  } catch {
    return undefined;
  }
}

async function write_entry(name: string, entry: StoredEntry, env: NetEnv): Promise<void> {
  try {
    const all = ((await env.storage.get(NET_CACHE_KEY))[NET_CACHE_KEY] as Record<string, StoredEntry> | undefined) ?? {};
    await env.storage.set({ [NET_CACHE_KEY]: { ...all, [name]: entry } });
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
  // Makes the value from the network, or undefined on any failure. `is_value` rechecks what storage returns.
  produce: () => Promise<T | undefined>;
  is_value: (stored: unknown) => stored is T;
};

// Shows a stored value of the same key at once, whatever its age. Fetches only when that value is missing or older than the TTL, and shows the new value when it lands. A failed fetch keeps what is on screen and draws nothing new.
export async function load_cached<T>(spec: CachedFetch<T>, env: NetEnv, show: (value: T) => void): Promise<void> {
  const stored = await read_entry(spec.name, env);
  const usable = stored?.key === spec.key && spec.is_value(stored.value) ? stored : undefined;
  if (usable) show(usable.value as T);
  if (usable && env.now() - usable.at < spec.ttl_ms) return;
  const value = await spec.produce();
  if (value === undefined) return;
  await write_entry(spec.name, { key: spec.key, at: env.now(), value }, env);
  show(value);
}
