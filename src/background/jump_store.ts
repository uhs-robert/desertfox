// The jump list: the places a big jump left, one list per window with a cursor, so `<C-o>` goes back and `<C-i>` forward. The background owns it and a tab reaches it by message (`jump_push`, `jump_step`).
// A normal window and a private window keep their lists apart, both in `storage.session`: a browser restart renumbers the windows, and the private lists go with the last private window.
// The cursor sits on an entry after a step. It sits past the last entry (`cursor === entries.length`) when the user is at the present, where no entry stands for the page they are on.

import { RuntimeRefusal } from "../shared/command.ts";
import { JUMP_SAME_PLACE_PX, MAX_JUMPS, type JumpEntry } from "../shared/jump_names.ts";
import { MAX_MARK_URL_CHARS } from "../shared/mark_names.ts";
import { create_write_queue } from "./store_turns.ts";
import { JUMP_PRIVATE_STORAGE_KEY, JUMP_STORAGE_KEY } from "./storage_keys.ts";

type JumpList = { entries: JumpEntry[]; cursor: number };
// A page that went away leaves its last offset here, per tab, until the tab's address changes or the page loads again.
export type Leaving = { window_id: number; entry: JumpEntry };
type JumpsValue = { v: 1; windows: Record<string, JumpList>; leaving?: Record<string, Leaving>; moved?: Record<string, string> };

export type JumpArea = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export type JumpStoreDeps = { session: () => JumpArea };

const is_entry = (value: unknown): boolean => {
  const entry = value as JumpEntry | undefined;
  return typeof entry?.url === "string" && Number.isFinite(entry.x) && Number.isFinite(entry.y);
};

const is_list = (value: unknown): value is JumpList => {
  const list = value as JumpList | undefined;
  return Array.isArray(list?.entries) && list.entries.every(is_entry) && Number.isInteger(list.cursor) && list.cursor >= 0 && list.cursor <= list.entries.length;
};

const is_jumps_value = (value: unknown): value is JumpsValue => {
  const stored = value as JumpsValue | undefined;
  return stored?.v === 1 && typeof stored.windows === "object" && stored.windows !== null && Object.values(stored.windows).every(is_list);
};

const same_place = (left: JumpEntry, right: JumpEntry): boolean => left.url === right.url && Math.abs(left.x - right.x) < JUMP_SAME_PLACE_PX && Math.abs(left.y - right.y) < JUMP_SAME_PLACE_PX;

// Keeps the newest entries and moves the cursor with them.
function trimmed(list: JumpList): JumpList {
  const dropped = Math.max(0, list.entries.length - MAX_JUMPS);
  return { entries: list.entries.slice(dropped), cursor: list.cursor - dropped };
}

// A jump from an entry the cursor stands on drops the entries after it, like a new page in a tab's history. The place it left replaces that entry.
function pushed(list: JumpList, entry: JumpEntry): JumpList {
  const kept = list.entries.slice(0, list.cursor);
  const last = kept.at(-1);
  const entries = last && same_place(last, entry) ? [...kept.slice(0, -1), entry] : [...kept, entry];
  return trimmed({ entries, cursor: entries.length });
}

// The entry `delta` places from the cursor, and the list with the cursor there. At the present the place `here` joins the list first, so `<C-i>` can come back to it. The list is trimmed before the target is picked, so the entry answered is one the stored list still holds. Past either end refuses and leaves the list as it was.
function stepped(list: JumpList, delta: number, here: JumpEntry): { list: JumpList; entry: JumpEntry } {
  let current = list;
  if (current.cursor >= current.entries.length) {
    if (delta > 0) throw new RuntimeRefusal("No newer jump");
    const last = current.entries.at(-1);
    const entries = last && same_place(last, here) ? current.entries : [...current.entries, here];
    current = trimmed({ entries, cursor: entries.length - 1 });
  }
  const target = current.cursor + delta;
  const entry = current.entries[target];
  if (!entry) throw new RuntimeRefusal(delta < 0 ? "No older jump" : "No newer jump");
  return { list: { entries: current.entries, cursor: target }, entry };
}

