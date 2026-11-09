import assert from "node:assert/strict";
import { test } from "node:test";
import { make_session_store } from "../../src/background/session_store.ts";
import type { SessionStorage, SessionTab } from "../../src/background/session_store.ts";
import { answer_sessions_transfer } from "../../src/background/sessions_transfer.ts";
import { SESSIONS_STORAGE_KEY } from "../../src/background/storage_keys.ts";

function fake_storage(initial?: unknown) {
  const values = new Map<string, unknown>(initial === undefined ? [] : [[SESSIONS_STORAGE_KEY, initial]]);
  const storage: SessionStorage = {
    get: async (key) => structuredClone(values.get(key)),
    set: async (key, value) => void values.set(key, structuredClone(value)),
  };
  return { storage, values };
}

const tab = (url: string): SessionTab => ({ url, title: url, pinned: false, active: true });
const session = (url: string, saved_at = 1) => ({ saved_at, tabs: [tab(url)] });
const file_of = (sessions: Record<string, unknown>) => JSON.stringify({ version: 1, sessions });
const names_of = async (store: ReturnType<typeof make_session_store>) => (await store.list()).map(({ name }) => name).toSorted();

test("an export holds the stored shape and an import of it into an empty store restores every session", async () => {
  const source = make_session_store(fake_storage().storage, () => 5);
  await source.save("work", [tab("https://a.test/")]);
  await source.save("home", [tab("https://b.test/"), tab("https://c.test/")]);
  const { json, count } = await source.export_json();
  assert.equal(count, 2);
  assert.equal(JSON.parse(json).version, 1);

  const target = make_session_store(fake_storage().storage);
  assert.deepEqual(await target.import_json(json), { added: ["work", "home"], skipped: [] });
  assert.deepEqual((await target.get("home")).tabs, [tab("https://b.test/"), tab("https://c.test/")]);
  assert.equal((await target.get("work")).saved_at, 5);
});

test("an export of an empty store has a count of 0", async () => {
  assert.equal((await make_session_store(fake_storage().storage).export_json()).count, 0);
});

test("a name clash keeps both and the import gets a suffix, even when the stored name has one", async () => {
  const { storage } = fake_storage();
  const store = make_session_store(storage);
  await store.save("Work", [tab("https://stored.test/")]);
  await store.import_json(file_of({ work: session("https://one.test/") }));
  assert.deepEqual(await names_of(store), ["Work", "work (2)"]);
  assert.equal((await store.get("Work")).tabs[0]!.url, "https://stored.test/");
  assert.equal((await store.get("work (2)")).tabs[0]!.url, "https://one.test/");

  // `work (2)` is taken now, so the next import of `work` takes `(3)`.
  assert.deepEqual((await store.import_json(file_of({ work: session("https://two.test/") }))).added, ["work (3)"]);
  // A name that already has a suffix and clashes gets another one.
  assert.deepEqual((await store.import_json(file_of({ "work (2)": session("https://three.test/") }))).added, ["work (2) (2)"]);
});

test("two entries of one file that differ only in case do not overwrite each other", async () => {
  const store = make_session_store(fake_storage().storage);
  const result = await store.import_json(file_of({ A: session("https://a.test/"), a: session("https://b.test/") }));
  assert.deepEqual(result.added, ["A", "a (2)"]);
});

test("a name that an unreadable stored entry holds counts as taken", async () => {
  const { storage, values } = fake_storage({ version: 1, sessions: { future: { shape: "newer" } } });
  const store = make_session_store(storage);
  assert.deepEqual((await store.import_json(file_of({ future: session("https://a.test/") }))).added, ["future (2)"]);
  assert.deepEqual((values.get(SESSIONS_STORAGE_KEY) as { sessions: Record<string, unknown> }).sessions.future, { shape: "newer" });
});

test("a name the save rule refuses is skipped and the other sessions still import", async () => {
  const store = make_session_store(fake_storage().storage);
  const result = await store.import_json(file_of({ "-flag": session("https://a.test/"), "@slot": session("https://b.test/"), "  ": session("https://c.test/"), "  fine   name ": session("https://d.test/") }));
  assert.deepEqual(result, { added: ["fine name"], skipped: ["-flag", "@slot", "  "] });
  assert.deepEqual(await names_of(store), ["fine name"]);
});

test("an entry that is no session is skipped", async () => {
  const store = make_session_store(fake_storage().storage);
  const result = await store.import_json(file_of({ bad: { saved_at: 1, tabs: [{ url: 5 }] }, worse: "x", good: session("https://a.test/") }));
  assert.deepEqual(result, { added: ["good"], skipped: ["bad", "worse"] });
});

test("a file that is no sessions export is refused whole and stores nothing", async () => {
  const { storage, values } = fake_storage();
  const store = make_session_store(storage);
  for (const text of ["not json", "null", "[]", JSON.stringify({ version: 2, sessions: {} }), JSON.stringify({ version: 1 }), JSON.stringify({ version: 1, sessions: [] })]) {
    await assert.rejects(store.import_json(text), /not JSON|not a DesertFox sessions export/);
  }
  assert.equal(values.has(SESSIONS_STORAGE_KEY), false);
});

test("the answers say what was added and skipped, and refuse a file with nothing to add", async () => {
  const store = make_session_store(fake_storage().storage);
  const text = file_of({ ok: session("https://a.test/"), "-no": session("https://b.test/") });
  const first = await answer_sessions_transfer({ type: "import_sessions", text }, store);
  assert.equal(first.ok, true);
  assert.match((first as { message: string }).message, /Imported 1 session \("ok"\), skipped 1 entry \("-no"\)/);

  const none = await answer_sessions_transfer({ type: "import_sessions", text: file_of({}) }, store);
  assert.deepEqual([none.ok, (none as { message: string }).message.startsWith("Sessions not imported:")], [false, true]);
  const malformed = await answer_sessions_transfer({ type: "import_sessions", text: "{" }, store);
  assert.deepEqual(malformed, { ok: false, message: "Sessions not imported: The file is not JSON." });

  const exported = await answer_sessions_transfer({ type: "export_sessions" }, store);
  assert.equal("count" in exported && exported.count, 1);
});
