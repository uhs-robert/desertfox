// The local marks: a scroll position kept per page address. The background owns them and every tab reaches them by message.
// A normal window keeps them in `storage.local`. A private window keeps its own in `storage.session`, apart from the normal ones, and loses them with its last window.
// All pages sit in one value, so one queue orders the writes and evicting the oldest page is one edit.

import { RuntimeRefusal } from "../shared/command.ts";
import type { MarkAnswer, MarkItem, MarkRequest } from "../shared/messages.ts";
import { MARK_ADD_KEY, MARK_JUMP_KEY, mark_page_url, mark_slot, MAX_MARK_PAGES, MAX_MARK_URL_CHARS, PREVIOUS_MARK } from "../shared/mark_names.ts";
import { MARK_PRIVATE_STORAGE_KEY, MARK_STORAGE_KEY } from "./storage_keys.ts";

type MarkPage = { at: number; marks: Record<string, [number, number]> };
type MarksValue = { v: 1; pages: Record<string, MarkPage> };

export type MarkArea = Pick<typeof browser.storage.local, "get" | "set" | "remove">;

export type MarkStoreDeps = {
  local: () => MarkArea;
  session: () => MarkArea;
  now: () => number;
};

const is_position = (value: unknown): boolean => Array.isArray(value) && value.length === 2 && value.every((part) => Number.isFinite(part));

const is_marks_value = (value: unknown): value is MarksValue => {
  const pages = (value as MarksValue | undefined)?.pages;
  return (
    (value as MarksValue | undefined)?.v === 1 &&
    typeof pages === "object" &&
    pages !== null &&
    Object.values(pages).every((page) => Number.isFinite(page?.at) && typeof page.marks === "object" && page.marks !== null && Object.values(page.marks).every(is_position))
  );
};

export function create_mark_store(deps: MarkStoreDeps) {
  const area_of = (is_private: boolean) => (is_private ? deps.session() : deps.local());
  const key_of = (is_private: boolean) => (is_private ? MARK_PRIVATE_STORAGE_KEY : MARK_STORAGE_KEY);

  // A damaged value reads as no marks.
  async function read_all(is_private: boolean): Promise<MarksValue> {
    const stored = (await area_of(is_private).get(key_of(is_private)))[key_of(is_private)];
    return is_marks_value(stored) ? stored : { v: 1, pages: {} };
  }

  // Each write reads, edits and writes the one value, so two writes from two tabs must not interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const in_turn = <Result>(job: () => Promise<Result>): Promise<Result> => {
    const turn = queue.then(job, job);
    queue = turn.catch(() => undefined);
    return turn;
  };

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

  async function set_now(request: MarkRequest, is_private: boolean): Promise<MarkAnswer> {
    if (typeof request.key !== "string" || !MARK_JUMP_KEY.test(request.key)) throw new RuntimeRefusal("Marks use a to z");
    const address = address_of(request.url);
    const here = check_position(request.x, request.y);
    const all = await read_all(is_private);
    const target = all.pages[address]?.marks[mark_slot(request.key)];
    if (request.type === "mark_jump") {
      if (!target) throw new RuntimeRefusal(`No mark ${request.key}`);
      put(all, address, { [PREVIOUS_MARK]: here });
    } else {
      if (!MARK_ADD_KEY.test(request.key)) throw new RuntimeRefusal("Marks use a to z");
      put(all, address, { [request.key]: here });
    }
    await area_of(is_private).set({ [key_of(is_private)]: all });
    return { ok: true, x: (target ?? here)[0], y: (target ?? here)[1] };
  }

  return {
    // A jump answers the stored offset and keeps the offset it left as the previous position, in one turn, so `''` toggles even when two presses race.
    run: (request: MarkRequest, is_private: boolean) => in_turn(() => set_now(request, is_private)),
    // The marks of one page, in key order, for the which-key rows.
    items: async (url: string, is_private: boolean): Promise<MarkItem[]> => {
      const page = (await read_all(is_private)).pages[mark_page_url(url)];
      return Object.entries(page?.marks ?? {})
        .map(([key, [x, y]]) => ({ key, x, y }))
        .sort((left, right) => (left.key < right.key ? -1 : 1));
    },
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

// Cleans up at start and after every window closes. A failed cleanup only leaves private marks until the next one, so it warns and goes on.
export function wire_private_mark_cleanup(store: MarkStore, windows: { onRemoved: { addListener: (listener: () => void) => void }; getAll: () => Promise<{ incognito: boolean }[]> }): void {
  const has_private_window = async () => (await windows.getAll()).some((window) => window.incognito);
  const clean = () => void store.clear_private_without_window(has_private_window).catch((error: unknown) => console.warn("desertfox: could not clear the private marks", error));
  windows.onRemoved.addListener(clean);
  clean();
}

// A mark message from a content script. The page's privacy is the sender tab's, never the message's. Only a tab sends these.
export async function answer_mark_request(store: MarkStore, request: MarkRequest, tab: { incognito: boolean } | undefined): Promise<MarkAnswer> {
  if (!tab || typeof request.url !== "string") return { ok: false, message: "No page to mark" };
  return store.run(request, tab.incognito).catch((error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
}
