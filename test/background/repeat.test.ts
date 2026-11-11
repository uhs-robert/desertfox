import assert from "node:assert/strict";
import { test } from "node:test";
import { create_router } from "../../src/background/router.ts";
import { create_repeat_memory, no_repeat_memory } from "../../src/background/repeat_memory.ts";
import { create_step_recorder, page_outcome, page_steps } from "../../src/background/record_step.ts";
import { make_repeat_handler, type RepeatDeps } from "../../src/commands/command.ts";
import type { BoundInvocation } from "../../src/shared/invocation.ts";
import { make_fake } from "./fakes.ts";

const echo = { label: "Echo", intent: "x", runs_in: "background", params: [{ name: "n", type: "int", default: 0 }], count: { param: "n" } } as const;

function repeat_setup(commands: Parameters<typeof make_fake>[0] = {}, overrides: Parameters<typeof make_fake>[1] = {}) {
  const seen: unknown[] = [];
  const fake = make_fake({
    "tab.echo": { ...echo, run: (_ctx, args) => void seen.push(args.n) },
    "tab.ghost": { ...echo, repeatable: false, run: () => void seen.push("ghost") },
    "tab.fail": { ...echo, run: () => { throw new Error("no"); } },
    ...commands,
  }, overrides);
  const router = create_router(fake.deps);
  const ctx = { tab_id: 7, window_id: 1, frame_id: 0, mode: "normal" as const };
  const repeat = make_repeat_handler(() => ({
    load: async () => fake.deps.repeat_memory.load(false),
    run_batch: (invocations) => router.run({ invocations, mode: "normal" }),
  }) satisfies RepeatDeps);
  return { fake, router, seen, repeat, ctx };
}

test("a finished request is stored without its prompt and label, and a replay runs it again", async () => {
  const { fake, router, seen, repeat, ctx } = repeat_setup();
  await router.run({ invocations: [{ id: "tab.echo", count: 4, label: "Echo" }], mode: "normal" });
  assert.deepEqual(fake.slots.normal, [{ id: "tab.echo", count: 4 }]);
  await repeat(ctx, {});
  assert.deepEqual(seen, [4, 4]);
});

test("a count on the repeat replaces the saved one and is kept for the next repeat", async () => {
  const { router, seen, repeat, ctx } = repeat_setup();
  await router.run({ invocations: [{ id: "tab.echo", count: 4 }], mode: "normal" });
  await repeat(ctx, { count: 9 });
  await repeat(ctx, {});
  assert.deepEqual(seen, [4, 9, 9]);
});

test("a multi-step request replays every step", async () => {
  const { router, seen, repeat, ctx } = repeat_setup();
  await router.run({ invocations: [{ id: "tab.echo", count: 1 }, { id: "tab.echo", count: 2 }], mode: "normal" });
  await repeat(ctx, {});
  assert.deepEqual(seen, [1, 2, 1, 2]);
});

test("a refusal mid-way stores nothing", async () => {
  const { fake, router } = repeat_setup();
  await router.run({ invocations: [{ id: "tab.echo" }], mode: "normal" });
  const before = fake.slots.normal;
  await router.run({ invocations: [{ id: "tab.echo", count: 8 }, { id: "tab.fail" }], mode: "normal" });
  assert.equal(fake.slots.normal, before);
});

test("a request that opens the command line stores nothing", async () => {
  const { fake, router } = repeat_setup({ "tab.ask": { ...echo, params: [{ name: "q", type: "string" }], count: "ignore", run: () => assert.fail() } });
  await router.run({ invocations: [{ id: "tab.ask", prompt: { param: "q" } }], mode: "normal", may_prompt: true });
  assert.equal(fake.slots.normal, undefined);
});

test("a command that is not repeatable is skipped and keeps the older memory", async () => {
  const { fake, router } = repeat_setup();
  await router.run({ invocations: [{ id: "tab.echo", count: 2 }], mode: "normal" });
  await router.run({ invocations: [{ id: "tab.ghost" }], mode: "normal" });
  assert.deepEqual(fake.slots.normal, [{ id: "tab.echo", count: 2 }]);
});

