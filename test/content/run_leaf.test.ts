import assert from "node:assert/strict";
import { test } from "node:test";
import { create_run_leaf } from "../../src/content/run_leaf.ts";
import type { Outcome, TreeLeaf } from "../../src/shared/index.ts";

const step = (id: string, runs_in: "content" | "background") => ({ invocation: { id }, runs_in, count_rule: "ignore" as const });
const leaf_of = (...steps: ReturnType<typeof step>[]): TreeLeaf => ({ kind: "leaf", steps });

function setup(outcome: Outcome = { ok: true }) {
  const sent: unknown[] = [];
  const toasts: string[] = [];
  const run_leaf = create_run_leaf({
    send: async (message) => (sent.push(message), { ok: true }),
    get_mode: () => "normal",
    run_steps: async () => outcome,
    show_toast: (message) => void toasts.push(message),
  });
  return { sent, toasts, run_leaf };
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
