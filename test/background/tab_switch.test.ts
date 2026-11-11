import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { create_tab_switch, PREFACE_LIFETIME_MS } from "../../src/background/tab_switch.ts";
import type { TabInfo, TabSwitchDeps, WindowInfo } from "../../src/background/tab_switch.ts";

const WINDOWS: WindowInfo[] = [
  { id: 1, type: "normal", incognito: false },
  { id: 2, type: "normal", incognito: true },
  { id: 3, type: "popup", incognito: false },
];
const TABS: TabInfo[] = [
  { id: 10, windowId: 1, title: "Mail", url: "https://mail.example/", active: true, audible: false, incognito: false, favIconUrl: "https://mail.example/i.png", lastAccessed: 5 },
  { id: 11, windowId: 1, title: "Music", url: "https://music.example/", audible: true, incognito: false, favIconUrl: "data:image/png;base64,AAAA", width: 2560, height: 1440 },
  { id: 12, windowId: 1, title: "Asleep", url: "https://sleep.example/", discarded: true, incognito: false },
  { id: 20, windowId: 2, title: "Secret", url: "https://secret.example/", incognito: true },
  { id: 30, windowId: 3, title: "Popup", url: "https://popup.example/", incognito: false },
  { id: 40, windowId: 1, title: "Odd", url: "https://odd.example/" },
];

function make(options: { windows?: WindowInfo[]; tabs?: TabInfo[]; fail?: Set<string>; fail_once?: Set<string>; focused?: number } = {}) {
  const calls: string[] = [];
  const timers: { run: () => void; delay_ms: number }[] = [];
  const windows = options.windows ?? WINDOWS;
  const tabs = options.tabs ?? TABS;
  const fail = options.fail ?? new Set<string>();
  const fail_once = options.fail_once ?? new Set<string>();
  const step = (name: string) => {
    calls.push(name);
    if (fail_once.delete(name)) throw new Error("failed once");
    if (fail.has(name.split(" ")[0]!)) throw new Error('Tab "Secret bank" failed');
  };
  const gates: (() => void)[] = [];
  const deps: TabSwitchDeps = {
    windows: async () => windows,
    window: async (id) => windows.find((window) => window.id === id),
    last_focused_window: async () => windows.find((window) => window.id === (options.focused ?? 1)),
    tabs: async () => tabs,
    tab: async (id) => tabs.find((tab) => tab.id === id),
    select: async (id) => step(`select ${id}`),
    focus_window: async (id) => step(`focus ${id}`),
    set_preface: async (id, text) => {
      step(`preface ${id} ${JSON.stringify(text)}`);
      // A test can hold the first title write to prove the second activation waits for it.
      if (gates.length > 0 && text !== "") await new Promise<void>((resolve) => gates.push(resolve));
    },
    remove: async (id) => step(`remove ${id}`),
    capture: async (id, capture_options) => (step(`capture ${id} ${JSON.stringify(capture_options)}`), "data:image/jpeg;base64,/9j/"),
    after: (run, delay_ms) => void timers.push({ run, delay_ms }),
  };
  return { tab_switch: create_tab_switch(deps), calls, timers, gates };
}

const NO_SUCH_TAB = { ok: false, message: "no such tab" };

test("tabs lists the tabs of normal windows with their flags and leaves out private, popup and unmarked tabs", async () => {
  const answer = (await make().tab_switch.handle("tabs", {})) as { ok: true; tabs: Record<string, unknown>[] };
  assert.deepEqual(answer.tabs.map((tab) => tab.tab_id), [10, 11, 12]);
  assert.deepEqual(answer.tabs[0], { tab_id: 10, window_id: 1, title: "Mail", url: "https://mail.example/", active: true, audible: false, discarded: false, last_accessed: 5, pinned: false, hidden: false, fav_icon_url: "https://mail.example/i.png", fav_icon_key: "" });
  assert.equal(answer.tabs[1]!.audible, true);
  assert.equal(answer.tabs[1]!.fav_icon_url, "", "a data URL icon is dropped");
  assert.doesNotMatch(JSON.stringify(answer), /Secret|secret|Popup/);
});

test("a tab of a private window is refused by activate, close and capture with the same text as a missing id", async () => {
  const test_case = make();
  for (const verb of ["activate", "close", "capture"] as const) {
    for (const tab_id of [20, 30, 40, 999, -1]) assert.deepEqual(await test_case.tab_switch.handle(verb, { tab_id }), NO_SUCH_TAB, `${verb} ${tab_id}`);
  }
  assert.deepEqual(test_case.calls, []);
});

test("a tab id that is not a whole number is refused", async () => {
  const test_case = make();
  for (const tab_id of ["10", 1.5, null, undefined, {}, [10]]) assert.deepEqual(await test_case.tab_switch.handle("close", { tab_id }), NO_SUCH_TAB);
  assert.deepEqual(test_case.calls, []);
});

test("a tab whose window cannot be read is refused", async () => {
  const test_case = make({ windows: [] });
  assert.deepEqual(await test_case.tab_switch.handle("close", { tab_id: 10 }), NO_SUCH_TAB);
});

