import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BROWSER_MODULE_PROTOCOL_VERSION as V,
  ABSENT_TAB,
  check_module_args,
  EXTENSION_TO_MODULE_KINDS,
  MAX_HELLO_BYTES,
  MAX_KEY_ROWS,
  MAX_MESSAGE_LIST_BYTES,
  MAX_MESSAGES,
  MODULE_TO_EXTENSION_KINDS,
  status_of_hello,
  tab_state_in,
  DEFAULT_MAX_AGE_MS,
  is_too_old,
  validate_message,
  validate_message_list,
  validate_module_hello,
  validate_module_state,
} from "../../src/shared/browser_module_protocol.ts";

const state = (patch: Record<string, unknown> = {}) => ({ v: V, enabled: true, keys: [{ key: "J", id: "tab.next", args: {} }], tabs: { "7": { mode: "normal", live: false } }, ...patch });

test("a well formed state validates and keeps the args it was given", () => {
  const checked = validate_module_state(state({ keys: [{ key: "j", id: "scroll.lines", args: { count: 10001 } }] }));
  assert.ok(checked.ok, "the command schema owns the limits, so the protocol takes any whole number");
  assert.deepEqual(checked.value.keys[0]!.args, { count: 10001 });
});

test("an absent tab is in normal mode and not live", () => {
  const checked = validate_module_state(state({ tabs: undefined }));
  assert.ok(checked.ok);
  assert.deepEqual(tab_state_in(checked.value, 42), ABSENT_TAB);
  assert.deepEqual(ABSENT_TAB, { mode: "normal", live: false });
});

test("junk, a wrong version and oversize state are refused", () => {
  for (const junk of [undefined, null, 1, "x", [], state({ v: V + 1 }), state({ v: "1" }), state({ enabled: "yes" }), state({ keys: "J" }), state({ tabs: [] })]) assert.equal(validate_module_state(junk).ok, false);
  const rows = Array.from({ length: MAX_KEY_ROWS + 1 }, (_, index) => ({ key: String.fromCharCode(97 + (index % 26)) + (index >= 26 ? "1" : ""), id: "tab.next", args: {} }));
  assert.equal(validate_module_state(state({ keys: rows })).ok, false);
});

test("a row naming an unlisted command, a bad key or a bad arg is refused", () => {
  for (const row of [{ key: "x", id: "page.eval", args: {} }, { key: "", id: "tab.next", args: {} }, { key: "a b", id: "tab.next", args: {} }, { key: "x".repeat(25), id: "tab.next", args: {} }, { key: "j", id: "scroll.lines", args: { count: 1.5 } }, { key: "j", id: "scroll.lines", args: {} }, { key: "j", id: "scroll.to", args: {} }, { key: "j", id: "scroll.to", args: { percent: 5, axis: "z" } }, { key: "j", id: "scroll.pixels", args: { dx: "5" } }, "J"]) {
    assert.equal(validate_module_state(state({ keys: [row] })).ok, false, JSON.stringify(row));
  }
  assert.equal(validate_module_state(state({ keys: [{ key: "J", id: "tab.next", args: {} }, { key: "J", id: "tab.prev", args: {} }] })).ok, false);
});

test("a tab with a bad id, mode or live mark is refused", () => {
  for (const tabs of [{ x: { mode: "normal", live: false } }, { "1": { mode: "nope", live: false } }, { "1": { mode: "normal", live: 1 } }, { "1": "normal" }]) assert.equal(validate_module_state(state({ tabs })).ok, false);
});

test("the protocol stays backward compatible: unknown fields are ignored and later optional fields may be absent", () => {
  const newer = validate_module_state({ v: V, enabled: false, later: { a: 1 }, keys: [{ key: "J", id: "tab.next", args: { later_arg: 1 }, later_field: true }] });
  assert.ok(newer.ok, "a state with no tabs and with unknown fields");
  assert.deepEqual(newer.value, { v: V, enabled: false, keys: [{ key: "J", id: "tab.next", args: {} }], tabs: {} });
  assert.ok(validate_module_state({ v: V, enabled: true, keys: [{ key: "j", id: "scroll.lines", args: { count: 1 } }] }).ok, "a state without tabs");
  const older_hello = validate_module_hello({ v: V, module_version: "0.1" });
  assert.ok(older_hello.ok);
  assert.ok(validate_module_hello({ v: V, module_version: "9.9", later: "field" }).ok);
});

