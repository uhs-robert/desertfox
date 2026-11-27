import assert from "node:assert/strict";
import { test } from "node:test";
import { create_module_call, MODULE_ANSWER_MS, NEEDS_MODULE } from "../../src/background/browser_module_call.ts";
import type { ModuleCallDeps } from "../../src/background/browser_module_call.ts";
import { EXTENSION_TO_MODULE_KINDS, MAX_RESIZE_STEPS, validate_message } from "../../src/shared/browser_module_protocol.ts";
import type { ModuleStatus } from "../../src/shared/browser_module_protocol.ts";

const matched: ModuleStatus = { result: "matched", module_version: "1", module_v: 1 };
const needs = { ok: false, error: NEEDS_MODULE };

function make(status: ModuleStatus | undefined, send_ok = true, on_write?: (id: string) => Promise<void> | void) {
  const sent: { kind: string; args: unknown }[] = [];
  const withdrawn: string[] = [];
  const timers: { run: () => void; cancelled: boolean }[] = [];
  const deps: ModuleCallDeps = {
    send: async (kind, args, on_id) => {
      sent.push({ kind, args });
      if (!send_ok) return { ok: false, problem: "the browser module setting is off" };
      on_id?.(`x${sent.length}`);
      await on_write?.(`x${sent.length}`);
      return { ok: true, id: `x${sent.length}` };
    },
    withdraw: async (id) => void withdrawn.push(id),
    read_status: async () => status,
    later: (run, ms) => {
      assert.equal(ms, MODULE_ANSWER_MS);
      const timer = { run, cancelled: false };
      timers.push(timer);
      return () => void (timer.cancelled = true);
    },
  };
  return { calls: create_module_call(deps), sent, timers, withdrawn };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const ok = (id: string) => ({ v: 1, reply_to: id, ok: true });

test("a call resolves ok when the module answers ok, and cancels its timer", async () => {
  const { calls, sent, timers, withdrawn } = make(matched);
  const done = calls.call("pane.unsplit");
  await flush();
  calls.hear(ok("x1"));
  assert.deepEqual(await done, { ok: true });
  assert.deepEqual(sent, [{ kind: "pane.unsplit", args: {} }]);
  assert.deepEqual(withdrawn, [], "an answered request needs no withdrawal");
  assert.equal(timers[0]!.cancelled, true);
});

test("a call carries the module's refusal text", async () => {
  const { calls } = make(matched);
  const done = calls.call("pane.resize", { steps: 1 });
  await flush();
  calls.hear({ v: 1, reply_to: "x1", ok: false, error: "This tab is not in a split view" });
  assert.deepEqual(await done, { ok: false, error: "This tab is not in a split view" });
});

test("a module that stays silent times out as absent, and its request is withdrawn", async () => {
  const { calls, timers, withdrawn } = make(matched);
  const done = calls.call("pane.unsplit");
  await flush();
  timers[0]!.run();
  assert.deepEqual(await done, needs);
  assert.deepEqual(withdrawn, ["x1"]);
});

test("a status that drops out of matched ends the waiting call and cancels its timer", async () => {
  for (const status of [undefined, { result: "waiting" } as const, { result: "mismatch", module_version: "2", module_v: 2 } as const]) {
    const { calls, timers } = make(matched);
    const done = calls.call("pane.unsplit");
    await flush();
    calls.status_changed(status);
    assert.deepEqual(await done, needs);
    assert.equal(timers[0]!.cancelled, true);
  }
});

test("a status that stays matched leaves the call waiting", async () => {
  const { calls } = make(matched);
  const done = calls.call("pane.unsplit");
  await flush();
  calls.status_changed(matched);
  calls.hear(ok("x1"));
  assert.deepEqual(await done, { ok: true });
});

test("the setting turning off clears every pending call", async () => {
  const { calls, timers, withdrawn } = make(matched);
  const first = calls.call("pane.unsplit");
  const second = calls.call("pane.close_both");
  await flush();
  calls.clear();
  assert.deepEqual([await first, await second], [needs, needs]);
  assert.deepEqual(withdrawn.sort(), ["x1", "x2"]);
  assert.deepEqual(timers.map((timer) => timer.cancelled), [true, true]);
});

test("an absent module or a failed send refuses without waiting", async () => {
  for (const status of [undefined, { result: "waiting" } as const]) {
    const { calls, sent } = make(status);
    assert.deepEqual(await calls.call("pane.unsplit"), needs);
    assert.equal(sent.length, 0);
  }
  assert.deepEqual(await make(matched, false).calls.call("pane.unsplit"), needs);
});

test("a push kind is refused at once", async () => {
  EXTENSION_TO_MODULE_KINDS["test.push"] = { args: {}, reply: false };
  try {
    const { calls, sent, timers } = make(matched);
    const result = await calls.call("test.push");
    assert.equal(result.ok, false);
    assert.equal(sent.length + timers.length, 0);
  } finally {
    delete EXTENSION_TO_MODULE_KINDS["test.push"];
  }
});

test("a late reply after the timeout is ignored", async () => {
  const { calls, timers } = make(matched);
  const done = calls.call("pane.unsplit");
  await flush();
  timers[0]!.run();
  assert.deepEqual(await done, needs);
  calls.hear(ok("x1"));
});

test("a duplicate reply and a reply to no call are ignored", async () => {
  const { calls } = make(matched);
  const done = calls.call("pane.unsplit");
  await flush();
  calls.hear(ok("nobody"));
  calls.hear(ok("x1"));
  calls.hear({ v: 1, reply_to: "x1", ok: false, error: "late" });
  assert.deepEqual(await done, { ok: true });
});

test("two concurrent calls resolve each with its own reply, out of order", async () => {
  const { calls } = make(matched);
  const first = calls.call("pane.unsplit");
  await flush();
  const second = calls.call("pane.close_both");
  await flush();
  calls.hear({ v: 1, reply_to: "x2", ok: false, error: "no split" });
  calls.hear(ok("x1"));
  assert.deepEqual([await first, await second], [{ ok: true }, { ok: false, error: "no split" }]);
});

const request = (kind: string, args: unknown) => validate_message({ v: 1, id: "a1", kind, args }, EXTENSION_TO_MODULE_KINDS);

test("the pane kinds take their args and refuse junk and oversize args", () => {
  for (const kind of ["pane.split_new_tab", "pane.split_next_tab", "pane.unsplit", "pane.close_both"]) assert.ok(request(kind, {}).ok, kind);
  assert.ok(request("pane.resize", { steps: 3 }).ok);
  assert.ok(request("pane.resize", { steps: -MAX_RESIZE_STEPS }).ok);
  for (const steps of [0, 1.5, MAX_RESIZE_STEPS + 1, -21, 1e9, Number.NaN, Infinity, "3", null, undefined]) assert.equal(request("pane.resize", { steps }).ok, false, String(steps));
  for (const region of ["sidebar", "page", "split", "devtools"]) assert.ok(request("pane.focus_region", { region }).ok, region);
  for (const region of ["Sidebar", "", "x".repeat(5000), 1, null, undefined, "chrome://browser"]) assert.equal(request("pane.focus_region", { region }).ok, false, String(region));
  assert.equal(request("pane.eval", { code: "1" }).ok, false);
});

test("extra args on a pane kind are dropped", () => {
  const checked = request("pane.focus_region", { region: "page", code: "alert(1)" });
  assert.ok(checked.ok && !("code" in (checked.value as { args: object }).args));
});

test("a reply that lands before send resolves still settles the call", async () => {
  const holder: { calls?: ReturnType<typeof make>["calls"] } = {};
  const { calls } = make(matched, true, (id) => holder.calls!.hear(ok(id)));
  holder.calls = calls;
  assert.deepEqual(await calls.call("pane.unsplit"), { ok: true });
});