test("a content command the router ran is stored, and one that opted out is not", async () => {
  const { fake, router } = repeat_setup({ "page.look": { ...echo, runs_in: "content" }, "page.mute": { ...echo, runs_in: "content", repeatable: false } });
  await router.run({ invocations: [{ id: "page.mute" }], mode: "normal" });
  assert.equal(fake.slots.normal, undefined);
  await router.run({ invocations: [{ id: "page.look" }], mode: "normal" });
  assert.deepEqual(fake.slots.normal, [{ id: "page.look" }]);
});

test("a private tab has its own slot", async () => {
  const { fake, router } = repeat_setup({}, { active_tab: async () => ({ tab_id: 7, window_id: 1, url: undefined, incognito: true }) });
  await router.run({ invocations: [{ id: "tab.echo", count: 3 }], mode: "normal" });
  assert.equal(fake.slots.normal, undefined);
  assert.deepEqual(fake.slots.private, [{ id: "tab.echo", count: 3 }]);
});

test("a router with the no-op memory stores nothing, as a snippet's nested router does", async () => {
  const { fake } = repeat_setup();
  const router = create_router({ ...fake.deps, repeat_memory: no_repeat_memory });
  await router.run({ invocations: [{ id: "tab.echo" }], mode: "normal" });
  assert.equal(fake.slots.normal, undefined);
});

test("with nothing stored the repeat says so", async () => {
  const { repeat, ctx } = repeat_setup();
  await assert.rejects(repeat(ctx, {}), /Nothing to repeat/);
});

test("the session memory keeps the two slots apart", async () => {
  const store: Record<string, unknown> = {};
  const memory = create_repeat_memory({ get: async (key) => ({ [key as string]: store[key as string] }), set: async (items) => void Object.assign(store, items), remove: async (key) => void delete store[key as string] });
  const batch: BoundInvocation[] = [{ id: "tab.echo" }];
  await memory.save(batch, true);
  assert.equal(await memory.load(false), undefined);
  assert.deepEqual(await memory.load(true), batch);
});

test("a page may record only content commands whose args and count pass the validator", () => {
  const { fake } = repeat_setup({
    "hint.run": { label: "Hint", intent: "x", runs_in: "content", params: [{ name: "action", type: "enum", values: ["here", "tab"], default: "here" }] },
  });
  const get = (id: string) => fake.registry.get(id);
  const record = (...invocations: unknown[]) => page_steps({ type: "record_step", invocations }, get, {});
  assert.deepEqual(record({ id: "hint.run", args: { action: "tab" }, count: 3, bundle: "hints" }), [{ id: "hint.run", args: { action: "tab" }, count: 3 }]);
  assert.equal(record({ id: "hint.run", args: { action: "nope" } }), undefined);
  assert.equal(record({ id: "hint.run", args: [] }), undefined);
  assert.equal(record({ id: "hint.run", count: 0 }), undefined);
  assert.equal(record({ id: "hint.run", count: 1.5 }), undefined);
  assert.equal(record({ id: "tab.echo" }), undefined);
  assert.equal(record({ id: "hint.run" }, { id: "missing.one" }), undefined);
  assert.equal(record(), undefined);
  assert.equal(record(...Array.from({ length: 17 }, () => ({ id: "hint.run" }))), undefined);
  assert.equal(page_steps(undefined, get, {}), undefined);
});

test("the page outcome is a success only when it says so", () => {
  assert.deepEqual(page_outcome({ outcome: { ok: true } }), { ok: true });
  assert.deepEqual(page_outcome({ outcome: { ok: true, cancelled: true } }), { ok: true, cancelled: true });
  assert.equal(page_outcome({ outcome: { ok: false, message: "x" } }).ok, false);
  assert.equal(page_outcome({}).ok, false);
});

test("the slot is the one of the tab that was active before the steps ran", async () => {
  let incognito = false;
  const { fake, router } = repeat_setup(
    { "tab.flip": { ...echo, run: () => void (incognito = true) } },
    { active_tab: async () => ({ tab_id: 7, window_id: 1, url: undefined, incognito }) },
  );
  await router.run({ invocations: [{ id: "tab.flip" }], mode: "normal" });
  assert.deepEqual(fake.slots.normal, [{ id: "tab.flip" }]);
  assert.equal(fake.slots.private, undefined);
});

