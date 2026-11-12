import assert from "node:assert/strict";
import { test } from "node:test";
import { create_jump_leave, type TabNow } from "../../src/background/jump_leave.ts";
import { create_jump_store } from "../../src/background/jump_store.ts";
import type { JumpArea } from "../../src/background/jump_store.ts";

function fake_area() {
  const values = new Map<string, unknown>();
  return {
    get: async (key: string) => Object.fromEntries(values.has(key) ? [[key, structuredClone(values.get(key))]] : []),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value))),
    remove: async (key: string) => void values.delete(key),
  } as unknown as JumpArea;
}

const A = "https://a.test/";
const B = "https://b.test/";
const C = "https://c.test/";

// Each case drives one order of the three events of a leave: the page's report, the address change and the end of the load. `now` is the tab as Firefox shows it at that moment.
function make() {
  const session = fake_area();
  const store = create_jump_store({ session: () => session });
  const now: { tab: TabNow | undefined } = { tab: { url: A, status: "complete" } };
  const leave = create_jump_leave({ store, tab_now: async () => now.tab });
  const sender = (extra = {}) => ({ incognito: false, id: 5, window_id: 1, url: A, frame_id: 0, ...extra });
  // `page_url` is the address the page shows as it hides. `document_url` is the sender's, the address the document loaded at, which a pushState does not change.
  const report = (document_url = A, extra = {}, page_url = document_url) => leave.leave({ type: "jump_leave", url: page_url, x: 0, y: 700 }, sender(extra), document_url);
  // The tab moves on, and its onUpdated event is handled.
  const tab_at = (url: string, status: string, incognito = false) => {
    now.tab = { url, status };
    return leave.updated({ tab_id: 5, incognito, url, status }, status === "complete" ? { status } : { url });
  };
  // The tab moves on, but its onUpdated event is not handled yet.
  const tab_quietly_at = (url: string, status: string) => void (now.tab = { url, status });
  // The whole stored list of window 1, read without moving the cursor.
  const places = async (is_private = false) => {
    const key = is_private ? "desertfox_private_jumps" : "desertfox_jumps";
    const stored = (await session.get(key)) as Record<string, { windows?: Record<string, { entries: unknown[] }> }>;
    return stored[key]?.windows?.["1"]?.entries ?? [];
  };
  return { leave, store, now, report, tab_at, tab_quietly_at, places };
}

const LEFT_A = [{ url: A, x: 0, y: 700 }];

test("report, then the address change: records the page left", async () => {
  const { report, tab_at, tab_quietly_at, places } = make();
  tab_quietly_at(A, "loading");
  await report();
  assert.deepEqual(await places(), [], "recorded before the tab showed where it went");
  await tab_at(B, "loading");
  await tab_at(B, "complete");
  assert.deepEqual(await places(), LEFT_A);
});

test("the address change, then the report: records the page left", async () => {
  const { report, tab_at, places } = make();
  await tab_at(B, "loading");
  await report();
  assert.deepEqual(await places(), LEFT_A);
});

test("the address change and the end of the load, then the report: records the page left", async () => {
  const { report, tab_at, places } = make();
  await tab_at(B, "loading");
  await tab_at(B, "complete");
  await report();
  assert.deepEqual(await places(), LEFT_A);
});

test("the address change shows in the tab before its event is handled: records once", async () => {
  const { report, tab_at, tab_quietly_at, places } = make();
  tab_quietly_at(B, "loading");
  await report();
  await tab_at(B, "loading");
  await tab_at(B, "complete");
  assert.deepEqual(await places(), LEFT_A);
});

test("a reload records nothing, with the report before or after the end of the load", async () => {
  const first = make();
  first.tab_quietly_at(A, "loading");
  await first.report();
  await first.tab_at(A, "complete");
  await first.tab_at(B, "loading");
  assert.deepEqual(await first.places(), [], "report first");
  const last = make();
  await last.tab_at(A, "complete");
  await last.report();
  await last.tab_at(B, "loading");
  assert.deepEqual(await last.places(), [], "report last");
});

test("an earlier hash change neither ends nor takes the next leave", async () => {
  const { report, tab_at, tab_quietly_at, places } = make();
  await tab_at(`${A}#sec`, "complete");
  tab_quietly_at(`${A}#sec`, "loading");
  await report(`${A}#sec`);
  assert.deepEqual(await places(), []);
  await tab_at(B, "loading");
  assert.deepEqual(await places(), LEFT_A);
});

test("a hash change while an offset waits keeps it waiting", async () => {
  const { report, tab_at, tab_quietly_at, places } = make();
  tab_quietly_at(A, "loading");
  await report();
  await tab_at(`${A}#x`, "loading");
  assert.deepEqual(await places(), []);
  await tab_at(B, "loading");
  assert.deepEqual(await places(), LEFT_A);
});

test("a redirect chain records once, for the page the user left", async () => {
  const { report, tab_at, tab_quietly_at, places } = make();
  tab_quietly_at(A, "loading");
  await report();
  await tab_at(B, "loading");
  await tab_at(C, "loading");
  await tab_at(C, "complete");
  assert.deepEqual(await places(), LEFT_A);
});

