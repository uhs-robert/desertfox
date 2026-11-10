import assert from "node:assert/strict";
import { test } from "node:test";
import { create_macro_recorder } from "../../src/background/macro_recorder.ts";
import { create_register_store } from "../../src/background/register_store.ts";
import { make_macro_handlers } from "../../src/commands/macro.ts";
import { create_macro_replay } from "../../src/background/macro_replay.ts";
import type { MacroReplay } from "../../src/background/macro_replay.ts";
import type { RunResponse } from "../../src/shared/messages.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const CTX: CommandContext = { tab_id: 1, window_id: 1, frame_id: 0, mode: "normal" };

function make(replay?: MacroReplay) {
  const values = new Map<string, unknown>();
  const area = {
    get: async (keys?: string | string[] | null) => Object.fromEntries([keys ?? []].flat().filter((key) => values.has(key as string)).map((key) => [key, structuredClone(values.get(key as string))])),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value))),
    remove: async (key: string) => void values.delete(key),
  } as never;
  const store = create_register_store({ local: () => area, session: () => area, clipboard: { read: async () => "", write: async () => undefined } });
  const recorder = create_macro_recorder({ session: () => area, tell_tabs: async () => undefined });
  const toasts: string[] = [];
  const handlers = make_macro_handlers({ recorder, store, is_private: async () => false, toast: async (_ctx, _kind, message) => void toasts.push(message), replay: () => replay });
  const press = (id: string) => recorder.record([{ id }], { ok: true }, { is_private: false });
  return { handlers, store, recorder, toasts, press };
}

test("a recording stores its steps in the register on stop", async () => {
  const { handlers, store, press, toasts } = make();
  await handlers.record(CTX, { reg: "a" });
  await press("tab.next");
  await press("tab.prev");
  await handlers.stop(CTX);
  assert.deepEqual(await store.read("a", false), [{ id: "tab.next" }, { id: "tab.prev" }]);
  assert.deepEqual(toasts, ["Recorded 2 steps into a"]);
});

test("an uppercase register adds to the macro, and a lowercase one replaces it", async () => {
  const { handlers, store, press } = make();
  await store.write("a", [{ id: "tab.next" }], false);
  await handlers.record(CTX, { reg: "A" });
  await press("tab.prev");
  await handlers.stop(CTX);
  assert.deepEqual(await store.read("a", false), [{ id: "tab.next" }, { id: "tab.prev" }]);
  await handlers.record(CTX, { reg: "a" });
  await press("page.back");
  await handlers.stop(CTX);
  assert.deepEqual(await store.read("a", false), [{ id: "page.back" }]);
});

test("an empty recording clears the register, as q a q does in vim", async () => {
  const { handlers, store } = make();
  await store.write("a", [{ id: "tab.next" }], false);
  await handlers.record(CTX, { reg: "a" });
  await handlers.stop(CTX);
  assert.deepEqual(await store.read("a", false), []);
});

test("appending to a text register refuses before the recording starts", async () => {
  const { handlers, store, recorder } = make();
  await store.write("a", "text", false);
  await assert.rejects(handlers.record(CTX, { reg: "A" }), /holds text/);
  assert.equal(await recorder.register_of(false), undefined);
});

test("record while recording and stop while idle refuse", async () => {
  const { handlers } = make();
  await assert.rejects(handlers.stop(CTX), /Not recording/);
  await handlers.record(CTX, { reg: "a" });
  await assert.rejects(handlers.record(CTX, { reg: "b" }), /Already recording/);
});

test("the register key takes a letter and refuses the special registers", () => {
  const command = registry.get("macro.record")!;
  for (const reg of ["a", "Z"]) assert.ok(check_args(command, { reg }, {}).ok, reg);
  for (const reg of ['"', "+", "_", "/", "@", "1"]) assert.ok(!check_args(command, { reg }, {}).ok, reg);
});

test("the macro commands stay out of the dot slot", () => {
  assert.equal(registry.get("macro.record")!.repeatable, false);
  assert.equal(registry.get("macro.stop")!.repeatable, false);
  assert.equal(registry.get("macro.play")!.repeatable, false);
});

function make_replay(steps: Record<string, (() => Promise<RunResponse>) | undefined>) {
  const played: string[] = [];
  const replay = create_macro_replay({
    read_macro: async (register) => (register === "a" ? Object.keys(steps).map((id) => ({ id })) : undefined),
    run_step: async (step) => (played.push(step.id), (await steps[step.id]?.()) ?? { ok: true }),
    active_tab_id: async () => 1,
    is_loading: async () => false,
    watch: () => ({ navigated: () => false, done: async () => "ready", stop: () => undefined }),
    hold_keys: async () => undefined,
    show_refusal: async () => undefined,
  });
  return { replay, played };
}

test("@A plays macro a, and a replay that stops ends quietly as cancelled, since the failed step showed its own refusal", async () => {
  const { replay, played } = make_replay({ "tab.next": undefined });
  assert.equal(await make(replay).handlers.play(CTX, { reg: "A" }), undefined);
  assert.deepEqual(played, ["tab.next"]);
  const failing = make_replay({ "tab.next": async () => ({ ok: false, refusal: { id: "tab.next", message: "no" } }) });
  assert.deepEqual(await make(failing.replay).handlers.play(CTX, { reg: "a" }), { ok: true, cancelled: true });
  await assert.rejects(make(replay).handlers.play(CTX, { reg: "b" }), /Register b holds no macro/);
});

test("recording refuses while a macro plays", async () => {
  let finish!: (response: RunResponse) => void;
  const { replay } = make_replay({ slow: () => new Promise((resolve) => (finish = resolve)) });
  const { handlers, recorder } = make(replay);
  const played = handlers.play(CTX, { reg: "a" });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(handlers.record(CTX, { reg: "b" }), /A macro is playing/);
  assert.equal(await recorder.register_of(false), undefined);
  finish({ ok: true });
  await played;
});