test("a request marked skip_repeat runs and keeps the older memory", async () => {
  const { fake, router, seen } = repeat_setup();
  await router.run({ invocations: [{ id: "tab.echo", count: 2 }], mode: "normal" });
  await router.run({ invocations: [{ id: "tab.echo", count: 5 }], mode: "normal", skip_repeat: true });
  assert.deepEqual(seen, [2, 5]);
  assert.deepEqual(fake.slots.normal, [{ id: "tab.echo", count: 2 }]);
});

const scroll = { label: "Scroll", intent: "x", runs_in: "content", params: [{ name: "n", type: "int", default: 1 }] } as const;

function recorder_setup() {
  const fake = make_fake({
    "tab.echo": { ...echo, run: () => undefined },
    "page.scroll": scroll,
    "page.mode": { ...scroll, repeatable: false },
  });
  return { fake, record_step: create_step_recorder(fake.deps) };
}

test("a content step is stored like a background one, and a command that opted out is not", async () => {
  const { fake, record_step } = recorder_setup();
  await record_step([{ id: "page.scroll", args: { n: 2 }, count: 3 }], { ok: true }, { is_private: false });
  assert.deepEqual(fake.slots.normal, [{ id: "page.scroll", args: { n: 2 }, count: 3 }]);
  await record_step([{ id: "page.mode" }], { ok: true }, { is_private: false });
  assert.deepEqual(fake.slots.normal, [{ id: "page.scroll", args: { n: 2 }, count: 3 }]);
});

test("a failed, cancelled, prompted or skipped step leaves the slot as it was", async () => {
  const { fake, record_step } = recorder_setup();
  await record_step([{ id: "page.scroll", args: { n: 1 } }], { ok: true }, { is_private: false });
  const kept = [{ id: "page.scroll", args: { n: 1 } }];
  const other = [{ id: "tab.echo", count: 9 }];
  await record_step(other, { ok: false, message: "no" }, { is_private: false });
  await record_step(other, { ok: true, cancelled: true }, { is_private: false });
  await record_step(other, { ok: true }, { is_private: false, prompted: true });
  await record_step(other, { ok: true }, { is_private: false, skip_repeat: true });
  assert.deepEqual(fake.slots.normal, kept);
});

test("a refused or cancelled request does not overwrite the slot", async () => {
  const { fake, router } = repeat_setup({ "page.pick": { ...echo, runs_in: "content" } }, { send_to_tab: async () => ({ ok: true, cancelled: true }) });
  await router.run({ invocations: [{ id: "tab.echo", count: 2 }], mode: "normal" });
  await router.run({ invocations: [{ id: "tab.fail" }], mode: "normal" });
  await router.run({ invocations: [{ id: "page.pick" }], mode: "normal" });
  await router.run({ invocations: [{ id: "missing.one" }], mode: "normal" });
  assert.deepEqual(fake.slots.normal, [{ id: "tab.echo", count: 2 }]);
});

test("a replay of the slot goes through the recorder and keeps the slot, and the repeat itself is never stored", async () => {
  const { fake, router, repeat, ctx } = repeat_setup();
  await router.run({ invocations: [{ id: "tab.echo", count: 4 }], mode: "normal" });
  await repeat(ctx, { count: 2 });
  assert.deepEqual(fake.slots.normal, [{ id: "tab.echo", count: 2 }]);
});

test("the router stores the request before it answers, so a repeat typed next finds it", async () => {
  const order: string[] = [];
  const { fake } = repeat_setup();
  const router = create_router({ ...fake.deps, repeat_memory: { load: fake.deps.repeat_memory.load, save: async (steps, is_private) => { order.push("save"); await fake.deps.repeat_memory.save(steps, is_private); } } });
  await router.run({ invocations: [{ id: "tab.echo" }], mode: "normal" });
  order.push("answered");
  assert.deepEqual(order, ["save", "answered"]);
});