export function create_jump_store(deps: JumpStoreDeps) {
  const key_of = (is_private: boolean) => (is_private ? JUMP_PRIVATE_STORAGE_KEY : JUMP_STORAGE_KEY);

  // A damaged value reads as no lists.
  async function read_all(is_private: boolean): Promise<JumpsValue> {
    const stored = (await deps.session().get(key_of(is_private)))[key_of(is_private)];
    return is_jumps_value(stored) ? stored : { v: 1, windows: {} };
  }

  const empty: JumpList = { entries: [], cursor: 0 };
  // Every change reads, edits and writes inside one turn, so two presses in a row see each other's cursor.
  const in_turn = create_write_queue();

  const check_entry = (entry: JumpEntry): JumpEntry => {
    if (entry.url.length > MAX_MARK_URL_CHARS) throw new RuntimeRefusal("URL too long for the jump list");
    if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) throw new RuntimeRefusal("A jump needs a scroll position");
    return { url: entry.url, x: Math.round(entry.x), y: Math.round(entry.y) };
  };

  return {
    // Records the place a jump left, in the list of the window.
    push: (window_id: number, is_private: boolean, entry: JumpEntry) =>
      in_turn(async () => {
        const checked = check_entry(entry);
        const all = await read_all(is_private);
        all.windows[window_id] = pushed(all.windows[window_id] ?? empty, checked);
        await deps.session().set({ [key_of(is_private)]: all });
      }),
    // Moves the cursor by `delta` and answers the entry there. `here` is the place the user is at now.
    step: (window_id: number, is_private: boolean, delta: number, here: JumpEntry): Promise<JumpEntry> =>
      in_turn(async () => {
        if (!Number.isInteger(delta) || delta === 0) throw new RuntimeRefusal("A jump step is a whole number but not zero");
        const checked = check_entry(here);
        const all = await read_all(is_private);
        const result = stepped(all.windows[window_id] ?? empty, delta, checked);
        all.windows[window_id] = result.list;
        await deps.session().set({ [key_of(is_private)]: all });
        return result.entry;
      }),
    // Holds the offset a page left, for the navigation that may follow.
    hold_leaving: (tab_id: number, is_private: boolean, leaving: Leaving) =>
      in_turn(async () => {
        const all = await read_all(is_private);
        all.leaving = { ...all.leaving, [tab_id]: { window_id: leaving.window_id, entry: check_entry(leaving.entry) } };
        await deps.session().set({ [key_of(is_private)]: all });
      }),
    // Notes the address a tab went to before its page reported the offset it left.
    note_moved: (tab_id: number, is_private: boolean, url: string) =>
      in_turn(async () => {
        const all = await read_all(is_private);
        all.moved = { ...all.moved, [tab_id]: url };
        await deps.session().set({ [key_of(is_private)]: all });
      }),
    take_moved: (tab_id: number, is_private: boolean): Promise<string | undefined> =>
      in_turn(async () => {
        const all = await read_all(is_private);
        const url = all.moved?.[tab_id];
        if (url === undefined) return undefined;
        delete all.moved![tab_id];
        await deps.session().set({ [key_of(is_private)]: all });
        return url;
      }),
    // Takes what the tab's page left, and nothing when it left none.
    take_leaving: (tab_id: number, is_private: boolean): Promise<Leaving | undefined> =>
      in_turn(async () => {
        const all = await read_all(is_private);
        const leaving = all.leaving?.[tab_id];
        if (!leaving || !is_entry(leaving.entry)) return undefined;
        delete all.leaving![tab_id];
        await deps.session().set({ [key_of(is_private)]: all });
        return leaving;
      }),
    // The list of a window that closed. Its id may be a private window's, so both values drop it.
    forget_window: (window_id: number) =>
      in_turn(async () => {
        for (const is_private of [false, true]) {
          const all = await read_all(is_private);
          if (!(window_id in all.windows)) continue;
          delete all.windows[window_id];
          await deps.session().set({ [key_of(is_private)]: all });
        }
      }),
    // Drops every private list unless a private window is open. The window check runs in the queue, so a push from a window that just opened is never deleted.
    clear_private_without_window: (has_private_window: () => Promise<boolean>) =>
      in_turn(async () => {
        if (await has_private_window()) return;
        await deps.session().remove(JUMP_PRIVATE_STORAGE_KEY);
      }),
  };
}

export type JumpStore = ReturnType<typeof create_jump_store>;

// Calls the browser at use, so the command modules load in Node.
export const browser_jump_store = create_jump_store({ session: () => browser.storage.session });
