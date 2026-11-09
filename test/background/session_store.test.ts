import assert from "node:assert/strict";
import { test } from "node:test";
import { make_session_store, normalize_session_name, plan_restore, session_age } from "../../src/background/session_store.ts";
import type { SessionStorage, SessionTab } from "../../src/background/session_store.ts";
import { SESSIONS_STORAGE_KEY } from "../../src/background/storage_keys.ts";

function fake_storage(initial?: unknown) {
  const values = new Map<string, unknown>(initial === undefined ? [] : [[SESSIONS_STORAGE_KEY, initial]]);
  const fake: SessionStorage & { fail_with?: Error | undefined; writes: number; delay_gets?: Promise<void> | undefined } = {
    writes: 0,
    get: async (key) => {
      await fake.delay_gets;
      return structuredClone(values.get(key));
    },
    set: async (key, value) => {
      if (fake.fail_with) throw fake.fail_with;
      fake.writes += 1;
      values.set(key, structuredClone(value));
    },
  };
  return { fake, values };
}

const tab = (index: number, extra: Partial<SessionTab> = {}): SessionTab => ({
  url: `https://site${index}.test/some/path?q=${"x".repeat(60)}`,
  title: `Title of page ${index}`,
  pinned: false,
  active: index === 0,
  ...extra,
});
const tabs_of = (count: number) => Array.from({ length: count }, (_, index) => tab(index));

test("a saved session reads back with its name, tabs and time, newest first", async () => {
  let clock = 100;
  const store = make_session_store(fake_storage().fake, () => clock++);
  await store.save("old", tabs_of(2));
  await store.save("new", tabs_of(3));
  assert.deepEqual((await store.list()).map(({ name, saved_at }) => [name, saved_at]), [["new", 101], ["old", 100]]);
  assert.deepEqual(await store.items(), [{ name: "new", description: "3 tabs, just now" }, { name: "old", description: "2 tabs, just now" }]);
  assert.deepEqual((await store.get("old")).tabs, tabs_of(2));
});

test("the stored value has the version and the sessions map", async () => {
  const { fake, values } = fake_storage();
  await make_session_store(fake, () => 7).save("a", tabs_of(1));
  assert.deepEqual(values.get(SESSIONS_STORAGE_KEY), { version: 1, sessions: { a: { saved_at: 7, tabs: tabs_of(1) } } });
});

test("names are trimmed, joined with single spaces and unique ignoring case, and an update keeps the display case", async () => {
  const store = make_session_store(fake_storage().fake);
  assert.equal(normalize_session_name("  my   work \n"), "my work");
  await store.save("  Work  Day ", tabs_of(2));
  const update = await store.save("work day", tabs_of(5));
  assert.deepEqual(update, { name: "Work Day", previous_tabs: 2 });
  assert.deepEqual((await store.list()).map((session) => [session.name, session.tabs.length]), [["Work Day", 5]]);
  assert.equal((await store.get("WORK DAY")).name, "Work Day");
  await assert.rejects(store.save("   ", tabs_of(1)), /needs a name/);
  await assert.rejects(store.get("missing"), /No session named "missing"/);
});

test("a session named __proto__ is a plain entry", async () => {
  const { fake, values } = fake_storage();
  const store = make_session_store(fake);
  await store.save("__proto__", tabs_of(1));
  assert.deepEqual(Object.keys((values.get(SESSIONS_STORAGE_KEY) as { sessions: object }).sessions), ["__proto__"]);
  assert.equal((await store.get("__proto__")).tabs.length, 1);
  assert.equal(({} as { saved_at?: number }).saved_at, undefined);
});

test("rename moves the entry, keeps its time and refuses a taken name, but allows a change of case", async () => {
  let clock = 1;
  const store = make_session_store(fake_storage().fake, () => clock++);
  await store.save("a", tabs_of(1));
  await store.save("b", tabs_of(2));
  assert.deepEqual(await store.rename("a", "c"), { from: "a", to: "c" });
  assert.equal((await store.get("c")).saved_at, 1);
  await assert.rejects(store.get("a"), /No session named/);
  await assert.rejects(store.rename("c", "B"), /A session named "b" exists/);
  assert.deepEqual(await store.rename("c", "C"), { from: "c", to: "C" });
  await assert.rejects(store.rename("none", "x"), /No session named/);
  await assert.rejects(store.rename("C", " "), /needs a name/);
});

test("delete removes one session and refuses an unknown name", async () => {
  const store = make_session_store(fake_storage().fake);
  await store.save("a", tabs_of(1));
  await store.save("b", tabs_of(1));
  assert.equal(await store.remove("A"), "a");
  assert.deepEqual((await store.list()).map((session) => session.name), ["b"]);
  await assert.rejects(store.remove("a"), /No session named/);
});

test("saves at the same time all land", async () => {
  const { fake } = fake_storage();
  const store = make_session_store(fake);
  // Every read waits, so unserialized changes would all read the empty value.
  let release!: () => void;
  fake.delay_gets = new Promise((resolve) => (release = resolve));
  const saves = ["a", "b", "c", "d"].map((name) => store.save(name, tabs_of(1)));
  release();
  fake.delay_gets = undefined;
  await Promise.all(saves);
  assert.deepEqual((await store.list()).map((session) => session.name).toSorted(), ["a", "b", "c", "d"]);
});

