import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarkTab } from "../../src/background/address_arrival.ts";
import { create_jump_store } from "../../src/background/jump_store.ts";
import type { JumpArea } from "../../src/background/jump_store.ts";
import { create_jump_step } from "../../src/background/jump_step.ts";
import type { PageReady, PageWatch } from "../../src/background/page_ready.ts";
import type { JumpRequest } from "../../src/shared/messages.ts";

const tab = (id: number, url: string, extra: Partial<MarkTab> = {}): MarkTab => ({ id, window_id: 1, index: id, url, incognito: false, last_accessed: id, discarded: false, ...extra });
const HERE = "https://here.test/";
const FAR = "https://far.test/p";

function fake_area() {
  const values = new Map<string, unknown>();
  return {
    get: async (key: string) => Object.fromEntries(values.has(key) ? [[key, structuredClone(values.get(key))]] : []),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value))),
    remove: async (key: string) => void values.delete(key),
  } as unknown as JumpArea;
}

function make(tabs: MarkTab[]) {
  const session = fake_area();
  const store = create_jump_store({ session: () => session });
  const log: string[] = [];
  const watches: { tab_id: number; stopped: boolean; resolve: (result: PageReady) => void; requires_navigation?: boolean | undefined }[] = [];
  const refusals: { tab_id: number; message: string }[] = [];
  const state = { tabs, navigate_fails: false, push_reply: undefined as unknown, during_push: undefined as (() => Promise<unknown>) | undefined };
  const step = create_jump_step({
    store,
    list_tabs: async () => state.tabs,
    activate_tab: async (tab_id) => void log.push(`activate ${tab_id}`),
    focus_window: async (window_id) => void log.push(`focus ${window_id}`),
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
    push_jump: async (tab_id, steps, arrival) => (log.push(`push ${tab_id} ${steps}${arrival ? " arrival" : ""}`), await state.during_push?.(), state.push_reply),
    show_refusal: async (tab_id, message) => void refusals.push({ tab_id, message }),
  });
  const sender = (id = 1, extra = {}) => ({ incognito: false, id, window_id: 1, url: HERE, frame_id: 0, ...extra });
  const push = (y: number, url = FAR, window_id = 1, incognito = false) => step({ type: "jump_push", x: 0, y }, sender(9, { url, window_id, incognito }));
  const go = (delta: number, y = 40, extra = {}, id = 1, arrival = false): Promise<unknown> => step({ type: "jump_step", step: delta, x: 0, y, ...(arrival && { arrival: true }) } as JumpRequest, sender(id, extra));
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const pushes = () => log.filter((line) => line.startsWith("push"));
  return { store, step, log, watches, refusals, state, sender, push, go, flush, pushes };
}

test("a step to a place on the page you are on answers the offset and touches no tab", async () => {
  const fakes = make([tab(1, HERE)]);
  await fakes.push(500, HERE);
  assert.deepEqual(await fakes.go(-1, 0), { ok: true, x: 0, y: 500 });
  assert.deepEqual(await fakes.go(1, 500), { ok: true, x: 0, y: 0 });
  assert.deepEqual(fakes.log, []);
});

test("a step past either end answers a refusal and touches no tab", async () => {
  const fakes = make([tab(1, HERE)]);
  assert.deepEqual(await fakes.go(-1), { ok: false, message: "No older jump" });
  assert.deepEqual(await fakes.go(1), { ok: false, message: "No newer jump" });
  assert.deepEqual(fakes.log, []);
});

test("the hash is not part of the place", async () => {
  const fakes = make([tab(1, `${HERE}#a`)]);
  await fakes.push(500, `${HERE}#b`);
  assert.deepEqual(await fakes.go(-1, 0, { url: `${HERE}#c` }), { ok: true, x: 0, y: 500 });
});

test("a step to a place in another tab switches, answers at once and pushes once the page is ready", async () => {
  const fakes = make([tab(1, HERE), tab(2, FAR)]);
  await fakes.push(500);
  assert.deepEqual(await fakes.go(-1), { ok: true });
  assert.deepEqual(fakes.log, ["watch 2", "activate 2"]);
  assert.equal(fakes.watches[0]!.requires_navigation, false);
  fakes.watches[0]!.resolve("ready");
  await fakes.flush();
  assert.equal(fakes.log.at(-1), "push 2 -1 arrival");
  assert.equal(fakes.watches[0]!.stopped, true);
});

