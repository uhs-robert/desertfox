import assert from "node:assert/strict";
import { test } from "node:test";
import { create_global_mark_jump, find_mark_tab } from "../../src/background/global_mark_jump.ts";
import type { MarkTab } from "../../src/background/global_mark_jump.ts";
import { answer_mark_request, create_mark_store } from "../../src/background/mark_store.ts";
import type { MarkArea } from "../../src/background/mark_store.ts";
import type { PageReady, PageWatch } from "../../src/background/page_ready.ts";
import type { MarkJump } from "../../src/shared/messages.ts";

const tab = (id: number, url: string, extra: Partial<MarkTab> = {}): MarkTab => ({ id, window_id: 1, index: id, url, incognito: false, last_accessed: id, ...extra });
const from = { id: 1, window_id: 1, incognito: false };

test("find_mark_tab prefers the tab itself, then its window by newest access, then other windows", () => {
  const url = "https://a.test/p";
  const tabs = [tab(2, url, { window_id: 2, last_accessed: 99 }), tab(3, url, { last_accessed: 5 }), tab(4, url, { last_accessed: 8 }), tab(5, "https://other.test/")];
  assert.equal(find_mark_tab(tabs, url, from)?.id, 4);
  assert.equal(find_mark_tab([...tabs, tab(1, url, { last_accessed: 0 })], url, from)?.id, 1);
  assert.equal(find_mark_tab(tabs.filter((candidate) => candidate.window_id === 2), url, from)?.id, 2);
  assert.equal(find_mark_tab([tab(7, url, { window_id: 3, last_accessed: 4 }), tab(6, url, { window_id: 2, last_accessed: 4 })], url, from)?.id, 6);
  assert.equal(find_mark_tab([tab(8, url, { last_accessed: 4, index: 5 }), tab(9, url, { last_accessed: 4, index: 2 })], url, from)?.id, 9);
});

test("find_mark_tab matches the exact address with the hash ignored, in the same privacy only", () => {
  const url = "https://a.test/p";
  assert.equal(find_mark_tab([tab(2, `${url}#top`)], url, from)?.id, 2);
  assert.equal(find_mark_tab([tab(2, `${url}/more`), tab(3, "http://a.test/p"), tab(4, `${url}?q=1`)], url, from), undefined);
  assert.equal(find_mark_tab([tab(2, url, { incognito: true })], url, from), undefined);
  assert.equal(find_mark_tab([tab(2, url)], url, { ...from, incognito: true }), undefined);
});

function fake_area() {
  const values = new Map<string, unknown>();
  return {
    get: async (key: string) => Object.fromEntries(values.has(key) ? [[key, structuredClone(values.get(key))]] : []),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value))),
    remove: async (key: string) => void values.delete(key),
  } as unknown as MarkArea;
}

const MARK_URL = "https://a.test/p";

function make(tabs: MarkTab[]) {
  let clock = 0;
  const local = fake_area();
  const session = fake_area();
  const real = create_mark_store({ local: () => local, session: () => session, now: () => ++clock });
  const log: string[] = [];
  const watches: { tab_id: number; stopped: boolean; resolve: (result: PageReady) => void; requires_navigation?: boolean | undefined }[] = [];
  const refusals: { tab_id: number; message: string }[] = [];
  const state = { tabs, push_reply: undefined as unknown, during_push: undefined as (() => Promise<unknown>) | undefined, navigate_fails: false, activate_fails: false, focus_fails: false };
  const global_jump = create_global_mark_jump({
    store: real,
    list_tabs: async () => state.tabs,
    activate_tab: async (tab_id) => {
      log.push(`activate ${tab_id}`);
      if (state.activate_fails) throw new Error("no tab");
    },
    focus_window: async (window_id) => {
      log.push(`focus ${window_id}`);
      if (state.focus_fails) throw new Error("refused");
    },
    navigate: async (tab_id, url) => {
      log.push(`navigate ${tab_id} ${url}`);
      if (state.navigate_fails) throw new Error("Illegal URL");
    },
    watch: (tab_id) => {
      log.push(`watch ${tab_id}`);
      const entry = { tab_id, stopped: false, resolve: (_: PageReady) => {}, requires_navigation: undefined as boolean | undefined };
      const done = new Promise<PageReady>((resolve) => (entry.resolve = resolve));
      watches.push(entry);
      return {
        navigated: () => false,
        stop: () => {
          entry.stopped = true;
          entry.resolve("gone");
        },
        done: (_timeout, options) => ((entry.requires_navigation = options?.requires_navigation), done),
      } satisfies PageWatch;
    },
    push_jump: async (tab_id, key) => (log.push(`push ${tab_id} ${key}`), await state.during_push?.(), state.push_reply),
    show_refusal: async (tab_id, message) => void refusals.push({ tab_id, message }),
  });
  const sender = (id = 1, extra = {}) => ({ incognito: false, id, window_id: 1, url: "https://sender.test/", frame_id: 0, ...extra });
  const jump = (key = "A", y = 40, url = "https://sender.test/"): MarkJump => ({ type: "mark_jump", key, url, x: 0, y });
  const set_mark = (key = "A", is_private = false) => answer_mark_request(real, { type: "mark_set", key, url: "ignored", x: 0, y: 300 }, { incognito: is_private, id: 9, window_id: 1, url: MARK_URL, frame_id: 0 });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { store: real, global_jump, log, watches, refusals, state, sender, jump, set_mark, flush };
}

