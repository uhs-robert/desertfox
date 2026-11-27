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

const COLORS = { bg_core: "#101010", mode_normal: "#89b4fa", mode_insert: "#a6e3a1", mode_ignore: "#f38ba8", mode_caret: "#cba6f7", mode_visual: "#f9e2af", mode_item: "#94e2d5", mode_media: "#fab387" };

test("a tab keeps the bar fields it has and drops one of the wrong shape without failing the state", () => {
  const good = { mode: "normal", live: true, pending: ["g", "<Space>"], count: 3, pass: true, site: "GMAIL", recording: "a" };
  const kept = validate_module_state(state({ tabs: { "7": good } }));
  assert.ok(kept.ok);
  assert.deepEqual(kept.value.tabs["7"], good);
  const junk = validate_module_state(state({ tabs: { "7": { mode: "normal", live: true, pending: ["a b"], count: 1.5, pass: "yes", site: "s".repeat(25), recording: "ab", extra: 1 } } }));
  assert.ok(junk.ok, "a bad bar field never takes the keys down");
  assert.deepEqual(junk.value.tabs["7"], { mode: "normal", live: true });
  for (const pending of [Array.from({ length: 33 }, () => "g"), ["x".repeat(17)], "g", []]) {
    const checked = validate_module_state(state({ tabs: { "7": { mode: "normal", live: true, pending } } }));
    assert.ok(checked.ok);
    assert.deepEqual(Object.keys(checked.value.tabs["7"]!), ["mode", "live"]);
  }
  assert.deepEqual(tab_state_in(kept.value, 7).pending, ["g", "<Space>"]);
});

test("a state from an older extension, with no bar fields and no theme, still validates", () => {
  const checked = validate_module_state(state());
  assert.ok(checked.ok);
  assert.equal(checked.value.bar_theme, undefined);
  assert.deepEqual(checked.value.tabs["7"], { mode: "normal", live: false });
});

test("the bar theme needs both schemes with every role as a color, else it is left out", () => {
  const ok = validate_module_state(state({ bar_theme: { dark: { ...COLORS, extra: "#fff" }, light: COLORS } }));
  assert.ok(ok.ok);
  assert.deepEqual(ok.value.bar_theme, { dark: COLORS, light: COLORS });
  for (const bar_theme of [{ dark: COLORS }, { dark: COLORS, light: { ...COLORS, mode_item: "red; x" } }, "x", { dark: COLORS, light: { ...COLORS, bg_core: undefined } }]) {
    const checked = validate_module_state(state({ bar_theme }));
    assert.ok(checked.ok && checked.value.bar_theme === undefined, JSON.stringify(bar_theme));
  }
});

test("a full bar state with the longest fields stays small beside the key rows", () => {
  const tab = { mode: "normal", live: true, pending: Array.from({ length: 8 }, () => "<C-S-Backspace>".slice(0, 16)), count: 999999, pass: true, site: "s".repeat(24), recording: "a" };
  const bytes = new TextEncoder().encode(JSON.stringify({ ...tab })).length;
  assert.ok(bytes < 300, `${bytes} bytes`);
});

test("the hello's bar mark is kept only when it is true, and an older hello has none", () => {
  assert.deepEqual(validate_module_hello({ v: V, module_version: "1", bar: true }), { ok: true, value: { v: V, module_version: "1", bar: true } });
  for (const bar of ["yes", 1, false, undefined]) assert.deepEqual(validate_module_hello({ v: V, module_version: "1", bar }), { ok: true, value: { v: V, module_version: "1" } });
});

test("the bar settings need both lists of known items without repeats and a known border, else they are left out", () => {
  const ok = validate_module_state(state({ bar: { left: ["mode", "pending"], right: [], border: "chamfer", extra: 1 } }));
  assert.ok(ok.ok);
  assert.deepEqual(ok.value.bar, { left: ["mode", "pending"], right: [], border: "chamfer" });
  for (const bar of [{ left: ["mode"], right: [] }, { left: ["mode", "mode"], right: [], border: "auto" }, { left: ["nope"], right: [], border: "auto" }, { left: [], right: [], border: "oval" }, "x", { left: "mode", right: [], border: "auto" }]) {
    const checked = validate_module_state(state({ bar }));
    assert.ok(checked.ok && checked.value.bar === undefined, JSON.stringify(bar));
  }
});

test("format characters are refused in a site label and a pending key", () => {
  const checked = validate_module_state(state({ tabs: { "7": { mode: "normal", live: true, site: "AB\u202eCD", pending: ["g\u202e"] } } }));
  assert.ok(checked.ok);
  assert.deepEqual(Object.keys(checked.value.tabs["7"]!), ["mode", "live"]);
});

test("a long pending sequence keeps its last keys", () => {
  const checked = validate_module_state(state({ tabs: { "7": { mode: "normal", live: true, pending: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] } } }));
  assert.ok(checked.ok);
  assert.deepEqual(checked.value.tabs["7"]!.pending, ["c", "d", "e", "f", "g", "h", "i", "j"]);
});
