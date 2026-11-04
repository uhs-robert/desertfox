import assert from "node:assert/strict";
import { test } from "node:test";
import { content_handlers } from "../../src/content/handler_map.ts";
import { run_content_invocation, run_in_order } from "../../src/content/run_content.ts";
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