test("a jump with no mark refuses and touches no tab", async () => {
  const fakes = make([tab(2, MARK_URL)]);
  await assert.rejects(fakes.global_jump(fakes.jump(), fakes.sender()), /No mark A/);
  assert.deepEqual(fakes.log, []);
});

test("a jump to the tab you are on is a local jump: the page scrolls and the previous position is kept", async () => {
  const fakes = make([tab(1, `${MARK_URL}#x`), tab(2, MARK_URL)]);
  await fakes.set_mark();
  assert.deepEqual(await fakes.global_jump(fakes.jump("A", 40, MARK_URL), fakes.sender(1, { url: MARK_URL })), { ok: true, x: 0, y: 300 });
  assert.deepEqual(fakes.log, []);
  assert.deepEqual(await fakes.store.run({ type: "mark_jump", key: "'", url: MARK_URL, x: 0, y: 0 }, false), { ok: true, x: 0, y: 40 });
});

test("a jump to another tab switches, focuses a window that differs, answers at once and pushes after the page is ready", async () => {
  const fakes = make([tab(1, "https://sender.test/"), tab(2, MARK_URL, { window_id: 2 })]);
  await fakes.set_mark();
  assert.deepEqual(await fakes.global_jump(fakes.jump(), fakes.sender()), { ok: true });
  assert.deepEqual(fakes.log, ["watch 2", "activate 2", "focus 2"]);
  assert.equal(fakes.watches[0]!.requires_navigation, false);
  fakes.watches[0]!.resolve("ready");
  await fakes.flush();
  assert.deepEqual(fakes.log.at(-1), "push 2 A");
  assert.equal(fakes.watches[0]!.stopped, true);
});

test("a tab in the same window is activated without a window focus, and a refused focus is ignored", async () => {
  const fakes = make([tab(1, "https://sender.test/"), tab(2, MARK_URL)]);
  await fakes.set_mark();
  await fakes.global_jump(fakes.jump(), fakes.sender());
  assert.deepEqual(fakes.log, ["watch 2", "activate 2"]);
  const other = make([tab(1, "https://sender.test/"), tab(2, MARK_URL, { window_id: 2 })]);
  await other.set_mark();
  other.state.focus_fails = true;
  assert.deepEqual(await other.global_jump(other.jump(), other.sender()), { ok: true });
  assert.deepEqual(other.refusals, []);
});

test("with no tab on the address the current tab opens it, the watch starts before the navigation and the answer does not wait for the load", async () => {
  const fakes = make([tab(1, "https://sender.test/")]);
  await fakes.set_mark();
  assert.deepEqual(await fakes.global_jump(fakes.jump(), fakes.sender()), { ok: true });
  assert.deepEqual(fakes.log, ["watch 1", `navigate 1 ${MARK_URL}`]);
  assert.equal(fakes.watches[0]!.requires_navigation, true);
  fakes.watches[0]!.resolve("ready");
  await fakes.flush();
  assert.equal(fakes.log.at(-1), "push 1 A");
});

test("the arrival jump scrolls from the stored mark and a redirect does not open the address again", async () => {
  const fakes = make([tab(1, "https://sender.test/")]);
  await fakes.set_mark();
  // The page redirected, so its address matches no tab. The second jump of the push must still scroll.
  let arrival: unknown;
  fakes.state.during_push = async () => {
    arrival = await answer_mark_request(fakes.store, fakes.jump("A", 0, "https://login.test/"), { incognito: false, id: 1, window_id: 1, url: "https://login.test/", frame_id: 0 }, fakes.global_jump);
  };
  await fakes.global_jump(fakes.jump(), fakes.sender());
  fakes.watches[0]!.resolve("ready");
  await fakes.flush();
  assert.deepEqual(arrival, { ok: true, x: 0, y: 300 });
  assert.equal(fakes.log.filter((line) => line.startsWith("navigate")).length, 1);
  // The entry is gone: the next jump on that page is a new jump again.
  fakes.state.tabs = [tab(1, "https://login.test/")];
  await fakes.global_jump(fakes.jump("A", 0, "https://login.test/"), fakes.sender(1, { url: "https://login.test/" }));
  assert.equal(fakes.log.filter((line) => line.startsWith("navigate")).length, 2);
});