test("check_module_args checks the shape of each arg and ignores others", () => {
  assert.deepEqual(check_module_args("scroll.pages", { fraction: 0.5, count: 1, later: true }), { ok: true, value: { fraction: 0.5, count: 1 } });
  assert.equal(check_module_args("scroll.to", { percent: 5 }).ok, false);
  assert.equal(check_module_args("scroll.to", undefined).ok, false);
  assert.equal(check_module_args("scroll.lines", { count: Number.NaN }).ok, false);
});

test("a hello is checked as foreign input", () => {
  for (const junk of [undefined, null, "hi", [], {}, { v: 1.5, module_version: "1" }, { v: "1", module_version: "1" }, { v: 1 }, { v: 1, module_version: "" }, { v: 1, module_version: 5 }, { v: 1, module_version: "x".repeat(33) }, { v: 1, module_version: "a\u0000b" }, { v: 1, module_version: "a\u202eb" }, { v: 1, module_version: "1", pad: "p".repeat(MAX_HELLO_BYTES) }]) {
    assert.equal(validate_module_hello(junk).ok, false, JSON.stringify(junk)?.slice(0, 40));
  }
  const cyclic: Record<string, unknown> = { v: 1, module_version: "1" };
  cyclic.self = cyclic;
  assert.equal(validate_module_hello(cyclic).ok, false);
});

test("the status says waiting, matched, mismatch or invalid", () => {
  assert.deepEqual(status_of_hello(undefined), { result: "waiting" });
  assert.deepEqual(status_of_hello({ v: V, module_version: "1.0" }), { result: "matched", module_version: "1.0", module_v: V });
  assert.equal(status_of_hello({ v: V + 1, module_version: "2.0" }).result, "mismatch");
  assert.equal(status_of_hello({ v: "x" }).result, "invalid");
});

const KINDS = { push: { args: { n: "int" as const }, reply: false }, ask: { args: { axis: "axis" as const }, reply: true } };
const msg = (patch: Record<string, unknown>) => ({ v: V, id: "m1", kind: "ask", args: { axis: "x" }, ...patch });

test("both directions start with empty allow lists, so every request is refused", () => {
  assert.deepEqual([MODULE_TO_EXTENSION_KINDS, EXTENSION_TO_MODULE_KINDS], [{}, {}]);
  assert.equal(validate_message(msg({}), MODULE_TO_EXTENSION_KINDS).ok, false);
  assert.equal(validate_message(msg({}), EXTENSION_TO_MODULE_KINDS).ok, false);
});

test("a request and a reply validate, with unknown fields ignored and no later field required", () => {
  assert.deepEqual(validate_message(msg({ later: 1, args: { axis: "y", later_arg: 2 } }), KINDS), { ok: true, value: { v: V, id: "m1", kind: "ask", args: { axis: "y" } } });
  assert.deepEqual(validate_message({ v: V, id: "p", kind: "push" }, KINDS).ok, false, "a push still needs the args its kind names");
  assert.ok(validate_message({ v: V, id: "p", kind: "push", args: { n: 3 } }, KINDS).ok);
  assert.deepEqual(validate_message({ v: V, reply_to: "m1", ok: true, newer: {} }, KINDS), { ok: true, value: { v: V, reply_to: "m1", ok: true } });
  assert.ok(validate_message({ v: V, reply_to: "m1", ok: false, error: "no" }, KINDS).ok);
});