function memory_setup(has_private_window: () => Promise<boolean> = async () => true) {
  const store: Record<string, unknown> = {};
  const memory = create_repeat_memory(
    { get: async (key) => ({ [key as string]: store[key as string] }), set: async (items) => void Object.assign(store, items), remove: async (key) => void delete store[key as string] },
    has_private_window,
  );
  return { store, memory };
}

const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("page records land in arrival order, so the last key press wins even when the first is slower", async () => {
  const { memory } = memory_setup();
  const first = memory.in_turn(async (slot) => {
    await later(15);
    await slot.save([{ id: "page.scroll", args: { n: 1 } }], false);
  });
  const second = memory.in_turn((slot) => slot.save([{ id: "page.scroll", args: { n: 2 } }], false));
  await Promise.all([first, second]);
  assert.deepEqual(await memory.load(false), [{ id: "page.scroll", args: { n: 2 } }]);
});

test("a load waits for a page record that is still on its way to the slot", async () => {
  const { memory } = memory_setup();
  void memory.in_turn(async (slot) => {
    await later(10);
    await slot.save([{ id: "page.scroll" }], false);
  });
  assert.deepEqual(await memory.load(false), [{ id: "page.scroll" }]);
});

test("a router save waits behind a page record in flight, so the later request wins", async () => {
  const { memory } = memory_setup();
  void memory.in_turn(async (slot) => {
    await later(10);
    await slot.save([{ id: "page.scroll" }], false);
  });
  await memory.save([{ id: "tab.echo" }], false);
  assert.deepEqual(await memory.load(false), [{ id: "tab.echo" }]);
});

test("closing the last private window clears the private slot and keeps the normal one", async () => {
  let private_open = true;
  const { memory } = memory_setup(async () => private_open);
  await memory.save([{ id: "tab.echo" }], false);
  await memory.save([{ id: "tab.echo", count: 2 }], true);
  await memory.clear_private_without_window();
  assert.deepEqual(await memory.load(true), [{ id: "tab.echo", count: 2 }]);
  private_open = false;
  await memory.clear_private_without_window();
  assert.equal(await memory.load(true), undefined);
  assert.deepEqual(await memory.load(false), [{ id: "tab.echo" }]);
});

test("a private write that is still in flight when the last window closes does not survive the clear", async () => {
  let private_open = true;
  const { memory } = memory_setup(async () => private_open);
  const write = memory.in_turn(async (slot) => {
    await later(10);
    await slot.save([{ id: "tab.echo" }], true);
  });
  private_open = false;
  await memory.clear_private_without_window();
  await write;
  assert.equal(await memory.load(true), undefined);
});

test("a private save that finishes after its window closed is dropped, as when the command closed that window", async () => {
  let private_open = true;
  const { fake } = repeat_setup(
    { "window.shut": { ...echo, run: () => void (private_open = false) } },
    { active_tab: async () => ({ tab_id: 7, window_id: 1, url: undefined, incognito: true }) },
  );
  const { memory } = memory_setup(async () => private_open);
  const closing = create_router({ ...fake.deps, repeat_memory: memory });
  await closing.run({ invocations: [{ id: "window.shut" }], mode: "normal" });
  assert.equal(await memory.load(true), undefined);
});

test("a window that opened before the clear check keeps its slot", async () => {
  const { memory } = memory_setup(async () => true);
  await memory.save([{ id: "tab.echo" }], true);
  await memory.clear_private_without_window();
  assert.deepEqual(await memory.load(true), [{ id: "tab.echo" }]);
});

test("the recorder gets the index of the step that failed or was cancelled", async () => {
  const seen: unknown[] = [];
  const { fake } = repeat_setup();
  const with_spy = create_router({ ...fake.deps, record_step: async (_steps, outcome) => void seen.push(outcome) });
  await with_spy.run({ invocations: [{ id: "tab.echo" }, { id: "tab.fail" }], mode: "normal" });
  await with_spy.run({ invocations: [{ id: "tab.echo" }], mode: "normal" });
  assert.deepEqual(seen, [{ ok: false, message: "no", failed_step: 1 }, { ok: true }]);
});

