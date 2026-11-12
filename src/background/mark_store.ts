// The marks: a scroll position kept per page address (local, a to z), and a few global ones (A to Z) that keep an address and a position. The background owns them and every tab reaches them by message.
// A normal window keeps them in `storage.local`. A private window keeps its own in `storage.session`, apart from the normal ones, and loses them with its last window.
// All pages sit in one value, so one queue orders the writes and evicting the oldest page is one edit.

import { RuntimeRefusal } from "../shared/command.ts";
import type { MarkAnswer, MarkItem, MarkJump, MarkRequest } from "../shared/messages.ts";
import { is_global_mark, MARK_ADD_KEY, MARK_JUMP_KEY, mark_page_url, mark_slot, MAX_MARK_PAGES, MAX_MARK_URL_CHARS, PREVIOUS_MARK } from "../shared/mark_names.ts";
import { create_write_queue } from "./store_turns.ts";
import { MARK_PRIVATE_STORAGE_KEY, MARK_STORAGE_KEY } from "./storage_keys.ts";

type MarkPage = { at: number; marks: Record<string, [number, number]> };
type GlobalMark = { url: string; x: number; y: number };
// `globals` is missing in a value stored before global marks, and reads as none.
type StoredMarks = { v: 1; pages: Record<string, MarkPage>; globals?: Record<string, GlobalMark> };
type MarksValue = { v: 1; pages: Record<string, MarkPage>; globals: Record<string, GlobalMark> };

export type MarkClearScope = "page" | "all";

export type MarkArea = Pick<typeof browser.storage.local, "get" | "set" | "remove">;

export type MarkStoreDeps = {
  local: () => MarkArea;
  session: () => MarkArea;
  now: () => number;
};

const is_position = (value: unknown): boolean => Array.isArray(value) && value.length === 2 && value.every((part) => Number.isFinite(part));

const is_global_mark_value = (value: unknown): boolean => {
  const mark = value as GlobalMark | undefined;
  return typeof mark?.url === "string" && Number.isFinite(mark.x) && Number.isFinite(mark.y);
};

const is_marks_value = (value: unknown): value is StoredMarks => {
  const stored = value as StoredMarks | undefined;
  const pages = stored?.pages;
  return (
    stored?.v === 1 &&
    typeof pages === "object" &&
    pages !== null &&
    Object.values(pages).every((page) => Number.isFinite(page?.at) && typeof page.marks === "object" && page.marks !== null && Object.values(page.marks).every(is_position)) &&
    (stored.globals === undefined || (typeof stored.globals === "object" && stored.globals !== null && Object.values(stored.globals).every(is_global_mark_value)))
  );
};

const MARK_KEYS_TEXT = "Marks use a to z and A to Z";