test("a message with junk, a wrong version, a bad id, an unlisted kind or bad args is refused", () => {
  for (const junk of [null, 1, "x", [], msg({ v: V + 1 }), msg({ v: "1" }), msg({ id: "" }), msg({ id: "a b" }), msg({ id: "x".repeat(33) }), msg({ kind: "eval" }), msg({ kind: 5 }), msg({ args: { axis: "z" } }), msg({ args: [] }), { v: V, reply_to: 5, ok: true }, { v: V, reply_to: "a", ok: "yes" }, { v: V, reply_to: "a", ok: true, error: "e".repeat(200) }]) {
    assert.equal(validate_message(junk, KINDS).ok, false, JSON.stringify(junk));
  }
});

test("a list is capped in count and bytes, and a bad message never takes a good one down", () => {
  assert.equal(validate_message_list("x", KINDS).ok, false);
  assert.equal(validate_message_list(Array.from({ length: MAX_MESSAGES + 1 }, (_, index) => msg({ id: `m${index}` })), KINDS).ok, false);
  assert.equal(validate_message_list([msg({ args: { axis: "x", pad: "p".repeat(MAX_MESSAGE_LIST_BYTES) } })], KINDS).ok, false);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(validate_message_list([cyclic], KINDS).ok, false);
  const list = validate_message_list([msg({ id: "a" }), "junk", msg({ id: "b", kind: "nope" }), msg({ id: "c", args: { axis: "q" } }), { v: V, id: "d", kind: "push", args: {} }, { v: V + 1, id: "e", kind: "ask" }, msg({ id: "f" })], KINDS);
  assert.ok(list.ok);
  assert.deepEqual(list.value.messages.map((m) => ("id" in m ? m.id : "")), ["a", "f"]);
  // An unlisted kind and a failed request that expects a reply are answered. A failed push and a wrong version are dropped.
  assert.deepEqual(list.value.refused.map((r) => r.id), ["b", "c"]);
});

test("an older module's list, with the fields of its own version only, still parses", () => {
  assert.ok(validate_message_list([{ v: V, id: "old", kind: "ask", args: { axis: "x" } }, { v: V, reply_to: "x1", ok: true }], KINDS).ok);
});

test("sent_at is optional: a missing one is accepted, a junk one fails, and a stale one is dropped at read time", () => {
  const kinds = { ...KINDS, quick: { args: {}, reply: false, max_age_ms: 100 } };
  assert.deepEqual(validate_message(msg({}), kinds), { ok: true, value: { v: V, id: "m1", kind: "ask", args: { axis: "x" } } }, "an older writer sends no sent_at");
  assert.deepEqual(validate_message(msg({ sent_at: 5000 }), kinds), { ok: true, value: { v: V, id: "m1", kind: "ask", args: { axis: "x" }, sent_at: 5000 } });
  for (const junk of ["5000", 1.5, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 2, null]) assert.equal(validate_message(msg({ sent_at: junk }), kinds).ok, false, String(junk));

  const now = 10_000;
  const list = [msg({ id: "fresh", sent_at: now - DEFAULT_MAX_AGE_MS }), msg({ id: "stale", sent_at: now - DEFAULT_MAX_AGE_MS - 1 }), msg({ id: "old_writer" }), { v: V, id: "quick", kind: "quick", args: {}, sent_at: now - 101 }, { v: V, id: "stale_push", kind: "push", args: { n: 1 }, sent_at: 0 }];
  const read = validate_message_list(list, kinds, now);
  assert.ok(read.ok);
  assert.deepEqual(read.value.messages.map((message) => ("id" in message ? message.id : "")), ["fresh", "old_writer"]);
  assert.deepEqual(read.value.refused, [{ id: "stale", error: "the request is too old" }], "a stale request that expects a reply is refused, a stale push is dropped");
  const own = validate_message_list(list, kinds);
  assert.ok(own.ok && own.value.messages.length === 5, "the writer's own read keeps every request");
  assert.equal(is_too_old({ v: V, id: "c", kind: "ask", args: {}, sent_at: now + 60_000 }, kinds, now), false, "a clock that went back counts as fresh");
});
