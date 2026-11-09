// The saved tab sessions: a name store in `storage.local` (`SESSIONS_STORAGE_KEY`) and the pure plan for opening one again.
// The browser calls (reading tabs, creating windows and tabs) live in `commands/session.ts`.

import { RuntimeRefusal } from "../shared/command.ts";
import type { SessionItem } from "../shared/messages.ts";
import { SESSIONS_STORAGE_KEY } from "./storage_keys.ts";

export type SessionTab = {
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
  // Absent for a tab in the default container.
  container_id?: string;
  container_name?: string;
};

// The tabs are in tab bar order, so the array position is the saved order.
export type Session = { saved_at: number; tabs: SessionTab[] };
export type NamedSession = Session & { name: string };

type StoredSessions = { version: 1; sessions: Record<string, Session> };

export type SessionStorage = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
};

export const browser_session_storage: SessionStorage = {
  get: async (key) => (await browser.storage.local.get(key))[key],
  set: (key, value) => browser.storage.local.set({ [key]: value }),
};

// Text typed in a line may carry any run of spaces, and the line's tokenizer joins words with one space, so the stored name does too.
export const normalize_session_name = (text: string): string => text.split(/\s+/).filter(Boolean).join(" ");

const same_name = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const is_session_tab = (value: unknown): value is SessionTab => {
  const tab = value as Partial<SessionTab> | null;
  return typeof tab?.url === "string" && typeof tab.title === "string" && typeof tab.pinned === "boolean" && typeof tab.active === "boolean";
};

const is_session = (value: unknown): value is Session => {
  const session = value as Partial<Session> | null;
  return typeof session?.saved_at === "number" && Array.isArray(session.tabs) && session.tabs.every(is_session_tab);
};

// The sessions this version reads, a Map keyed by display name because a session called `__proto__` must not reach the prototype of a plain object. `unread` holds the entries it cannot read, which a write gives back unchanged.
type Loaded = { sessions: Map<string, Session>; unread: [string, unknown][] };

async function read_map(storage: SessionStorage): Promise<Loaded> {
  const stored = (await storage.get(SESSIONS_STORAGE_KEY)) as Partial<StoredSessions> | undefined;
  if (stored === undefined || stored === null) return { sessions: new Map(), unread: [] };
  // A newer version may have a shape this code cannot keep. Refusing here keeps a later write from destroying it.
  if (stored.version !== 1 || typeof stored.sessions !== "object" || stored.sessions === null) throw new RuntimeRefusal("The saved sessions have a format this version cannot read");
  const entries = Object.entries(stored.sessions);
  return { sessions: new Map(entries.filter(([, session]) => is_session(session)) as [string, Session][]), unread: entries.filter(([, session]) => !is_session(session)) };
}

// An entry this version cannot read keeps its key. A new session may not take it, because the write would give the unread entry the key back.
function refuse_unread_name({ unread }: Loaded, name: string): void {
  const clash = unread.find(([key]) => same_name(key, name));
  if (clash) throw new RuntimeRefusal(`A session named "${clash[0]}" exists`);
}

function find_name(sessions: Map<string, Session>, name: string): string | undefined {
  return [...sessions.keys()].find((existing) => same_name(existing, name));
}