// The recorder sends the entry and the text as one request. The real definitions decide what the page may record.
test("typed text is recorded in the slot of the window it came from, and `.` replays the entry then the text with the count", async () => {
  await import("../../src/background/command_modules.ts");
  const { registry } = await import("../../src/shared/registry/builtin.ts");
  const fake = make_fake({
    "page.focus_input": { label: "Focus input", intent: "x", runs_in: "content", bundle: "page" },
    "text.insert": { label: "Insert text", intent: "x", runs_in: "content", bundle: "text", count: "repeat", params: [{ name: "text", type: "string", main: true }] },
  });
  const steps = page_steps({ type: "record_step", invocations: [{ id: "page.focus_input" }, { id: "text.insert", args: { text: "hi" } }] }, (id) => registry.get(id), {});
  assert.deepEqual(steps, [{ id: "page.focus_input", args: {} }, { id: "text.insert", args: { text: "hi" } }]);
  const slots: Record<string, BoundInvocation[]> = {};
  const memory = { save: async (invocations: BoundInvocation[], is_private: boolean) => void (slots[is_private ? "private" : "normal"] = invocations), load: async (is_private: boolean) => slots[is_private ? "private" : "normal"] };
  await create_step_recorder({ get_command: (id) => registry.get(id), repeat_memory: memory })(steps!, { ok: true }, { is_private: true });
  assert.equal(slots.normal, undefined);
  const router = create_router({ ...fake.deps, repeat_memory: memory });
  const repeat = make_repeat_handler(() => ({ load: async () => memory.load(true), run_batch: (invocations) => router.run({ invocations, mode: "normal" }) }) satisfies RepeatDeps);
  await repeat({ tab_id: 7, window_id: 1, frame_id: 0, mode: "normal" }, { count: 2 });
  const sent = fake.log.filter((line) => line.startsWith("send")).map((line) => JSON.parse(line.slice("send 7 ".length)).invocations);
  assert.deepEqual(sent.map((batch: { id: string }[]) => batch.map((invocation) => invocation.id)), [["page.focus_input"], ["text.insert", "text.insert"]]);
});

test("a text step with a missing or non-string text is refused", async () => {
  await import("../../src/background/command_modules.ts");
  const { registry } = await import("../../src/shared/registry/builtin.ts");
  const get = (id: string) => registry.get(id);
  assert.equal(page_steps({ invocations: [{ id: "text.insert", args: { text: 5 } }] }, get, {}), undefined);
  assert.equal(page_steps({ invocations: [{ id: "text.insert" }] }, get, {}), undefined);
});

test("a count on `.` after typed text goes to the text step only, never to the entry that focused the field", async () => {
  const seen: unknown[] = [];
  const handler = make_repeat_handler(() => ({
    load: async () => [{ id: "page.focus_field", args: { direction: "next", steps: 1 } }, { id: "text.insert", args: { text: "hi" } }],
    run_batch: async (invocations) => void seen.push(invocations),
  }) satisfies RepeatDeps);
  await handler({ tab_id: 7, window_id: 1, frame_id: 0, mode: "normal" }, { count: 3 });
  assert.deepEqual(seen, [[{ id: "page.focus_field", args: { direction: "next", steps: 1 } }, { id: "text.insert", args: { text: "hi" }, count: 3 }]]);
});

test("a repeat with a count over the limit is refused and runs nothing, like any other caller", async () => {
  const { fake, router, seen, repeat, ctx } = repeat_setup({
    "tab.shut": { label: "Shut", intent: "x", runs_in: "background", count: "repeat", repeat_limit: 20, run: () => void seen.push("shut") },
  });
  await router.run({ invocations: [{ id: "tab.shut", count: 3 }], mode: "normal" });
  assert.equal(seen.length, 3);
  await repeat(ctx, { count: 100 });
  assert.equal(seen.length, 3);
  assert.deepEqual(fake.log, ["refuse 7 A count of 100 is over the limit of 20 for tab.shut"]);
});