test("a jump step's navigation records nothing, in every event order", async () => {
  const orders: Record<string, (fixture: ReturnType<typeof make>) => Promise<void>> = {
    "report first": async ({ report, tab_at, tab_quietly_at }) => {
      tab_quietly_at(A, "loading");
      await report();
      await tab_at(B, "loading");
      await tab_at(B, "complete");
    },
    "address change first": async ({ report, tab_at }) => {
      await tab_at(B, "loading");
      await report();
      await tab_at(B, "complete");
    },
    // The step's arrival has ended by the time the report comes.
    "report after the load ended": async ({ report, tab_at }) => {
      await tab_at(B, "loading");
      await tab_at(B, "complete");
      await report();
    },
  };
  for (const [name, run] of Object.entries(orders)) {
    const fixture = make();
    await fixture.store.mark_step(5, false, A);
    await run(fixture);
    assert.deepEqual(await fixture.places(), [], name);
  }
});

test("a step mark ends with the leave it marked, so the next leave records", async () => {
  const { store, report, tab_at, places } = make();
  await store.mark_step(5, false, A);
  await tab_at(B, "loading");
  await report();
  await tab_at(B, "complete");
  await tab_at(C, "loading");
  await report(B, { url: B });
  assert.deepEqual(await places(), [{ url: B, x: 0, y: 700 }]);
});

test("a step mark from another page does not hide this page's leave", async () => {
  const { store, report, tab_at, places } = make();
  await store.mark_step(5, false, C);
  await tab_at(B, "loading");
  await report();
  assert.deepEqual(await places(), LEFT_A);
});

test("a child frame, and a tab that closed, record nothing", async () => {
  const { leave, now, report, tab_at, tab_quietly_at, places } = make();
  tab_quietly_at(A, "loading");
  await report(A, { frame_id: 2 });
  await tab_at(B, "loading");
  assert.deepEqual(await places(), [], "child frame");
  await tab_at(A, "loading");
  await report();
  await leave.forget(5);
  await tab_at(B, "loading");
  assert.deepEqual(await places(), [], "forgotten tab");
  now.tab = undefined;
  await report();
  await tab_at(C, "loading");
  assert.deepEqual(await places(), [], "report after the tab closed");
});

test("a private tab records in the private list only", async () => {
  const { report, tab_at, tab_quietly_at, places } = make();
  tab_quietly_at(A, "loading");
  await report(A, { incognito: true });
  await tab_at(B, "loading", true);
  assert.deepEqual(await places(false), []);
  assert.deepEqual(await places(true), LEFT_A);
});

test("the report and the address change handled at once record once", async () => {
  for (const report_first of [true, false]) {
    const { report, tab_at, tab_quietly_at, places } = make();
    tab_quietly_at(A, "loading");
    const both = report_first ? [report(), tab_at(B, "loading")] : [tab_at(B, "loading"), report()];
    await Promise.all(both);
    await tab_at(B, "complete");
    assert.deepEqual(await places(), LEFT_A, report_first ? "report first" : "address change first");
  }
});

test("a step that comes while a leave records sees the recorded place, so the push cannot cut the step's list", async () => {
  const { store, report, tab_at, tab_quietly_at, places } = make();
  await store.push(1, false, { url: C, x: 0, y: 100 });
  tab_quietly_at(A, "loading");
  await report();
  // The address change records A, and a step from B is asked for right behind it.
  const [, stepped] = await Promise.all([tab_at(B, "loading"), store.step(1, false, -1, { url: B, x: 0, y: 0 })]);
  assert.deepEqual(stepped, { url: A, x: 0, y: 700 });
  assert.deepEqual(await places(), [{ url: C, x: 0, y: 100 }, { url: A, x: 0, y: 700 }, { url: B, x: 0, y: 0 }]);
});

// A single-page app's address change reports the url change with status complete and no page hides, so the page's leave watch records it instead.
test("an address change within the page, with no report held, records nothing", async () => {
  const { leave, now, places } = make();
  now.tab = { url: `${A}next`, status: "complete" };
  await leave.updated({ tab_id: 5, incognito: false, url: `${A}next`, status: "complete" }, { url: `${A}next`, status: "complete" });
  assert.deepEqual(await places(), []);
});

test("a page that changed its address in place reports the address it shows, so a step mark from there drops it and another leave records it", async () => {
  const stepped = make();
  await stepped.store.mark_step(5, false, `${A}section`);
  await stepped.tab_at(B, "loading");
  await stepped.report(A, {}, `${A}section`);
  assert.deepEqual(await stepped.places(), []);
  const left = make();
  await left.tab_at(B, "loading");
  await left.report(A, {}, `${A}section#part`);
  assert.deepEqual(await left.places(), [{ url: `${A}section`, x: 0, y: 700 }]);
});

test("a report naming another site than the document's records nothing", async () => {
  const { report, tab_at, places } = make();
  await tab_at(B, "loading");
  await report(A, {}, C);
  assert.deepEqual(await places(), []);
});