// `3d ago`, the biggest whole unit. Under a minute reads `just now`.
export function session_age(saved_at: number, now: number): string {
  const minutes = Math.floor((now - saved_at) / 60_000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}

export type SessionStore = ReturnType<typeof make_session_store>;

export function make_session_store(storage: SessionStorage, now: () => number = Date.now) {
  // Every change reads, edits and writes the whole value, so two at once would lose one of them. They run one after another.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <Result>(change: () => Promise<Result>): Promise<Result> => {
    const run = queue.then(change, change);
    queue = run.catch(() => undefined);
    return run;
  };

  async function write({ sessions, unread }: Loaded): Promise<void> {
    const value = { version: 1, sessions: Object.fromEntries([...sessions, ...unread]) };
    // A failed write leaves the stored value as it was, so the refusal names the cause and nothing is half saved.
    await storage.set(SESSIONS_STORAGE_KEY, value).catch((error: unknown) => {
      throw new RuntimeRefusal(`Could not store the sessions: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  const checked_name = (text: string): string => {
    const name = normalize_session_name(text);
    if (name === "") throw new RuntimeRefusal("A session needs a name");
    return name;
  };

  const list = async (): Promise<NamedSession[]> =>
    [...(await read_map(storage)).sessions].map(([name, session]) => ({ name, ...session })).toSorted((a, b) => b.saved_at - a.saved_at);

  // The command line reads a leading `-t` as a flag and a leading `@selection` as a slot, so a picked name that starts so would not run as the session.
  const new_name = (text: string): string => {
    const name = checked_name(text);
    if (/^[-@]/.test(name)) throw new RuntimeRefusal(`A session name cannot start with "-" or "@": "${name}"`);
    return name;
  };

  return {
    // Newest first.
    list,

    // What the command line lists.
    items: async (): Promise<SessionItem[]> =>
      (await list()).map(({ name, tabs, saved_at }) => ({ name, description: `${tabs.length} ${tabs.length === 1 ? "tab" : "tabs"}, ${session_age(saved_at, now())}` })),

    // The session as it is now. A later save of the same name does not change what this returned.
    get: async (text: string): Promise<NamedSession> => {
      const { sessions } = await read_map(storage);
      const name = find_name(sessions, checked_name(text));
      if (name === undefined) throw new RuntimeRefusal(`No session named "${normalize_session_name(text)}"`);
      return { name, ...(sessions.get(name) as Session) };
    },

    // An existing name is updated and keeps its display case. `previous_tabs` is the count it replaced.
    save: (text: string, tabs: SessionTab[]): Promise<{ name: string; previous_tabs: number | undefined }> =>
      exclusive(async () => {
        const typed = new_name(text);
        const loaded = await read_map(storage);
        const { sessions } = loaded;
        const existing = find_name(sessions, typed);
        if (existing === undefined) refuse_unread_name(loaded, typed);
        const name = existing ?? typed;
        const previous_tabs = sessions.get(name)?.tabs.length;
        sessions.set(name, { saved_at: now(), tabs });
        await write(loaded);
        return { name, previous_tabs };
      }),

    remove: (text: string): Promise<string> =>
      exclusive(async () => {
        const loaded = await read_map(storage);
        const { sessions } = loaded;
        const name = find_name(sessions, checked_name(text));
        if (name === undefined) throw new RuntimeRefusal(`No session named "${normalize_session_name(text)}"`);
        sessions.delete(name);
        await write(loaded);
        return name;
      }),

    // Changing only the case of a name is allowed. Any other name that is taken is refused.
    rename: (text: string, new_text: string): Promise<{ from: string; to: string }> =>
      exclusive(async () => {
        const loaded = await read_map(storage);
        const { sessions } = loaded;
        const from = find_name(sessions, checked_name(text));
        if (from === undefined) throw new RuntimeRefusal(`No session named "${normalize_session_name(text)}"`);
        const to = new_name(new_text);
        refuse_unread_name(loaded, to);
        const taken = find_name(sessions, to);
        if (taken !== undefined && taken !== from) throw new RuntimeRefusal(`A session named "${taken}" exists`);
        // Delete first and set after, so the renamed entry takes the end of the map. Its `saved_at` is kept.
        const session = sessions.get(from) as Session;
        sessions.delete(from);
        sessions.set(to, session);
        await write(loaded);
        return { from, to };
      }),
  };
}

export type PlannedTab = {
  url: string;
  title: string;
  pinned: boolean;
  // The one tab that loads. Every other planned tab is created discarded.
  active: boolean;
  cookie_store_id?: string;
  // The tab had a container the browser no longer has, by id or by name.
  container_lost: boolean;
};

export type ContainerRef = { id: string; name: string };

// Exactly one tab is active: the saved one, or the first when the session has none. A container is found by its id, then by its name, because a deleted and recreated container gets a new id. A container that is gone leaves the tab in the default one.
export function plan_restore(tabs: readonly SessionTab[], containers: readonly ContainerRef[]): PlannedTab[] {
  const saved_active = tabs.findIndex((tab) => tab.active);
  const active_index = saved_active === -1 ? 0 : saved_active;
  return tabs.map((tab, index) => {
    const container = tab.container_id === undefined ? undefined : (containers.find((known) => known.id === tab.container_id) ?? containers.find((known) => known.name === tab.container_name));
    return {
      url: tab.url,
      title: tab.title,
      pinned: tab.pinned,
      active: index === active_index,
      ...(container ? { cookie_store_id: container.id } : {}),
      container_lost: tab.container_id !== undefined && container === undefined,
    };
  });
}