test("a step with no tab on the address opens it in the current tab and waits for the navigation", async () => {
  const fakes = make([tab(1, HERE)]);
  await fakes.push(500);
  assert.deepEqual(await fakes.go(-1), { ok: true });
  assert.deepEqual(fakes.log, ["watch 1", `navigate 1 ${FAR}`]);
  assert.equal(fakes.watches[0]!.requires_navigation, true);
  fakes.watches[0]!.resolve("ready");
  await fakes.flush();
  assert.equal(fakes.log.at(-1), "push 1 -1 arrival");
});

test("a step that Firefox refuses to open answers a refusal and leaves no wait behind", async () => {
  const fakes = make([tab(1, HERE)]);
  await fakes.push(500);
  fakes.state.navigate_fails = true;
  const answer = (await fakes.go(-1)) as { ok: boolean; message: string };
  assert.equal(answer.ok, false);
  assert.match(answer.message, /does not let extensions open/);
  assert.equal(fakes.watches[0]!.stopped, true);
});

test("the page the push reaches gets the chosen entry and moves the cursor no further, whatever address it ended on", async () => {
  const fakes = make([tab(1, HERE)]);
  await fakes.push(500);
  await fakes.push(900);
  let arrival: unknown;
  fakes.state.during_push = async () => {
    // The tab redirected, so its address is neither the entry's nor the tab's old one.
    arrival = await fakes.go(-1, 0, { url: "https://login.test/" }, 1, true);
  };
  await fakes.go(-1);
  fakes.watches[0]!.resolve("ready");
  await fakes.flush();
  assert.deepEqual(arrival, { ok: true, x: 0, y: 900 });
  assert.equal(fakes.log.filter((line) => line.startsWith("navigate")).length, 1);
  // The entry is spent: the next step moves the cursor on, to the older place.
  fakes.state.tabs = [tab(1, "https://login.test/")];
  assert.deepEqual(await fakes.go(-1, 0, { url: FAR }), { ok: true, x: 0, y: 500 });
});

test("a step the user pressed before the pushed one arrives is a step of its own, and the pushed one then takes the arrival", async () => {
  const fakes = make([tab(1, HERE)]);
  await fakes.push(500);
  await fakes.push(900);
  let user: unknown;
  fakes.state.during_push = async () => {
    // The user pressed newer in the target tab before the pushed request got to the background.
    user = await fakes.go(1, 0, { url: FAR });
  };
  await fakes.go(-1);
  fakes.watches[0]!.resolve("ready");
  await fakes.flush();
  // The user's step was a real step: from the entry the step chose, newer is the place the first step left, which is this tab.
  assert.deepEqual(user, { ok: true });
  assert.deepEqual(fakes.log.filter((line) => line.startsWith("activate")), ["activate 1"]);
  // The pushed request found its arrival replaced and did not step a third time.
  assert.deepEqual(fakes.pushes(), ["push 1 -1 arrival"]);
});

test("a pushed request with no arrival waiting does not step", async () => {
  const fakes = make([tab(1, HERE)]);
  await fakes.push(500, HERE);
  assert.deepEqual(await fakes.go(-1, 0, {}, 1, true), { ok: true });
  // The list was not touched: the older place is still ahead of the cursor.
  assert.deepEqual(await fakes.go(-1, 0), { ok: true, x: 0, y: 500 });
});

test("a place whose tab is in another window opens in the current tab, since that window keeps another list", async () => {
  const fakes = make([tab(1, HERE), tab(2, FAR, { window_id: 2 })]);
  await fakes.push(500);
  assert.deepEqual(await fakes.go(-1), { ok: true });
  assert.deepEqual(fakes.log, ["watch 1", `navigate 1 ${FAR}`]);
});

test("a tab closed while it loads is silent, pushes nothing and clears the entry", async () => {
  const fakes = make([tab(1, HERE)]);
  await fakes.push(500);
  await fakes.go(-1);
  fakes.watches[0]!.resolve("gone");
  await fakes.flush();
  assert.deepEqual(fakes.refusals, []);
  assert.deepEqual(fakes.pushes(), []);
  // No stale entry: a step from the same tab id is a new step, not an arrival.
  await fakes.push(700);
  assert.deepEqual(await fakes.go(-1, 0, { url: FAR }), { ok: true, x: 0, y: 700 });
});

test("a tab that closed before the step reads as no tab on the address and the address opens in the current tab", async () => {
  const fakes = make([tab(1, HERE), tab(2, FAR)]);
  await fakes.push(500);
  fakes.state.tabs = [tab(1, HERE)];
  await fakes.go(-1);
  assert.deepEqual(fakes.log, ["watch 1", `navigate 1 ${FAR}`]);
});