test("a failed change does not block the next one", async () => {
  const { fake } = fake_storage();
  const store = make_session_store(fake);
  fake.fail_with = new Error("QuotaExceededError");
  await assert.rejects(store.save("a", tabs_of(1)), /Could not store the sessions: QuotaExceededError/);
  fake.fail_with = undefined;
  await store.save("b", tabs_of(1));
  assert.deepEqual((await store.list()).map((session) => session.name), ["b"]);
});

test("a write refused for size leaves the stored sessions as they were", async () => {
  const { fake } = fake_storage();
  const store = make_session_store(fake);
  await store.save("keep", tabs_of(2));
  fake.fail_with = new Error("QuotaExceededError: storage.local quota exceeded");
  await assert.rejects(store.save("big", tabs_of(50)), /quota exceeded/);
  await assert.rejects(store.rename("keep", "other"), /quota exceeded/);
  await assert.rejects(store.remove("keep"), /quota exceeded/);
  fake.fail_with = undefined;
  assert.deepEqual((await store.list()).map((session) => [session.name, session.tabs.length]), [["keep", 2]]);
});

test("100 sessions of 50 tabs round trip, under 2 MB of JSON", async () => {
  const { fake, values } = fake_storage();
  const store = make_session_store(fake);
  for (let index = 0; index < 100; index++) await store.save(`session ${index}`, tabs_of(50));
  assert.equal((await store.list()).length, 100);
  const bytes = JSON.stringify(values.get(SESSIONS_STORAGE_KEY)).length;
  assert.ok(bytes > 500_000 && bytes < 2_000_000, `stored ${bytes} bytes`);
  assert.equal((await store.get("session 99")).tabs.length, 50);
});

test("storage with no value is empty, a newer version is refused and bad entries are dropped", async () => {
  assert.deepEqual(await make_session_store(fake_storage().fake).list(), []);
  const newer = make_session_store(fake_storage({ version: 2, sessions: {} }).fake);
  await assert.rejects(newer.list(), /format this version cannot read/);
  await assert.rejects(newer.save("a", tabs_of(1)), /format this version cannot read/);
  const mixed = make_session_store(fake_storage({ version: 1, sessions: { good: { saved_at: 1, tabs: tabs_of(1) }, bad: { saved_at: "x" }, worse: 5 } }).fake);
  assert.deepEqual((await mixed.list()).map((session) => session.name), ["good"]);
});

test("restore plan: one active tab, the rest discarded, pinned kept", () => {
  const planned = plan_restore([tab(0, { active: false }), tab(1, { active: true, pinned: true }), tab(2, { active: true })], []);
  assert.deepEqual(planned.map((entry) => entry.active), [false, true, false]);
  assert.deepEqual(planned.map((entry) => entry.pinned), [false, true, false]);
  assert.deepEqual(plan_restore([tab(0, { active: false }), tab(1, { active: false })], []).map((entry) => entry.active), [true, false]);
  assert.deepEqual(plan_restore([], []), []);
});

test("restore plan: a container is found by id, then by name, else the default container is used", () => {
  const containers = [{ id: "firefox-container-9", name: "Work" }, { id: "firefox-container-2", name: "Shop" }];
  const planned = plan_restore(
    [
      tab(0, { container_id: "firefox-container-2", container_name: "Shop" }),
      tab(1, { container_id: "firefox-container-1", container_name: "Work" }),
      tab(2, { container_id: "firefox-container-7", container_name: "Gone" }),
      tab(3),
    ],
    containers,
  );
  assert.deepEqual(planned.map((entry) => entry.cookie_store_id), ["firefox-container-2", "firefox-container-9", undefined, undefined]);
  assert.deepEqual(planned.map((entry) => entry.container_lost), [false, false, true, false]);
});

test("session_age picks the biggest whole unit", () => {
  assert.equal(session_age(0, 30_000), "just now");
  assert.equal(session_age(0, 5 * 60_000), "5m ago");
  assert.equal(session_age(0, 150 * 60_000), "2h ago");
  assert.equal(session_age(0, 50 * 3_600_000), "2d ago");
  assert.equal(session_age(10, 0), "just now");
});

test("an entry this version cannot read is written back unchanged by a later change", async () => {
  const bad = { saved_at: "x", from: "a later version" };
  const { fake, values } = fake_storage({ version: 1, sessions: { good: { saved_at: 1, tabs: tabs_of(1) }, odd: bad } });
  const store = make_session_store(fake);
  await store.save("fresh", tabs_of(1));
  await store.rename("good", "better");
  await store.remove("fresh");
  const stored = (values.get(SESSIONS_STORAGE_KEY) as { sessions: Record<string, unknown> }).sessions;
  assert.deepEqual(Object.keys(stored).toSorted(), ["better", "odd"]);
  assert.deepEqual(stored["odd"], bad);
});

test("a new name that an unreadable entry holds is refused by save and rename, and nothing is lost", async () => {
  const bad = { saved_at: "x" };
  const { fake, values } = fake_storage({ version: 1, sessions: { good: { saved_at: 1, tabs: tabs_of(1) }, odd: bad } });
  const store = make_session_store(fake);
  await assert.rejects(store.save("Odd", tabs_of(1)), /A session named "odd" exists/);
  await assert.rejects(store.rename("good", "odd"), /A session named "odd" exists/);
  const stored = (values.get(SESSIONS_STORAGE_KEY) as { sessions: Record<string, unknown> }).sessions;
  assert.deepEqual(Object.keys(stored).toSorted(), ["good", "odd"]);
  assert.deepEqual(stored["odd"], bad);
});
