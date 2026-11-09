import assert from "node:assert/strict";
import { test } from "node:test";
import { content_handlers } from "../../src/content/handler_map.ts";
import { counted_invocations, run_content_invocation, run_content_steps, run_in_order } from "../../src/content/run_content.ts";
import type { Outcome } from "../../src/shared/messages.ts";

// Test handlers join the real map under ids no command uses.
function install(id: string, run: (args: Record<string, unknown>) => unknown): void {
  content_handlers[id] = { run: run as never };
}

test("a handler that returns nothing is done, and a sync handler runs in the caller's turn", async () => {
  const calls: number[] = [];
  install("t.sync", () => void calls.push(1));
  const answer = run_content_invocation({ id: "t.sync" }, "ignore");
  assert.deepEqual(calls, [1]);
  assert.deepEqual(await answer, { ok: true });
});

test("a throw is failed with its message, and an unknown id is failed", async () => {
  install("t.throws", () => {
    throw new Error("No text field");
  });
  assert.deepEqual(await run_content_invocation({ id: "t.throws" }, "ignore"), { ok: false, message: "No text field" });
  assert.deepEqual(await run_content_invocation({ id: "t.nothing" }, "ignore"), { ok: false, message: "t.nothing cannot run in the page" });
});

test("a promise from the handler is awaited, and its failed or cancelled outcome is the answer", async () => {
  install("t.fails", async () => ({ ok: false, message: "No hints on this page" }));
  install("t.cancels", async () => ({ ok: true, cancelled: true }));
  install("t.rejects", () => Promise.reject(new Error("clipboard")));
  assert.deepEqual(await run_content_invocation({ id: "t.fails" }, "ignore"), { ok: false, message: "No hints on this page" });
  assert.deepEqual(await run_content_invocation({ id: "t.cancels" }, "ignore"), { ok: true, cancelled: true });
  assert.deepEqual(await run_content_invocation({ id: "t.rejects" }, "ignore"), { ok: false, message: "clipboard" });
});

test("a count runs the handler in turn and stops at the first step that is not done", async () => {
  const calls: number[] = [];
  const answers: Outcome[] = [{ ok: true }, { ok: false, message: "second failed" }, { ok: true }];
  install("t.counted", async () => answers[calls.push(1) - 1]);
  assert.deepEqual(await run_content_invocation({ id: "t.counted", count: 3 }, "repeat"), { ok: false, message: "second failed" });
  assert.equal(calls.length, 2);
});

test("a list of steps runs one after another and stops at failed or cancelled", async () => {
  const ran: string[] = [];
  let release!: () => void;
  install("t.waits", () => new Promise<void>((resolve) => (release = resolve)).then(() => void ran.push("waited")));
  install("t.after", () => void ran.push("after"));
  install("t.escape", () => ({ ok: true, cancelled: true }));
  install("t.fail", () => ({ ok: false, message: "failed step" }));

  const running = run_in_order([{ id: "t.waits" }, { id: "t.after" }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ran, []);
  release();
  assert.deepEqual(await running, { ok: true });
  assert.deepEqual(ran, ["waited", "after"]);

  ran.length = 0;
  assert.deepEqual(await run_in_order([{ id: "t.escape" }, { id: "t.after" }]), { ok: true, cancelled: true });
  assert.deepEqual(await run_in_order([{ id: "t.fail" }, { id: "t.after" }]), { ok: false, message: "failed step" });
  assert.deepEqual(ran, []);
});

const content_step = (id: string, count_rule: "ignore" | "repeat" = "ignore") => ({ invocation: { id }, runs_in: "content", count_rule }) as const;

test("a content leaf starts each step only after the one before it has finished", async () => {
  const events: string[] = [];
  let finish_first!: () => void;
  install("t.slow", () => new Promise<void>((resolve) => (finish_first = () => (events.push("slow done"), resolve()))));
  install("t.next", () => void events.push("next"));
  const running = run_content_steps([content_step("t.slow"), content_step("t.next")], undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, []);
  finish_first();
  assert.deepEqual(await running, { ok: true });
  assert.deepEqual(events, ["slow done", "next"]);
});

test("a content leaf waits for a pick, and stops at a cancelled or failed step", async () => {
  const ran: string[] = [];
  let pick!: (outcome: Outcome) => void;
  install("t.wait", () => new Promise<Outcome>((resolve) => (pick = resolve)));
  install("t.after", () => void ran.push("after"));
  install("t.failing", async () => ({ ok: false, message: "No hints on this page" }));
  const steps = [content_step("t.wait"), content_step("t.after")];
  const picked = run_content_steps(steps, undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ran, []);
  pick({ ok: true });
  assert.deepEqual(await picked, { ok: true });
  assert.deepEqual(ran, ["after"]);

  ran.length = 0;
  const escaped = run_content_steps(steps, undefined);
  pick({ ok: true, cancelled: true });
  assert.deepEqual(await escaped, { ok: true, cancelled: true });
  assert.deepEqual(await run_content_steps([content_step("t.failing"), content_step("t.after")], undefined), { ok: false, message: "No hints on this page" });
  assert.deepEqual(ran, []);
});

test("the first step of a content leaf runs in the caller's turn, and the typed count reaches every step", async () => {
  const counts: (number | undefined)[] = [];
  install("t.first", () => void counts.push(1));
  const running = run_content_steps([content_step("t.first")], 4);
  assert.deepEqual(counts, [1]);
  await running;
  assert.deepEqual(counted_invocations([content_step("a"), content_step("b")], 4), [{ id: "a", count: 4 }, { id: "b", count: 4 }]);
  assert.deepEqual(counted_invocations([content_step("a")], undefined), [{ id: "a" }]);
});

test("a repeat flag reaches the handler as given, and a run with none reaches it as false", async () => {
  const seen: unknown[] = [];
  content_handlers["t.repeat"] = { run: ((_args: unknown, repeat: unknown) => void seen.push(repeat)) as never };
  await run_content_steps([content_step("t.repeat")], undefined, true);
  await run_content_steps([content_step("t.repeat")], undefined);
  await run_content_invocation({ id: "t.repeat" }, "ignore");
  await run_in_order([{ id: "t.repeat" }]);
  assert.deepEqual(seen, [true, false, false, false]);
});