test("a timeout and a page with no script each show one refusal on the target tab and push nothing", async () => {
  for (const [result, text] of [["timeout", /did not finish/], ["no_script", /does not run/]] as const) {
    const fakes = make([tab(1, HERE), tab(2, FAR)]);
    await fakes.push(500);
    await fakes.go(-1);
    fakes.watches[0]!.resolve(result);
    await fakes.flush();
    assert.equal(fakes.refusals.length, 1, result);
    assert.equal(fakes.refusals[0]!.tab_id, 2);
    assert.match(fakes.refusals[0]!.message, text);
    assert.deepEqual(fakes.pushes(), []);
  }
});

test("a newer step supersedes the unfinished one: only the last wait pushes", async () => {
  const fakes = make([tab(1, HERE)]);
  await fakes.push(500);
  await fakes.push(900);
  await fakes.go(-1);
  await fakes.go(-1);
  assert.equal(fakes.watches.length, 2);
  fakes.watches[0]!.resolve("ready");
  await fakes.flush();
  assert.deepEqual(fakes.pushes(), []);
  fakes.watches[1]!.resolve("ready");
  await fakes.flush();
  assert.equal(fakes.pushes().length, 1);
});

test("two fast steps back walk the list in order and each sees the other's cursor", async () => {
  const fakes = make([tab(1, HERE)]);
  for (const y of [100, 200, 300]) await fakes.push(y, HERE);
  const answers = await Promise.all([fakes.go(-1, 0), fakes.go(-1, 0)]);
  assert.deepEqual(answers, [
    { ok: true, x: 0, y: 300 },
    { ok: true, x: 0, y: 200 },
  ]);
});

test("a normal and a private window keep their lists apart, and the private step finds only private tabs", async () => {
  const fakes = make([tab(1, HERE, { incognito: true }), tab(2, FAR)]);
  await fakes.push(500);
  await fakes.push(700, FAR, 1, true);
  assert.deepEqual(await fakes.go(-1, 0, { incognito: true }), { ok: true });
  // The normal tab 2 has the address but is not private, so the private tab opens it.
  assert.deepEqual(fakes.log, ["watch 1", `navigate 1 ${FAR}`]);
  assert.deepEqual(await fakes.go(-1, 0, { incognito: true }), { ok: false, message: "No older jump" });
});

test("a step from a child frame asks the top frame, which steps from its own offset", async () => {
  const fakes = make([tab(1, HERE)]);
  await fakes.push(500, HERE);
  assert.deepEqual(await fakes.go(-2, 40, { frame_id: 3 }), { ok: true });
  assert.deepEqual(fakes.log, ["push 1 -2"]);
  fakes.state.push_reply = { ok: false, message: "No older jump" };
  assert.deepEqual(await fakes.go(-1, 40, { frame_id: 3 }), { ok: false, message: "No older jump" });
  // The cursor was not touched by the frame.
  assert.deepEqual(await fakes.go(-1, 0), { ok: true, x: 0, y: 500 });
});

test("a push from a child frame or with no tab refuses", async () => {
  const fakes = make([tab(1, HERE)]);
  assert.deepEqual(await fakes.step({ type: "jump_push", x: 0, y: 5 }, fakes.sender(1, { frame_id: 2 })), { ok: false, message: "The jump list needs the top frame" });
  assert.deepEqual(await fakes.step({ type: "jump_push", x: 0, y: 5 }, undefined), { ok: false, message: "No page to jump from" });
  assert.deepEqual(await fakes.step({ type: "jump_step", step: -1, x: 0, y: 5 }, fakes.sender(1, { url: undefined })), { ok: false, message: "No page to jump from" });
});

test("two quick steps from one tab to two other tabs: the newer step wins, one scroll lands and its tab is active last", async () => {
  const fakes = make([tab(1, HERE), tab(2, "https://a.test/"), tab(3, "https://b.test/")]);
  await fakes.push(100, "https://a.test/");
  await fakes.push(200, "https://b.test/");
  const first = fakes.go(-1, 0);
  const second = fakes.go(-1, 0);
  await Promise.all([first, second]);
  await fakes.flush();
  for (const watch of fakes.watches) watch.resolve("ready");
  await fakes.flush();
  await fakes.flush();
  const activations = fakes.log.filter((line) => line.startsWith("activate"));
  assert.equal(activations.at(-1), "activate 2", fakes.log.join(" | "));
  assert.deepEqual(fakes.pushes(), ["push 2 -1 arrival"], fakes.log.join(" | "));
});
