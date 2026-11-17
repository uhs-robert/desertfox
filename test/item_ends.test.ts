import assert from "node:assert/strict";
import { test } from "node:test";
import { END_MAX_MS, END_POLL_MS, END_STALL_MS, end_item, follow_end, list_scroller } from "../src/content/item/ends.ts";
import type { EndPage } from "../src/content/item/ends.ts";

type FakeBox = { name: string; overflow: string; scrollHeight: number; clientHeight: number; parentElement: FakeBox | null; scrollTo: () => void };
const chain = (...levels: [string, string, number, number][]): FakeBox[] => {
  const boxes: FakeBox[] = [];
  for (const [name, overflow, scrollHeight, clientHeight] of levels.reverse()) boxes.unshift({ name, overflow, scrollHeight, clientHeight, parentElement: boxes[0] ?? null, scrollTo: () => {} });
  return boxes;
};
const doc_scroller = { name: "page" } as unknown as Element;
const scroller_page = { doc: { scrollingElement: doc_scroller, documentElement: doc_scroller } as unknown as EndPage["doc"], overflow_y_: (element: Element) => (element as unknown as FakeBox).overflow };
const scroller_of = (boxes: FakeBox[]) => (list_scroller({ parentElement: boxes[0] } as unknown as Element, scroller_page) as unknown as FakeBox).name;

test("the list scroller is the nearest ancestor that may scroll and holds more than it shows, else the page", () => {
  // As on Drive: an overflow box that holds no more than it shows, a hidden one and a clip sit between the rows and the real panel.
  assert.equal(scroller_of(chain(["table", "visible", 1200, 1200], ["fits", "auto", 750, 750], ["hidden", "hidden", 1300, 750], ["clip", "clip", 1300, 750], ["panel", "scroll", 1300, 750], ["outer", "auto", 2000, 900])), "panel");
  // A scroller nested in another: the inner one moves the list.
  assert.equal(scroller_of(chain(["inner", "auto", 900, 300], ["outer", "scroll", 2000, 900])), "inner");
  assert.equal(scroller_of(chain(["table", "visible", 1200, 1200], ["fits", "scroll", 750, 750])), "page");
});

type Row = { index: number; isConnected: boolean; parentElement: unknown; getAttribute: (name: string) => string | null; closest: () => unknown };

// A list in a panel 400 px tall of rows 40 px tall. A windowed list draws `window` rows from two above the scroll top. With `part`, it holds that many rows at first and loads `part` more `part_ms` after the panel reaches its bottom. With `numbered`, rows carry aria-rowindex and the grid aria-rowcount: the loaded count, or `rowcount` when given.
function scrolled_list({ total, window = total, part = total, part_ms = 300, numbered = true, rowcount }: { total: number; window?: number; part?: number; part_ms?: number; numbered?: boolean; rowcount?: number }) {
  const ROW_PX = 40;
  const VIEW_PX = 400;
  let clock = 0;
  let top = 0;
  let loaded = part;
  let load_at = Infinity;
  const grid = { getAttribute: (name: string) => (numbered && name === "aria-rowcount" ? String(rowcount ?? loaded) : null) };
  const rows = new Map<number, Row>();
  const panel = {
    get scrollHeight() {
      return loaded * ROW_PX;
    },
    get scrollTop() {
      return top;
    },
    clientHeight: VIEW_PX,
    parentElement: null,
    scrollTo: ({ top: wanted }: { top: number }) => {
      top = Math.max(0, Math.min(wanted, loaded * ROW_PX - VIEW_PX));
      if (top + VIEW_PX >= loaded * ROW_PX && loaded < total && load_at === Infinity) load_at = clock + part_ms;
    },
  };
  const row = (index: number): Row => {
    if (!rows.has(index)) rows.set(index, { index, isConnected: true, parentElement: panel, getAttribute: (name) => (numbered && name === "aria-rowindex" ? String(index + 1) : null), closest: () => grid });
    return rows.get(index)!;
  };
  const read = () => {
    if (clock >= load_at) [loaded, load_at] = [Math.min(total, loaded + part), Infinity];
    const first = window < total ? Math.max(0, Math.floor(top / ROW_PX) - 2) : 0;
    return Array.from({ length: Math.min(loaded, first + window) - first }, (_, offset) => row(first + offset)) as unknown as Element[];
  };
  const landed: number[] = [];
  const landed_at: number[] = [];
  let left = false;
  let stopped = false;
  const page: EndPage = {
    doc: { scrollingElement: null, documentElement: null } as unknown as EndPage["doc"],
    overflow_y_: (element) => (element === (panel as unknown as Element) ? "auto" : "visible"),
    wait_: async (ms) => void (clock += ms),
    now_: () => clock,
    watch_user_: () => ({ left_: () => left, stop_: () => void (stopped = true) }),
  };
  const go = (end: "first" | "last") => follow_end(page, read, end === "last", (item) => (landed.push((item as unknown as Row).index), landed_at.push(clock)));
  return { go, landed, landed_at, clock: () => clock, top: () => top, scroll_to: (wanted: number) => panel.scrollTo({ top: wanted }), leave: () => void (left = true), stopped: () => stopped };
}

