import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BROWSER_MODULE_PROTOCOL_VERSION as V,
  check_module_args,
  MAX_HELLO_BYTES,
  MAX_KEY_ROWS,
  status_of_hello,
  validate_module_hello,
  validate_module_state,
} from "../../src/shared/browser_module_protocol.ts";

const state = (patch: Record<string, unknown> = {}) => ({ v: V, enabled: true, keys: [{ key: "J", id: "tab.next", args: {} }], tabs: { "7": { mode: "normal", live: false } }, ...patch });

test("a well formed state validates, and defaults fill the args", () => {
  const checked = validate_module_state(state({ keys: [{ key: "j", id: "scroll.lines", args: {} }] }));
  assert.ok(checked.ok);
  assert.deepEqual(checked.value.keys[0]!.args, { count: 1 });
});

test("junk, a wrong version and oversize state are refused", () => {
  for (const junk of [undefined, null, 1, "x", [], state({ v: V + 1 }), state({ v: "1" }), state({ enabled: "yes" }), state({ keys: "J" }), state({ tabs: [] })]) assert.equal(validate_module_state(junk).ok, false);
  const rows = Array.from({ length: MAX_KEY_ROWS + 1 }, (_, index) => ({ key: String.fromCharCode(97 + (index % 26)) + (index >= 26 ? "1" : ""), id: "tab.next", args: {} }));
  assert.equal(validate_module_state(state({ keys: rows })).ok, false);
});

test("a row naming an unlisted command, a bad key or a bad arg is refused", () => {
  for (const row of [{ key: "x", id: "page.eval", args: {} }, { key: "", id: "tab.next", args: {} }, { key: "a b", id: "tab.next", args: {} }, { key: "x".repeat(25), id: "tab.next", args: {} }, { key: "j", id: "scroll.lines", args: { count: 1.5 } }, { key: "j", id: "scroll.lines", args: { count: 1e9 } }, { key: "j", id: "scroll.to", args: {} }, { key: "j", id: "scroll.to", args: { percent: 5, axis: "z" } }, { key: "j", id: "scroll.pixels", args: { dx: "5" } }, "J"]) {
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
  const older_hello = validate_module_hello({ v: V, module_version: "0.1" });
  assert.ok(older_hello.ok);
  assert.ok(validate_module_hello({ v: V, module_version: "9.9", later: "field" }).ok);
});

test("check_module_args fills defaults and keeps required args required", () => {
  assert.deepEqual(check_module_args("scroll.pages", { fraction: 0.5 }), { ok: true, value: { fraction: 0.5, count: 1 } });
  assert.deepEqual(check_module_args("scroll.to", { percent: 100 }), { ok: true, value: { percent: 100, axis: "y" } });
  assert.equal(check_module_args("scroll.to", undefined).ok, false);
});

test("a hello is checked as foreign input", () => {
  for (const junk of [undefined, null, "hi", [], {}, { v: 1.5, module_version: "1" }, { v: "1", module_version: "1" }, { v: 1 }, { v: 1, module_version: "" }, { v: 1, module_version: 5 }, { v: 1, module_version: "x".repeat(33) }, { v: 1, module_version: "a\u0000b" }, { v: 1, module_version: "1", pad: "p".repeat(MAX_HELLO_BYTES) }]) {
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