test("activate selects the tab, focuses its window and sets the preface, which clears itself after its lifetime", async () => {
  const test_case = make();
  assert.deepEqual(await test_case.tab_switch.handle("activate", { tab_id: 11, preface: "abc123" }), { ok: true, window_id: 1, focused: true, preface_set: true });
  assert.deepEqual(test_case.calls, ["select 11", "focus 1", 'preface 1 "abc123 "']);
  assert.equal(test_case.timers[0]!.delay_ms, PREFACE_LIFETIME_MS);
  test_case.timers[0]!.run();
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(test_case.calls.at(-1), 'preface 1 ""');
});

test("activate without a preface leaves the title alone, and a bad preface is refused before anything happens", async () => {
  const test_case = make();
  assert.deepEqual(await test_case.tab_switch.handle("activate", { tab_id: 10 }), { ok: true, window_id: 1, focused: true, preface_set: false });
  assert.deepEqual(test_case.calls, ["select 10", "focus 1"]);
  for (const preface of ["", "a b", "x".repeat(33), "a;b", 5]) assert.equal(((await test_case.tab_switch.handle("activate", { tab_id: 10, preface })) as { ok: boolean }).ok, false);
  assert.equal(test_case.calls.length, 2);
});

test("a window that will not focus, or a title that will not change, still reports the activation", async () => {
  const test_case = make({ fail: new Set(["focus", "preface"]) });
  assert.deepEqual(await test_case.tab_switch.handle("activate", { tab_id: 10, preface: "abc" }), { ok: true, window_id: 1, focused: false, preface_set: false });
});

test("a failure carries fixed text and never the browser's message", async () => {
  const test_case = make({ fail: new Set(["select", "remove", "capture"]) });
  assert.deepEqual(await test_case.tab_switch.handle("activate", { tab_id: 10 }), { ok: false, message: "the tab could not be activated" });
  assert.deepEqual(await test_case.tab_switch.handle("close", { tab_id: 10 }), { ok: false, message: "close failed" });
  assert.deepEqual(await test_case.tab_switch.handle("capture", { tab_id: 10 }), { ok: false, message: "capture failed" });
});

test("a clear with an older preface leaves a newer one alone", async () => {
  const test_case = make();
  await test_case.tab_switch.handle("activate", { tab_id: 10, preface: "old" });
  await test_case.tab_switch.handle("activate", { tab_id: 11, preface: "new" });
  assert.deepEqual(await test_case.tab_switch.handle("clear_preface", { window_id: 1, preface: "old" }), { ok: true, cleared: false });
  assert.deepEqual(await test_case.tab_switch.handle("clear_preface", { window_id: 1, preface: "new" }), { ok: true, cleared: true });
  assert.equal(test_case.calls.at(-1), 'preface 1 ""');
  // The first timer is the old activation's, and it must not clear what is gone or newer.
  const before = test_case.calls.length;
  test_case.timers[0]!.run();
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(test_case.calls.length, before);
});

test("a clear without a preface clears whatever is there, and a private or bad window is refused", async () => {
  const test_case = make();
  assert.deepEqual(await test_case.tab_switch.handle("clear_preface", { window_id: 1 }), { ok: true, cleared: true });
  assert.deepEqual(await test_case.tab_switch.handle("clear_preface", { window_id: 2 }), { ok: false, message: "no such window" });
  assert.deepEqual(await test_case.tab_switch.handle("clear_preface", { window_id: 3 }), { ok: false, message: "no such window" });
  assert.equal(((await test_case.tab_switch.handle("clear_preface", { window_id: "1" })) as { ok: boolean }).ok, false);
  assert.deepEqual(test_case.calls, ['preface 1 ""']);
});