test("on a list that draws only the rows near the view, last reaches the last row and first comes back to row 1, each at the first read after the scroll", async () => {
  const list = scrolled_list({ total: 500, window: 14 });
  await list.go("last");
  assert.deepEqual([list.landed, list.landed_at], [[499], [END_POLL_MS]]);
  assert.equal(list.top(), 500 * 40 - 400);
  // The last row matches aria-rowcount, but the end is followed for the stall time all the same, as Drive counts only the rows it has loaded.
  assert.ok(list.clock() >= END_STALL_MS && list.clock() < END_STALL_MS + 2 * END_POLL_MS, `stopped at ${list.clock()} ms`);
  const before = list.clock();
  await list.go("first");
  assert.deepEqual([list.landed.at(-1), list.landed_at.at(-1)! - before, list.top()], [0, END_POLL_MS, 0]);
});

test("last follows a list that loads in parts to its end, and lands on each new last row", async () => {
  const list = scrolled_list({ total: 250, part: 100, part_ms: 300 });
  await list.go("last");
  assert.deepEqual(list.landed, [99, 199, 249]);
  assert.equal(list.top(), 250 * 40 - 400);
});

test("last stops after the stall time on a list whose end stays put, and orders rows by document order with no aria-rowindex", async () => {
  const list = scrolled_list({ total: 30, numbered: false });
  await list.go("last");
  assert.deepEqual(list.landed, [29]);
  assert.ok(list.clock() >= END_STALL_MS && list.clock() < END_STALL_MS + 2 * END_POLL_MS, `stopped at ${list.clock()} ms`);
});

test("a last row below aria-rowcount keeps last going past the stall time, up to the time cap", async () => {
  const list = scrolled_list({ total: 100, window: 14, rowcount: 900 });
  await list.go("last");
  assert.equal(list.landed.at(-1), 99);
  assert.ok(list.clock() >= END_MAX_MS && list.clock() < END_MAX_MS + 2 * END_POLL_MS, `stopped at ${list.clock()} ms`);
});

test("first and last stop when the user leaves, and stop the user watch", async () => {
  const list = scrolled_list({ total: 250, part: 100 });
  list.scroll_to(Infinity);
  const going = list.go("last");
  list.leave();
  await going;
  assert.deepEqual([list.landed, list.stopped()], [[99], true]);
});

test("the end item is the highest aria-rowindex drawn, whatever the document order", () => {
  const numbered = (index: number) => ({ getAttribute: (name: string) => (name === "aria-rowindex" ? String(index) : null), index }) as unknown as Element;
  const rows = [numbered(7), numbered(9), numbered(8)];
  assert.equal(end_item(rows, true), rows[1]);
  assert.equal(end_item(rows, false), rows[0]);
});

test("an end item the page dropped is not focused, and the next read lands on the one that replaced it", async () => {
  let reads = 0;
  const stale = { index: -1, isConnected: false, parentElement: null, getAttribute: () => null, closest: () => null };
  const fresh = { ...stale, index: 1, isConnected: true };
  const landed: number[] = [];
  const page: EndPage = { doc: { scrollingElement: { scrollTop: 0, scrollHeight: 100, clientHeight: 100, scrollTo: () => {} } } as unknown as EndPage["doc"], overflow_y_: () => "visible", wait_: async () => {}, now_: () => reads * END_POLL_MS, watch_user_: () => ({ left_: () => false, stop_: () => {} }) };
  await follow_end(page, () => [(reads++ === 0 ? stale : fresh) as unknown as Element], true, (item) => landed.push((item as unknown as Row).index));
  assert.deepEqual(landed, [1]);
});

test("on a page that scrolls itself and grows after the last item landed, the last item lands again after the scroll to the new bottom", async () => {
  let clock = 0;
  let top = 0;
  let height = 2000;
  const page_scroller = {
    get scrollTop() {
      return top;
    },
    get scrollHeight() {
      return height;
    },
    clientHeight: 800,
    scrollTo: ({ top: wanted }: { top: number }) => void (top = Math.min(wanted, height - 800)),
  };
  const result = { index: 9, isConnected: true, parentElement: null, getAttribute: () => null, closest: () => null };
  const landed: number[] = [];
  const page: EndPage = { doc: { scrollingElement: page_scroller } as unknown as EndPage["doc"], overflow_y_: () => "visible", wait_: async (ms) => void (clock += ms), now_: () => clock, watch_user_: () => ({ left_: () => false, stop_: () => {} }) };
  await follow_end(page, () => (landed.length > 0 && (height = 2600), [result as unknown as Element]), true, (item) => landed.push((item as unknown as Row).index));
  assert.deepEqual([landed, top], [[9, 9], 1800]);
});
