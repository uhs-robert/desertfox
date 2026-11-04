import assert from "node:assert/strict";
import { test } from "node:test";
import { create_router } from "../../src/background/router.ts";
import { create_repeat_memory, no_repeat_memory, page_record } from "../../src/background/repeat_memory.ts";
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

test("content commands are not stored by the router", async () => {
  const { fake, router } = repeat_setup({ "page.look": { ...echo, runs_in: "content", run: () => undefined } });
  await router.run({ invocations: [{ id: "page.look" }], mode: "normal" });
  assert.equal(fake.slots.normal, undefined);
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
  const memory = create_repeat_memory({ get: async (key) => ({ [key as string]: store[key as string] }), set: async (items) => void Object.assign(store, items) });
  const batch: BoundInvocation[] = [{ id: "tab.echo" }];
  await memory.save(batch, true);
  assert.equal(await memory.load(false), undefined);
  assert.deepEqual(await memory.load(true), batch);
});

test("a page may record only a content command whose args pass the validator", () => {
  const { fake } = repeat_setup({
    "hint.run": { label: "Hint", intent: "x", runs_in: "content", params: [{ name: "action", type: "enum", values: ["here", "tab"], default: "here" }], run: () => undefined },
  });
  const get = (id: string) => fake.registry.get(id);
  const record = (invocation: unknown) => page_record({ type: "record_repeat", invocation }, get, {});
  assert.deepEqual(record({ id: "hint.run", args: { action: "tab" } }), { id: "hint.run", args: { action: "tab" } });
  assert.equal(record({ id: "hint.run", args: { action: "nope" } }), undefined);
  assert.equal(record({ id: "hint.run", args: [] }), undefined);
  assert.equal(record({ id: "tab.echo" }), undefined);
  assert.equal(record({ id: "missing.one" }), undefined);
  assert.equal(record(undefined), undefined);
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

test("a page may record only hint.run, not another content command", () => {
  const { fake } = repeat_setup({ "page.look": { ...echo, runs_in: "content", run: () => undefined } });
  assert.equal(page_record({ invocation: { id: "page.look" } }, (id) => fake.registry.get(id), {}), undefined);
});
