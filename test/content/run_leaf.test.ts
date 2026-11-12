import assert from "node:assert/strict";
import { test } from "node:test";
import { holds_keys_after, run_leaf } from "../../src/content/run_leaf.ts";
import type { Outcome, TreeLeaf } from "../../src/shared/index.ts";

const step = (id: string, runs_in: "content" | "background") => ({ invocation: { id }, runs_in, count_rule: "ignore" as const });
const leaf_of = (...steps: ReturnType<typeof step>[]): TreeLeaf => ({ kind: "leaf", steps });

function setup(outcome: Outcome = { ok: true }) {
  const sent: unknown[] = [];
  const toasts: string[] = [];
  const send = async (message: unknown) => (sent.push(message), { ok: true as const });
  const run_with = (leaf: TreeLeaf, count: number | undefined, repeat: boolean) =>
    run_leaf(leaf, count, repeat, send, () => "normal", async () => outcome, (message) => void toasts.push(message));
  return { sent, toasts, run_leaf: run_with };
}

test("a leaf of content steps sends its counted steps and outcome once", async () => {
  const { sent, run_leaf } = setup();
  await run_leaf(leaf_of(step("scroll.lines", "content")), 3, false);
  assert.deepEqual(sent, [{ type: "record_step", invocations: [{ id: "scroll.lines", count: 3 }], outcome: { ok: true } }]);
});

test("a held key's repeats send nothing", async () => {
  const { sent, run_leaf } = setup();
  await run_leaf(leaf_of(step("scroll.lines", "content")), undefined, true);
  assert.deepEqual(sent, []);
});

test("a failed leaf shows its toast and still reports the failure", async () => {
  const { sent, toasts, run_leaf } = setup({ ok: false, message: "no" });
  await run_leaf(leaf_of(step("page.follow", "content")), undefined, false);
  assert.deepEqual(toasts, ["no"]);
  assert.deepEqual(sent, [{ type: "record_step", invocations: [{ id: "page.follow" }], outcome: { ok: false, message: "no" } }]);
});

test("a leaf with a background step goes to the router whole and records nothing from the page", async () => {
  const { sent, run_leaf } = setup();
  await run_leaf(leaf_of(step("scroll.lines", "content"), step("tab.next", "background")), 2, false);
  assert.deepEqual(sent, [{ type: "run", invocations: [{ id: "scroll.lines", count: 2 }, { id: "tab.next", count: 2 }], mode: "normal" }]);
});

test("only a leaf made of captured-key steps holds the keys after it, and never in a field", () => {
  const captured = { ...step("mark.add", "background"), capture: "key" };
  const hint = step("hint.open", "content");
  assert.equal(holds_keys_after(leaf_of(captured), false), true);
  assert.equal(holds_keys_after(leaf_of(captured, { ...captured }), false), true);
  assert.equal(holds_keys_after(leaf_of(captured, hint), false), false);
  assert.equal(holds_keys_after(leaf_of(hint), false), false);
  assert.equal(holds_keys_after(leaf_of(captured), true), false);
});

test("a jump leaf goes to the router on a first press, and runs in the page on a held key's repeat", async () => {
  const jump = { ...step("scroll.to", "content"), jump: true as const };
  const first = setup();
  await first.run_leaf(leaf_of(jump), undefined, false);
  assert.deepEqual(first.sent, [{ type: "run", invocations: [{ id: "scroll.to" }], mode: "normal" }]);
  const repeat = setup();
  await repeat.run_leaf(leaf_of(jump), undefined, true);
  assert.deepEqual(repeat.sent, []);
});

test("a jump leaf holds the keys after it, so a key typed next runs after the jump", () => {
  const jump = { ...step("scroll.to", "content"), jump: true as const };
  assert.equal(holds_keys_after(leaf_of(jump), false), true);
  assert.equal(holds_keys_after(leaf_of(jump), true), false);
});

test("a leaf with a jump step holds the keys after it, even with a plain step beside it", () => {
  const jump = { ...step("scroll.to", "content"), jump: true as const };
  assert.equal(holds_keys_after(leaf_of(jump, step("copy.url", "content")), false), true);
  assert.equal(holds_keys_after(leaf_of(step("copy.url", "content"), jump), false), true);
  assert.equal(holds_keys_after(leaf_of(jump, step("copy.url", "content")), true), false);
});