test("activations that arrive together run one after another, so the last preface is the one the clear checks", async () => {
  const test_case = make();
  test_case.gates.push(() => undefined);
  const first = test_case.tab_switch.handle("activate", { tab_id: 10, preface: "aaa" });
  const second = test_case.tab_switch.handle("activate", { tab_id: 11, preface: "bbb" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(test_case.calls, ["select 10", "focus 1", 'preface 1 "aaa "'], "the second waits for the first");
  test_case.gates.slice(1).forEach((release) => release());
  await new Promise((resolve) => setTimeout(resolve, 5));
  test_case.gates.slice(1).forEach((release) => release());
  assert.deepEqual(await Promise.all([first, second]), [
    { ok: true, window_id: 1, focused: true, preface_set: true },
    { ok: true, window_id: 1, focused: true, preface_set: true },
  ]);
  assert.deepEqual(test_case.calls.slice(3), ["select 11", "focus 1", 'preface 1 "bbb "']);
  assert.deepEqual(await test_case.tab_switch.handle("clear_preface", { window_id: 1, preface: "aaa" }), { ok: true, cleared: false });
  assert.deepEqual(await test_case.tab_switch.handle("clear_preface", { window_id: 1, preface: "bbb" }), { ok: true, cleared: true });
});

test("a failed activation does not stop the next one", async () => {
  const test_case = make();
  const results = await Promise.all([test_case.tab_switch.handle("activate", { tab_id: 999 }), test_case.tab_switch.handle("activate", { tab_id: 10 })]);
  assert.deepEqual(results.map((result) => result.ok), [false, true]);
});

test("close removes a normal tab", async () => {
  const test_case = make();
  assert.deepEqual(await test_case.tab_switch.handle("close", { tab_id: 12 }), { ok: true });
  assert.deepEqual(test_case.calls, ["remove 12"]);
});

test("capture renders a loaded tab at a scale that fits the box, refuses an unloaded one and returns the address with the image", async () => {
  const test_case = make();
  assert.deepEqual(await test_case.tab_switch.handle("capture", { tab_id: 11 }), { ok: true, tab_id: 11, url: "https://music.example/", data_url: "data:image/jpeg;base64,/9j/" });
  assert.equal(test_case.calls[0], `capture 11 ${JSON.stringify({ format: "jpeg", quality: 80, scale: 0.5 })}`);
  assert.deepEqual(await test_case.tab_switch.handle("capture", { tab_id: 12 }), { ok: false, message: "the tab is not loaded" });
  assert.equal(test_case.calls.length, 1);
});

test("a clear that arrives while a newer activation is still writing its title waits and then leaves the newer preface alone", async () => {
  const test_case = make();
  await test_case.tab_switch.handle("activate", { tab_id: 10, preface: "aaa" });
  // The no-op entry turns the hold on: the next title write waits until its resolver in `gates` is called.
  test_case.gates.push(() => undefined);
  const second = test_case.tab_switch.handle("activate", { tab_id: 11, preface: "bbb" });
  const clear = test_case.tab_switch.handle("clear_preface", { window_id: 1, preface: "aaa" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(test_case.calls.filter((call) => call === 'preface 1 ""').length, 0, "the clear waits for the activation");
  test_case.gates[1]!();
  assert.deepEqual(await clear, { ok: true, cleared: false });
  assert.equal((await second).ok, true);
  assert.equal(test_case.calls.filter((call) => call === 'preface 1 ""').length, 0);
});

test("a clear whose title write fails keeps the preface, so the timer clear still clears it", async () => {
  const test_case = make({ fail_once: new Set(['preface 1 ""']) });
  await test_case.tab_switch.handle("activate", { tab_id: 10, preface: "aaa" });
  assert.deepEqual(await test_case.tab_switch.handle("clear_preface", { window_id: 1, preface: "aaa" }), { ok: false, message: "clear_preface failed" });
  assert.deepEqual(await test_case.tab_switch.handle("clear_preface", { window_id: 1, preface: "aaa" }), { ok: true, cleared: true });
});

const ICON_DATA_URL = "data:image/png;base64,AAAA";

test("a data URL icon is named by the SHA-256 of its text and an address icon has no key", async () => {
  const answer = (await make().tab_switch.handle("tabs", {})) as { ok: true; tabs: Record<string, unknown>[] };
  assert.equal(answer.tabs[0]!.fav_icon_key, "");
  assert.equal(answer.tabs[1]!.fav_icon_key, createHash("sha256").update(ICON_DATA_URL).digest("hex"));
});

test("tabs with current lists only the active tab of the last focused window, and none for a private or popup window", async () => {
  const listed = async (focused: number) => ((await make({ focused }).tab_switch.handle("tabs", { current: true })) as { ok: true; tabs: Record<string, unknown>[] }).tabs.map((tab) => tab.tab_id);
  assert.deepEqual(await listed(1), [10]);
  assert.deepEqual(await listed(2), []);
  assert.deepEqual(await listed(3), []);
  assert.deepEqual(await listed(99), []);
  assert.deepEqual(await listed(1), [10]);
  const every = (await make({ focused: 2 }).tab_switch.handle("tabs", { current: false })) as { ok: true; tabs: unknown[] };
  assert.equal(every.tabs.length, 3, "current false lists every tab");
});

test("favicon hands over a stored icon of a normal tab and refuses anything else", async () => {
  const big = `data:image/png;base64,${"A".repeat(512 * 1024)}`;
  const test_case = make({ tabs: [...TABS, { id: 13, windowId: 1, incognito: false, favIconUrl: big }, { id: 21, windowId: 2, incognito: true, favIconUrl: ICON_DATA_URL }] });
  assert.deepEqual(await test_case.tab_switch.handle("favicon", { tab_id: 11 }), { ok: true, data_url: ICON_DATA_URL });
  assert.deepEqual(await test_case.tab_switch.handle("favicon", { tab_id: 10 }), { ok: false, message: "the tab has no stored icon" });
  assert.deepEqual(await test_case.tab_switch.handle("favicon", { tab_id: 13 }), { ok: false, message: "the tab has no stored icon" });
  for (const tab_id of [21, 30, 999]) assert.deepEqual(await test_case.tab_switch.handle("favicon", { tab_id }), NO_SUCH_TAB);
  const listed = (await test_case.tab_switch.handle("tabs", {})) as { ok: true; tabs: Record<string, unknown>[] };
  assert.equal(listed.tabs.find((tab) => tab.tab_id === 13)!.fav_icon_key, "", "an icon too large to hand over gets no key");
});
