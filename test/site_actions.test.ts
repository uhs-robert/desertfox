import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { RuntimeRefusal } from "../src/shared/command.ts";
import "../src/background/command_modules.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { args_for_count } from "../src/content/invocation_args.ts";
import { SEND_KEY_MAX_TIMES } from "../src/shared/send_key_limit.ts";
import { check_args } from "../src/shared/registry/check_args.ts";
import { KEY_PAIR_GAP_MS, send_key, send_key_queued } from "../src/content/site_actions/send_key.ts";

type Sent = { type: string; init: KeyboardEventInit };

function fake_page(selectors: Record<string, string>, focused: string | null) {
  const log: { element: string; event: Sent }[] = [];
  const element = (name: string) => ({ dispatchEvent: (event: Event) => (log.push({ element: name, event: event as unknown as Sent }), true) }) as unknown as EventTarget;
  const doc = { querySelector: (selector: string) => (selector === "#bad[" ? (() => { throw new SyntaxError("bad selector"); })() : selector in selectors ? element(selectors[selector]!) : null), activeElement: focused === null ? null : element(focused) };
  const make_event = (type: string, init: KeyboardEventInit) => ({ type, init }) as unknown as Event;
  return { doc, log, make_event };
}

test("send_key sends a keydown then a keyup with the key and key code to the selected element", () => {
  const { doc, log, make_event } = fake_page({ "#editor": "editor" }, "other");
  send_key(doc, { key: "ArrowDown", key_code: 40, target: "#editor" }, make_event);
  assert.deepEqual(
    log.map((entry) => [entry.element, entry.event.type, entry.event.init.key, entry.event.init.keyCode, entry.event.init.bubbles, entry.event.init.cancelable]),
    [["editor", "keydown", "ArrowDown", 40, true, true], ["editor", "keyup", "ArrowDown", 40, true, true]],
  );
});

test("send_key without a target uses the focused element", () => {
  const { doc, log, make_event } = fake_page({}, "focused");
  send_key(doc, { key: "ArrowLeft", key_code: 37 }, make_event);
  assert.deepEqual(log.map((entry) => entry.element), ["focused", "focused"]);
});

test("send_key refuses a selector that matches nothing and a missing focus", () => {
  const page = fake_page({}, null);
  assert.throws(() => send_key(page.doc, { key: "a", key_code: 65, target: "#gone" }, page.make_event), RuntimeRefusal);
  assert.throws(() => send_key(page.doc, { key: "a", key_code: 65 }, page.make_event), RuntimeRefusal);
  assert.equal(page.log.length, 0);
});

test("send_key refuses a selector the page cannot parse", () => {
  const page = fake_page({}, "focused");
  assert.throws(() => send_key(page.doc, { key: "a", key_code: 65, target: "#bad[" }, page.make_event), RuntimeRefusal);
});

test("send_key takes the focused element for the args the validator fills in when target is omitted", () => {
  const checked = check_args(registry.get("page.send_key")!, { key: "ArrowLeft", key_code: 37 }, {});
  assert.ok(checked.ok);
  const page = fake_page({}, "focused");
  send_key(page.doc, checked.args as never, page.make_event);
  assert.deepEqual(page.log.map((entry) => entry.element), ["focused", "focused"]);
});

test("queued sends keep the gap between pairs and the order of calls, a count and two quick calls alike", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const page = fake_page({ "#e": "editor" }, null);
    const sent_at: { key: string | undefined; time: number }[] = [];
    const make_event = (type: string, init: KeyboardEventInit) => (type === "keydown" && sent_at.push({ key: init.key, time: Date.now() }), page.make_event(type, init));
    const call = (key: string) => send_key_queued(page.doc, { key, key_code: 1, target: "#e" }, make_event);
    // One call with times 3 and a second call that follows at once.
    const done = Promise.all([send_key_queued(page.doc, { key: "a", key_code: 1, target: "#e", times: 3 }, make_event), call("b")]);
    for (let step = 0; step < 20; step++) {
      mock.timers.tick(KEY_PAIR_GAP_MS / 2);
      await new Promise((resolve) => setImmediate(resolve));
    }
    await done;
    assert.deepEqual(sent_at.map((sent) => sent.key), ["a", "a", "a", "b"]);
    for (let index = 1; index < sent_at.length; index++) assert.ok(sent_at[index]!.time - sent_at[index - 1]!.time >= KEY_PAIR_GAP_MS, `pair ${index} came too soon`);
    assert.equal(page.log.length, 8);
  } finally {
    mock.timers.reset();
  }
});

test("a refused queued call rejects alone and the next call still sends", async () => {
  const page = fake_page({}, "focused");
  await assert.rejects(send_key_queued(page.doc, { key: "a", key_code: 1, target: "#gone" }, page.make_event), RuntimeRefusal);
  await send_key_queued(page.doc, { key: "a", key_code: 1 }, page.make_event);
  assert.equal(page.log.length, 2);
});

test("a backward clock jump does not stall the queue", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10_000_000 });
  try {
    const page = fake_page({ "#e": "editor" }, null);
    const call = () => send_key_queued(page.doc, { key: "a", key_code: 1, target: "#e" }, page.make_event);
    // The queue state is shared with earlier tests, so every call may wait one gap.
    const finish = async (pending: Promise<void>) => {
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(KEY_PAIR_GAP_MS);
      await pending;
    };
    await finish(call());
    mock.timers.setTime(0);
    await finish(call());
    assert.equal(page.log.length, 4);
  } finally {
    mock.timers.reset();
  }
});

test("times accepts 99 and refuses 100 with a clear error", () => {
  const command = registry.get("page.send_key")!;
  assert.ok(check_args(command, { key: "a", key_code: 65, times: 99 }, {}).ok);
  const refused = check_args(command, { key: "a", key_code: 65, times: 100 }, {});
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? "" : refused.error, /times/);
});

test("a count over the limit is refused by the handler after args_for_count fills times", async () => {
  const checked = check_args(registry.get("page.send_key")!, { key: "a", key_code: 65 }, {});
  assert.ok(checked.ok);
  const page = fake_page({}, "focused");
  const [args] = args_for_count(checked.args as never, 9999, { param: "times" });
  await assert.rejects(send_key_queued(page.doc, args as never, page.make_event), /over the limit of 99 for page.send_key/);
  assert.equal(page.log.length, 0);
  assert.equal(SEND_KEY_MAX_TIMES, 99);
});
