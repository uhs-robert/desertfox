import assert from "node:assert/strict";
import { test } from "node:test";
import { create_macro_recorder } from "../../src/background/macro_recorder.ts";
import { MACRO_RECORDING_PRIVATE_STORAGE_KEY, MACRO_RECORDING_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import type { BoundInvocation } from "../../src/shared/invocation.ts";

function make() {
  const values = new Map<string, unknown>();
  const session = {
    get: async (key: string) => (values.has(key) ? { [key]: structuredClone(values.get(key)) } : {}),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value))),
    remove: async (key: string) => void values.delete(key),
  } as never;
  const told = { count: 0 };
  const recorder = create_macro_recorder({ session: () => session, tell_tabs: async () => void told.count++ });
  return { recorder, values, told };
}

const step = (id: string, extra: Partial<BoundInvocation> = {}): BoundInvocation => ({ id, ...extra });
const NORMAL = { is_private: false };

test("nothing is stored while no macro records", async () => {
  const { recorder, values } = make();
  await recorder.record([step("tab.next")], { ok: true }, NORMAL);
  assert.equal(values.size, 0);
});

test("a recording keeps every step in order, with its args and count", async () => {
  const { recorder } = make();
  await recorder.start("a", false);
  await recorder.record([step("scroll.lines", { args: { count: 10 }, count: 3 })], { ok: true }, NORMAL);
  await recorder.record([step("tab.next"), step("tab.prev")], { ok: true }, NORMAL);
  const stopped = await recorder.stop(false);
  assert.deepEqual(stopped, { register: "a", steps: [{ id: "scroll.lines", args: { count: 10 }, count: 3 }, { id: "tab.next" }, { id: "tab.prev" }] });
});

test("a step that failed is kept, and the steps after it in the request are not", async () => {
  const { recorder } = make();
  await recorder.start("a", false);
  await recorder.record([step("tab.next"), step("page.back"), step("tab.prev")], { ok: false, message: "no", failed_step: 1 }, NORMAL);
  assert.deepEqual((await recorder.stop(false)).steps.map((kept) => kept.id), ["tab.next", "page.back"]);
});

test("a page leaf that failed has no index and keeps all its steps", async () => {
  const { recorder } = make();
  await recorder.start("a", false);
  await recorder.record([step("scroll.lines"), step("page.back")], { ok: false, message: "failed" }, NORMAL);
  assert.equal((await recorder.stop(false)).steps.length, 2);
});

test("the macro keys never enter the macro, and macro.play does", async () => {
  const { recorder } = make();
  await recorder.start("a", false);
  await recorder.record([step("macro.record", { args: { reg: "b" } })], { ok: true }, NORMAL);
  await recorder.record([step("macro.play", { args: { reg: "b" } })], { ok: true }, NORMAL);
  await recorder.record([step("macro.stop")], { ok: true }, NORMAL);
  assert.deepEqual((await recorder.stop(false)).steps, [{ id: "macro.play", args: { reg: "b" } }]);
});

test("a prompted request and an address a hint pick opened are not kept", async () => {
  const { recorder } = make();
  await recorder.start("a", false);
  await recorder.record([step("tab.switch")], { ok: true }, { is_private: false, prompted: true });
  await recorder.record([step("open.url", { args: { url: "https://x.test/" } })], { ok: true }, { is_private: false, skip_repeat: true });
  assert.deepEqual((await recorder.stop(false)).steps, []);
});

test("hint.run is kept from the pick message only, so a pick is one step", async () => {
  const { recorder } = make();
  await recorder.start("a", false);
  const pick = [step("hint.run", { args: { action: "tab" } })];
  await recorder.record(pick, { ok: true }, { is_private: false, from_pick: true });
  await recorder.record(pick, { ok: true }, NORMAL);
  await recorder.record([step("hint.run", { args: { action: "tab" } }), step("tab.next")], { ok: true }, NORMAL);
  assert.deepEqual((await recorder.stop(false)).steps.map((kept) => kept.id), ["hint.run", "tab.next"]);
});

test("a second start refuses and keeps the first recording", async () => {
  const { recorder } = make();
  await recorder.start("a", false);
  await assert.rejects(recorder.start("b", false), /Already recording into a/);
  assert.equal(await recorder.register_of(false), "a");
});

test("stop with no recording refuses", async () => {
  const { recorder } = make();
  await assert.rejects(recorder.stop(false), /Not recording/);
});

test("start and stop each tell the tabs, and stop clears the state", async () => {
  const { recorder, told, values } = make();
  await recorder.start("a", false);
  assert.equal(told.count, 1);
  assert.ok(values.has(MACRO_RECORDING_STORAGE_KEY));
  await recorder.stop(false);
  assert.equal(told.count, 2);
  assert.equal(values.size, 0);
  assert.equal(await recorder.register_of(false), undefined);
});

test("a private recording and a normal one are apart", async () => {
  const { recorder, values } = make();
  await recorder.start("p", true);
  await recorder.record([step("tab.next")], { ok: true }, NORMAL);
  assert.equal(await recorder.register_of(false), undefined);
  await recorder.record([step("tab.prev")], { ok: true }, { is_private: true });
  assert.deepEqual(values.get(MACRO_RECORDING_PRIVATE_STORAGE_KEY), { register: "p", steps: [{ id: "tab.prev" }] });
});

test("the last private window closing drops a private recording only", async () => {
  const { recorder } = make();
  await recorder.start("p", true);
  await recorder.start("n", false);
  await recorder.clear_private_without_window(async () => true);
  assert.equal(await recorder.register_of(true), "p");
  await recorder.clear_private_without_window(async () => false);
  assert.equal(await recorder.register_of(true), undefined);
  assert.equal(await recorder.register_of(false), "n");
});

test("steps that arrive together are all kept", async () => {
  const { recorder } = make();
  await recorder.start("a", false);
  await Promise.all(["a", "b", "c", "d"].map((id) => recorder.record([step(id)], { ok: true }, NORMAL)));
  assert.deepEqual((await recorder.stop(false)).steps.map((kept) => kept.id), ["a", "b", "c", "d"]);
});

test("a dot repeat keeps the steps it ran and not command.repeat, so replay does not double them", async () => {
  const { recorder } = make();
  await recorder.start("a", false);
  await recorder.record([step("tab.close")], { ok: true }, NORMAL);
  await recorder.record([step("tab.close")], { ok: true }, NORMAL);
  await recorder.record([step("command.repeat")], { ok: true }, NORMAL);
  assert.deepEqual((await recorder.stop(false)).steps.map((kept) => kept.id), ["tab.close", "tab.close"]);
});