export function create_mark_store(deps: MarkStoreDeps) {
  const area_of = (is_private: boolean) => (is_private ? deps.session() : deps.local());
  const key_of = (is_private: boolean) => (is_private ? MARK_PRIVATE_STORAGE_KEY : MARK_STORAGE_KEY);

  // A damaged value reads as no marks.
  async function read_all(is_private: boolean): Promise<MarksValue> {
    const stored = (await area_of(is_private).get(key_of(is_private)))[key_of(is_private)];
    return is_marks_value(stored) ? { v: 1, pages: stored.pages, globals: stored.globals ?? {} } : { v: 1, pages: {}, globals: {} };
  }

  const in_turn = create_write_queue();

  const address_of = (url: string): string => {
    const address = mark_page_url(url);
    if (address.length > MAX_MARK_URL_CHARS) throw new RuntimeRefusal("URL too long for a mark");
    return address;
  };

  const check_position = (x: number, y: number): [number, number] => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RuntimeRefusal("A mark needs a scroll position");
    return [Math.round(x), Math.round(y)];
  };

  // Puts a mark on a page and drops the page with the oldest write when a new page passes the limit.
  function put(all: MarksValue, address: string, slots: Record<string, [number, number]>): void {
    const kept = all.pages[address];
    if (!kept && Object.keys(all.pages).length >= MAX_MARK_PAGES) {
      const oldest = Object.entries(all.pages).reduce((older, entry) => (entry[1].at < older[1].at ? entry : older));
      delete all.pages[oldest[0]];
    }
    all.pages[address] = { at: deps.now(), marks: { ...kept?.marks, ...slots } };
  }

  async function run_now(request: MarkRequest, is_private: boolean): Promise<MarkAnswer> {
    if (typeof request.key !== "string" || !MARK_JUMP_KEY.test(request.key)) throw new RuntimeRefusal(MARK_KEYS_TEXT);
    const address = address_of(request.url);
    const here = check_position(request.x, request.y);
    const all = await read_all(is_private);
    const global = all.globals[request.key];
    const target: [number, number] | undefined = is_global_mark(request.key) ? global && [global.x, global.y] : all.pages[address]?.marks[mark_slot(request.key)];
    if (request.type === "mark_jump") {
      if (!target) throw new RuntimeRefusal(`No mark ${request.key}`);
      put(all, address, { [PREVIOUS_MARK]: here });
    } else {
      if (!MARK_ADD_KEY.test(request.key)) throw new RuntimeRefusal(MARK_KEYS_TEXT);
      if (is_global_mark(request.key)) all.globals[request.key] = { url: address, x: here[0], y: here[1] };
      else put(all, address, { [request.key]: here });
    }
    await area_of(is_private).set({ [key_of(is_private)]: all });
    return { ok: true, x: (target ?? here)[0], y: (target ?? here)[1] };
  }

  return {
    // A jump answers the stored offset and keeps the offset it left as the previous position, in one turn, so `''` toggles even when two presses race.
    run: (request: MarkRequest, is_private: boolean) => in_turn(() => run_now(request, is_private)),
    // The marks of one page in key order, then the global marks in key order, for the which-key rows. Only a global mark carries its address.
    items: async (url: string, is_private: boolean): Promise<MarkItem[]> => {
      const all = await read_all(is_private);
      const by_key = (left: MarkItem, right: MarkItem) => (left.key < right.key ? -1 : 1);
      const local = Object.entries(all.pages[mark_page_url(url)]?.marks ?? {})
        .map(([key, [x, y]]) => ({ key, x, y }))
        .sort(by_key);
      const global = Object.entries(all.globals)
        .map(([key, mark]) => ({ key, x: mark.x, y: mark.y, url: mark.url }))
        .sort(by_key);
      return [...local, ...global];
    },
    // Drops one mark: a global one by its key, a local one from the page of `url`. A key with no mark refuses.
    remove: (key: string, url: string, is_private: boolean) =>
      in_turn(async () => {
        if (typeof key !== "string" || !MARK_ADD_KEY.test(key)) throw new RuntimeRefusal(MARK_KEYS_TEXT);
        const all = await read_all(is_private);
        const page = all.pages[mark_page_url(url)];
        if (is_global_mark(key) ? !all.globals[key] : !page?.marks[key]) throw new RuntimeRefusal(`No mark ${key}`);
        if (is_global_mark(key)) delete all.globals[key];
        else if (page) delete page.marks[key];
        await area_of(is_private).set({ [key_of(is_private)]: all });
      }),
    // Drops the marks of `scope`: this page's local marks (its `'` slot too) and every global mark, or every page and every global mark. Quickmarks live elsewhere. Nothing to drop refuses.
    clear: (scope: MarkClearScope, url: string, is_private: boolean) =>
      in_turn(async () => {
        const all = await read_all(is_private);
        const address = mark_page_url(url);
        // mark.delete leaves a page record with no marks, so count marks, not records.
        const has_marks = (page: MarkPage | undefined) => Object.keys(page?.marks ?? {}).length > 0;
        const has_pages = scope === "all" ? Object.values(all.pages).some(has_marks) : has_marks(all.pages[address]);
        if (!has_pages && Object.keys(all.globals).length === 0) throw new RuntimeRefusal("No marks to clear");
        if (scope === "all") all.pages = {};
        else delete all.pages[address];
        all.globals = {};
        await area_of(is_private).set({ [key_of(is_private)]: all });
      }),
    // The global mark of one key, or nothing.
    global_of: async (key: string, is_private: boolean): Promise<GlobalMark | undefined> => (await read_all(is_private)).globals[key],
    // Drops every private mark unless a private window is open. The window check runs in the queue, so a write from a window that just opened is never deleted.
    clear_private_without_window: (has_private_window: () => Promise<boolean>) =>
      in_turn(async () => {
        if (await has_private_window()) return;
        await deps.session().remove(MARK_PRIVATE_STORAGE_KEY);
      }),
  };
}

export type MarkStore = ReturnType<typeof create_mark_store>;

// Calls the browser at use, so the command modules load in Node.
export const browser_mark_store = create_mark_store({ local: () => browser.storage.local, session: () => browser.storage.session, now: () => Date.now() });

// The tab a mark message came from. `frame_id` is the sender frame.
export type MarkSender = { incognito: boolean; id?: number | undefined; window_id?: number | undefined; url?: string | undefined; frame_id?: number | undefined };

// The jump of a global mark, which moves between tabs and so is not the store's business.
export type GlobalJump = (request: MarkJump, tab: MarkSender) => Promise<MarkAnswer>;

// A mark message from a content script. The page's privacy is the sender tab's, never the message's. Only a tab sends these.
export async function answer_mark_request(store: MarkStore, request: MarkRequest, tab: MarkSender | undefined, global_jump: GlobalJump): Promise<MarkAnswer> {
  if (!tab || typeof request.url !== "string") return { ok: false, message: "No page to mark" };
  const answer = async (): Promise<MarkAnswer> => {
    if (typeof request.key !== "string" || !is_global_mark(request.key)) return store.run(request, tab.incognito);
    if (request.type === "mark_jump") return global_jump(request, tab);
    if (tab.frame_id !== 0) throw new RuntimeRefusal("Global marks need the top frame");
    if (!/^https?:\/\//.test(tab.url ?? "")) throw new RuntimeRefusal("Global marks need a web page");
    // The tab's address, never the page's: a frame sends its own.
    return store.run({ ...request, url: tab.url as string }, tab.incognito);
  };
  return answer().catch((error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
}