test("the arrival answer needs the page to be ready: a jump before that is a new jump", async () => {
  const fakes = make([tab(1, "https://sender.test/")]);
  await fakes.set_mark();
  await fakes.global_jump(fakes.jump(), fakes.sender());
  await fakes.global_jump(fakes.jump(), fakes.sender());
  assert.equal(fakes.log.filter((line) => line.startsWith("navigate")).length, 2);
  assert.equal(fakes.watches.length, 2);
  // The first wait belongs to a replaced jump, so it pushes nothing.
  fakes.watches[0]!.resolve("ready");
  await fakes.flush();
  assert.equal(fakes.log.filter((line) => line.startsWith("push")).length, 0);
  fakes.watches[1]!.resolve("ready");
  await fakes.flush();
  assert.equal(fakes.log.filter((line) => line.startsWith("push")).length, 1);
});

test("a timeout and a page with no script each show one refusal on the target tab and no push", async () => {
  for (const [result, text] of [["timeout", /did not finish/], ["no_script", /does not run/]] as const) {
    const fakes = make([tab(1, "https://sender.test/"), tab(2, MARK_URL)]);
    await fakes.set_mark();
    await fakes.global_jump(fakes.jump(), fakes.sender());
    fakes.watches[0]!.resolve(result);
    await fakes.flush();
    assert.equal(fakes.refusals.length, 1, result);
    assert.equal(fakes.refusals[0]!.tab_id, 2);
    assert.match(fakes.refusals[0]!.message, text);
    assert.equal(fakes.log.filter((line) => line.startsWith("push")).length, 0);
    assert.equal(fakes.watches[0]!.stopped, true);
  }
});

test("a tab closed while it loads is silent and clears the entry", async () => {
  const fakes = make([tab(1, "https://sender.test/")]);
  await fakes.set_mark();
  await fakes.global_jump(fakes.jump(), fakes.sender());
  fakes.watches[0]!.resolve("gone");
  await fakes.flush();
  assert.deepEqual(fakes.refusals, []);
  assert.equal(fakes.log.filter((line) => line.startsWith("push")).length, 0);
  // No stale entry: a jump from that tab id starts a new navigation.
  await fakes.global_jump(fakes.jump(), fakes.sender());
  assert.equal(fakes.log.filter((line) => line.startsWith("navigate")).length, 2);
});

test("a refused push shows the page's refusal on the tab", async () => {
  const fakes = make([tab(1, "https://sender.test/")]);
  await fakes.set_mark();
  fakes.state.push_reply = { ok: false, message: "No mark A" };
  await fakes.global_jump(fakes.jump(), fakes.sender());
  fakes.watches[0]!.resolve("ready");
  await fakes.flush();
  assert.deepEqual(fakes.refusals, [{ tab_id: 1, message: "No mark A" }]);
});

test("an address Firefox refuses, and a tab that cannot be activated, refuse the jump and stop the watch", async () => {
  const refused = make([tab(1, "https://sender.test/")]);
  await refused.set_mark();
  refused.state.navigate_fails = true;
  await assert.rejects(refused.global_jump(refused.jump(), refused.sender()), /does not let extensions open/);
  assert.equal(refused.watches[0]!.stopped, true);
  const gone = make([tab(1, "https://sender.test/"), tab(2, MARK_URL)]);
  await gone.set_mark();
  gone.state.activate_fails = true;
  await assert.rejects(gone.global_jump(gone.jump(), gone.sender()), /no tab/);
  assert.equal(gone.watches[0]!.stopped, true);
});

test("a jump from a frame is refused, and a private jump never sees a normal mark or tab", async () => {
  const fakes = make([tab(1, "https://sender.test/", { incognito: true }), tab(2, MARK_URL)]);
  await fakes.set_mark();
  await assert.rejects(fakes.global_jump(fakes.jump(), fakes.sender(1, { frame_id: 2 })), /top frame/);
  await assert.rejects(fakes.global_jump(fakes.jump(), fakes.sender(1, { incognito: true })), /No mark A/);
  await fakes.set_mark("A", true);
  fakes.state.tabs = [tab(1, "https://sender.test/", { incognito: true }), tab(2, MARK_URL)];
  await fakes.global_jump(fakes.jump(), fakes.sender(1, { incognito: true }));
  // The normal tab on the address is not a candidate: the private tab navigates.
  assert.deepEqual(fakes.log, ["watch 1", `navigate 1 ${MARK_URL}`]);
});
