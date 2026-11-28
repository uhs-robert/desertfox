import assert from "node:assert/strict";
import { test } from "node:test";
import { MODULE_FIREFOX_PAGES } from "../../src/shared/firefox_pages.ts";
import {
  BROWSER_MODULE_PROTOCOL_VERSION as V,
  ABSENT_TAB,
  DEVTOOLS_ACTIONS,
  DEVTOOLS_HINT_KEY,
  DEVTOOLS_TREE_KEYS,
  DEVTOOLS_VISUAL_KEY,
  DEVTOOLS_VISUAL_KEYS,
  MAX_DEVTOOLS_VISUAL_ROWS,
  wrong_shape_refusal,
  MAX_DEVTOOLS_KEY_ROWS,
  check_module_args,
  EXTENSION_TO_MODULE_KINDS,
  MAX_HELLO_BYTES,
  MAX_KEY_ROWS,
  MAX_MESSAGE_LIST_BYTES,
  MAX_KIND_BYTES,
  MAX_SNAPSHOT_BYTES,
  MESSAGE_ENVELOPE_BYTES,
  LOCKED_PAGE_ROUTES,
  locked_route_of,
  message_list_bytes,
  SNAPSHOT_PART_NAMES,
  SNAPSHOT_PARTS,
  validate_snapshot,
  reply_fits,
  MAX_MESSAGES,
  MODULE_TO_EXTENSION_KINDS,
  PAGE_HINT_ACTIONS,
  status_of_hello,
  tab_state_in,
  DEFAULT_MAX_AGE_MS,
  is_too_old,
  validate_message,
  validate_message_list,
  validate_module_hello,
  validate_module_state,
  which_key_table_of,
  MAX_WHICH_KEY_BYTES,
  MAX_WHICH_KEY_PANELS,
  MAX_WHICH_KEY_ROWS,
} from "../../src/shared/browser_module_protocol.ts";

const state = (patch: Record<string, unknown> = {}) => ({ v: V, enabled: true, keys: [{ key: "J", id: "tab.next", args: {} }], tabs: { "7": { mode: "normal", live: false } }, ...patch });

test("blur_on_load is optional: kept when true or false, absent when not given, and any other value fails", () => {
  for (const blur_on_load of [true, false]) {
    const checked = validate_module_state(state({ blur_on_load }));
    assert.ok(checked.ok && checked.value.blur_on_load === blur_on_load);
  }
  const absent = validate_module_state(state());
  assert.ok(absent.ok && !("blur_on_load" in absent.value));
  assert.equal(validate_module_state(state({ blur_on_load: "yes" })).ok, false);
});


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

test("the hint.browser bindings are optional, and a bad list is left out without failing the state", () => {
  const base = { v: V, enabled: true, keys: [], tabs: {} };
  const keys_of = (chrome_hint_keys: unknown) => {
    const checked = validate_module_state({ ...base, chrome_hint_keys });
    assert.ok(checked.ok);
    return checked.value.chrome_hint_keys;
  };
  const without = validate_module_state(base);
  assert.ok(without.ok && without.value.chrome_hint_keys === undefined);
  assert.deepEqual(keys_of([["g", "B"], ["<C-b>"]]), [["g", "B"], ["<C-b>"]]);
  for (const bad of ["gB", [[]], [["g", "B", "x", "y", "z"]], [["g"], ["g", "B"]], [["a"], ["b"], ["c"], ["d"], ["e"]], [["g b"]]]) assert.equal(keys_of(bad), undefined, JSON.stringify(bad));
});

const KINDS = { push: { args: { n: "int" as const }, reply: false }, ask: { args: { axis: "axis" as const }, reply: true } };
const msg = (patch: Record<string, unknown>) => ({ v: V, id: "m1", kind: "ask", args: { axis: "x" }, ...patch });

test("each direction lists only its own kinds, so any other request is refused", () => {
  assert.deepEqual(Object.keys(MODULE_TO_EXTENSION_KINDS), ["page_call", "page_gone", "run", "chrome_hints.targets", "chrome_hints.key", "chrome_hints.end", "chrome_hints.want", "devtools_hints.ask", "page_hints.want"]);
  assert.deepEqual(Object.keys(EXTENSION_TO_MODULE_KINDS), ["page_push", "pane.split_new_tab", "pane.split_next_tab", "pane.unsplit", "pane.close_both", "pane.resize", "pane.focus_region", "pane.focus_direction", "pane.equalize", "address_bar.open", "cmdline_panel.open", "chrome_hints.collect", "chrome_hints.collect_here", "chrome_hints.draw", "chrome_hints.pick", "chrome_hints.clear", "page_hints.collect", "devtools.keys", "devtools_hints.collect", "devtools_hints.draw", "devtools_hints.pick", "devtools_hints.clear", "devtools.visual_keys", "firefox_page.open", "selection.read"]);
  assert.ok(MODULE_TO_EXTENSION_KINDS["page_call"]!.reply && EXTENSION_TO_MODULE_KINDS["page_push"]!.reply, "both answer in the reply");
  assert.equal(MODULE_TO_EXTENSION_KINDS["page_gone"]!.reply, false, "chrome's word that a document went away is a push");
  // A page waits on its first calls while it starts, so they may be older than the default.
  assert.equal(MODULE_TO_EXTENSION_KINDS["page_call"]!.max_age_ms, 10000);
  assert.equal(EXTENSION_TO_MODULE_KINDS["page_push"]!.max_age_ms, 10000);
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
  assert.equal(validate_message_list([msg({ args: { axis: "x", pad: "p".repeat(message_list_bytes(KINDS)) } })], KINDS).ok, false);
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

const page_call = (message: string, patch: Record<string, unknown> = {}, id = "c1") => ({ v: V, id, kind: "page_call", args: { tab_id: 7, document_id: 1, message, ...patch } });

test("a page call checks the shape of its args", () => {
  assert.ok(validate_message(page_call("{}"), MODULE_TO_EXTENSION_KINDS).ok);
  for (const args of [{ tab_id: "7" }, { tab_id: 1.5 }, { document_id: "1" }, { document_id: undefined }, { message: 5 }, { message: undefined }]) {
    assert.equal(validate_message(page_call("{}", args), MODULE_TO_EXTENSION_KINDS).ok, false, JSON.stringify(args));
  }
});

test("a message over its own kind's limit is refused, and a kind with no limit keeps the default list size", () => {
  const limited = { small: { args: { message: "text" as const }, reply: true, max_bytes: 100 }, plain: { args: { message: "text" as const }, reply: true } };
  const of = (kind: string, size: number) => ({ v: V, id: "s", kind, args: { message: "m".repeat(size) } });
  assert.ok(validate_message(of("small", 40), limited).ok);
  const over = validate_message(of("small", 100), limited);
  assert.deepEqual(over, { ok: false, problem: "a small message is over its size limit" });
  assert.ok(validate_message(of("plain", MAX_MESSAGE_LIST_BYTES - 100), limited).ok);
  assert.equal(validate_message(of("plain", MAX_MESSAGE_LIST_BYTES), limited).ok, false);
  // The refusal is answered when the kind expects a reply.
  const list = validate_message_list([of("small", 200)], limited);
  assert.ok(list.ok);
  assert.deepEqual(list.value.refused.map((r) => r.id), ["s"]);
  assert.equal(validate_message(page_call("m".repeat(MAX_KIND_BYTES)), MODULE_TO_EXTENSION_KINDS).ok, false);
  assert.ok(validate_message(page_call("m".repeat(MAX_KIND_BYTES - MESSAGE_ENVELOPE_BYTES)), MODULE_TO_EXTENSION_KINDS).ok);
});

test("no kind passes the 64 KB ceiling, and a list makes room for its largest kind", () => {
  for (const kinds of [MODULE_TO_EXTENSION_KINDS, EXTENSION_TO_MODULE_KINDS]) {
    for (const row of Object.values(kinds)) assert.ok((row.max_bytes ?? 0) <= MAX_KIND_BYTES);
    assert.equal(message_list_bytes(kinds), 2 * MAX_KIND_BYTES + MESSAGE_ENVELOPE_BYTES);
  }
  assert.equal(message_list_bytes({}), MAX_MESSAGE_LIST_BYTES + MESSAGE_ENVELOPE_BYTES);
  assert.equal(message_list_bytes({ small: { args: {}, reply: false, max_bytes: 1000 } }), MAX_MESSAGE_LIST_BYTES + MESSAGE_ENVELOPE_BYTES);
  assert.equal(message_list_bytes({ huge: { args: {}, reply: false, max_bytes: 10 * MAX_KIND_BYTES } }), 2 * MAX_KIND_BYTES + MESSAGE_ENVELOPE_BYTES, "a row past the ceiling counts as the ceiling");
  const full_size = "m".repeat(MAX_KIND_BYTES - MESSAGE_ENVELOPE_BYTES);
  const full = validate_message_list([page_call(full_size), page_call(full_size, {}, "c2"), page_call("{}", {}, "c3")], MODULE_TO_EXTENSION_KINDS);
  assert.ok(full.ok && full.value.messages.length === 3, "two full-size calls and a small one fit in one list, so a full-size message survives the next write");
});

test("the locked page routes refuse every unlisted, page-only or junk type", () => {
  for (const type of ["change_setting", "export_config", "eval", "__proto__", "constructor", "", 5, undefined, null]) assert.equal(locked_route_of(type), "refused", String(type));
  assert.equal(locked_route_of("run"), "background");
  assert.equal(locked_route_of("load_bundle"), "module");
  assert.equal(locked_route_of("read_keymap"), "snapshot");
  for (const type of ["snippet_run", "inspect_pick", "quality_probe", "complete_items"]) assert.equal(LOCKED_PAGE_ROUTES[type as keyof typeof LOCKED_PAGE_ROUTES], "refused", type);
});

test("each snapshot part has its own check and cap, under the 512 KB ceiling", () => {
  assert.deepEqual(SNAPSHOT_PART_NAMES, ["keymap", "config", "theme", "which_key"]);
  for (const part of SNAPSHOT_PART_NAMES) assert.ok(SNAPSHOT_PARTS[part].max_bytes <= MAX_SNAPSHOT_BYTES);
  assert.deepEqual(new Set(SNAPSHOT_PART_NAMES.map((part) => SNAPSHOT_PARTS[part].key)).size, 4);
  const good = { keymap: { format_version: 1, modes: {} }, config: { settings: {} }, theme: { dark: {}, light: {} }, which_key: { title: [], rows: [] } };
  for (const part of SNAPSHOT_PART_NAMES) {
    assert.deepEqual(validate_snapshot(part, { v: V, value: good[part], later: 1 }), { ok: true, value: { v: V, value: good[part] } }, part);
    assert.deepEqual(validate_snapshot(part, { v: V }), { ok: true, value: { v: V } }, "every field but v is optional");
    for (const junk of [undefined, null, "x", [], { v: V + 1, value: good[part] }, { value: good[part] }, { v: V, value: 5 }]) assert.equal(validate_snapshot(part, junk).ok, false, `${part} ${JSON.stringify(junk)}`);
    if (part === "keymap") for (const value of ["{}", { modes: {} }, { format_version: "1", modes: {} }, { format_version: 1, modes: [] }, { format_version: 1, modes: {}, site_rules: {} }]) assert.equal(validate_snapshot(part, { v: V, value }).ok, false, JSON.stringify(value));
    assert.equal(validate_snapshot(part, { v: V, value: good[part], pad: "p".repeat(SNAPSHOT_PARTS[part].max_bytes) }).ok, false, `${part} over its cap`);
  }
  assert.equal(validate_snapshot("theme", { v: V, value: { dark: {} } }).ok, false);
  assert.equal(validate_snapshot("which_key", { v: V, value: { rows: "x", title: [] } }).ok, false);
  const cyclic: Record<string, unknown> = { v: V };
  cyclic.value = cyclic;
  assert.equal(validate_snapshot("config", cyclic).ok, false);
});

test("a reply may carry a value as text, which an older reader ignores, and junk or oversize values are refused", () => {
  assert.deepEqual(validate_message({ v: V, reply_to: "c1", ok: true, value: '{"value":1}' }, KINDS), { ok: true, value: { v: V, reply_to: "c1", ok: true, value: '{"value":1}' } });
  for (const value of [5, {}, null, "v".repeat(MAX_KIND_BYTES)]) assert.equal(validate_message({ v: V, reply_to: "c1", ok: true, value }, KINDS).ok, false, String(value).slice(0, 20));
  const row = { args: {}, reply: true, max_bytes: 200 };
  assert.ok(reply_fits({ v: V, reply_to: "c1", ok: true, value: "x".repeat(100) }, row));
  assert.equal(reply_fits({ v: V, reply_to: "c1", ok: true, value: "x".repeat(200) }, row), false, "the writer checks the answered kind's own limit");
});
const COLORS = { bg_core: "#101010", mode_normal: "#89b4fa", mode_insert: "#a6e3a1", mode_ignore: "#f38ba8", mode_caret: "#cba6f7", mode_visual: "#f9e2af", mode_item: "#94e2d5", mode_media: "#fab387", fg_core: "#cdd6f4", primary: "#89b4fa", secondary: "#b4befe" };

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

test("a reply error loses control and bidi characters before anyone shows it", () => {
  const checked = validate_message({ v: V, reply_to: "m1", ok: false, error: "no\u202e split\n\u0007here" }, KINDS);
  assert.deepEqual(checked, { ok: true, value: { v: V, reply_to: "m1", ok: false, error: "no splithere" } });
});

test("the DevTools key table is a push of one-character keys with actions from the list, well under the list cap", () => {
  const push = (keys: unknown) => validate_message({ v: V, id: "d1", kind: "devtools.keys", args: { keys } }, EXTENSION_TO_MODULE_KINDS);
  assert.equal(EXTENSION_TO_MODULE_KINDS["devtools.keys"]!.reply, false);
  assert.deepEqual(push([{ key: "j", action: "tree.down", later: 1 }]), { ok: true, value: { v: V, id: "d1", kind: "devtools.keys", args: { keys: [{ key: "j", action: "tree.down" }] } } });
  assert.ok(push(DEVTOOLS_TREE_KEYS).ok);
  const full = Array.from({ length: MAX_DEVTOOLS_KEY_ROWS }, (_, index) => ({ key: "abcdefgh"[index]!, action: "tree.collapse" }));
  assert.ok(push(full).ok);
  const largest = { v: V, id: "x".repeat(32), kind: "devtools.keys", args: { keys: full }, sent_at: Number.MAX_SAFE_INTEGER };
  assert.ok(new TextEncoder().encode(JSON.stringify(largest)).length <= EXTENSION_TO_MODULE_KINDS["devtools.keys"]!.max_bytes!, "the largest table fits its kind");
  assert.ok(EXTENSION_TO_MODULE_KINDS["devtools.keys"]!.max_bytes! * 2 <= MAX_MESSAGE_LIST_BYTES);
  for (const bad of [undefined, "j", [], [...full, { key: "i", action: "tree.up" }], [{ key: "<C-j>", action: "tree.down" }], [{ key: "Escape", action: "tree.down" }], [{ key: "\t", action: "tree.down" }], [{ key: "j", action: "eval" }], [{ key: "j", action: "tree.down" }, { key: "j", action: "tree.up" }], [null]]) {
    assert.equal(push(bad).ok, false, JSON.stringify(bad));
  }
});

test("the hint key is one more DevTools action, and the hello says devtools_hints only when it is true", () => {
  const push = (keys: unknown) => validate_message({ v: V, id: "d1", kind: "devtools.keys", args: { keys } }, EXTENSION_TO_MODULE_KINDS);
  assert.ok(push([...DEVTOOLS_TREE_KEYS, DEVTOOLS_HINT_KEY]).ok);
  // The reason for the flag: a table with an action the reader does not know fails whole, as it does in a module before hints.
  const older_actions = DEVTOOLS_ACTIONS.filter((action) => action !== "hints.start");
  const older_fit = (keys: { action: string }[]) => keys.every(({ action }) => (older_actions as readonly string[]).includes(action));
  assert.equal(older_fit([...DEVTOOLS_TREE_KEYS, DEVTOOLS_HINT_KEY]), false);
  assert.equal(push([...DEVTOOLS_TREE_KEYS, { key: "f", action: "hints.later" }]).ok, false);
  assert.deepEqual(validate_module_hello({ v: V, module_version: "1", devtools_hints: true }), { ok: true, value: { v: V, module_version: "1", devtools_hints: true } });
  for (const flag of [false, "true", 1]) assert.deepEqual(validate_module_hello({ v: V, module_version: "1", devtools_hints: flag }), { ok: true, value: { v: V, module_version: "1" } });
  const largest = { v: V, id: "x".repeat(32), kind: "devtools.keys", args: { keys: [...DEVTOOLS_TREE_KEYS, DEVTOOLS_HINT_KEY] }, sent_at: Number.MAX_SAFE_INTEGER };
  assert.ok(new TextEncoder().encode(JSON.stringify(largest)).length <= EXTENSION_TO_MODULE_KINDS["devtools.keys"]!.max_bytes!);
});

test("visual mode is one more DevTools action with a push of its own keys, and the hello says devtools_visual only when it is true", () => {
  const keys_push = (keys: unknown) => validate_message({ v: V, id: "d1", kind: "devtools.keys", args: { keys } }, EXTENSION_TO_MODULE_KINDS);
  const visual_push = (keys: unknown) => validate_message({ v: V, id: "d2", kind: "devtools.visual_keys", args: { keys } }, EXTENSION_TO_MODULE_KINDS);
  const table = [...DEVTOOLS_TREE_KEYS, DEVTOOLS_HINT_KEY, DEVTOOLS_VISUAL_KEY];
  assert.ok(keys_push(table).ok);
  assert.equal(EXTENSION_TO_MODULE_KINDS["devtools.visual_keys"]!.reply, false);
  assert.deepEqual(visual_push([{ key: "y", op: "copy", text: "x" }]), { ok: true, value: { v: V, id: "d2", kind: "devtools.visual_keys", args: { keys: [{ key: "y", op: "copy" }] } } });
  assert.ok(visual_push(DEVTOOLS_VISUAL_KEYS).ok);
  const full = Array.from({ length: MAX_DEVTOOLS_VISUAL_ROWS }, (_, index) => ({ key: "abcdefghijklmnop"[index]!, op: "word.forward" }));
  assert.ok(visual_push(full).ok);
  for (const bad of [undefined, [], [...full, { key: "q", op: "copy" }], [{ key: "<C-c>", op: "copy" }], [{ key: "Escape", op: "copy" }], [{ key: "y", op: "paste" }], [{ key: "y", action: "copy" }], [{ key: "y", op: "copy" }, { key: "y", op: "line.up" }], [null]]) {
    assert.equal(visual_push(bad).ok, false, JSON.stringify(bad));
  }
  for (const [kind, keys] of [["devtools.keys", table], ["devtools.visual_keys", full]] as const) {
    const largest = { v: V, id: "x".repeat(32), kind, args: { keys }, sent_at: Number.MAX_SAFE_INTEGER };
    assert.ok(new TextEncoder().encode(JSON.stringify(largest)).length <= EXTENSION_TO_MODULE_KINDS[kind]!.max_bytes!, `the largest ${kind} fits its kind`);
  }
  assert.deepEqual(validate_module_hello({ v: V, module_version: "1", devtools_visual: true }), { ok: true, value: { v: V, module_version: "1", devtools_visual: true } });
  for (const flag of [false, "true", 1]) assert.deepEqual(validate_module_hello({ v: V, module_version: "1", devtools_visual: flag }), { ok: true, value: { v: V, module_version: "1" } });
});

test("the DevTools hint rows match the chrome hint rows they stand beside, and the ask is a small call with a reply, as chrome_hints.want is", () => {
  for (const verb of ["draw", "pick", "clear"]) assert.deepEqual(EXTENSION_TO_MODULE_KINDS[`devtools_hints.${verb}`], EXTENSION_TO_MODULE_KINDS[`chrome_hints.${verb}`], verb);
  assert.deepEqual(EXTENSION_TO_MODULE_KINDS["devtools_hints.collect"], { args: { session: "int", ask: "int", colors: "text" }, reply: true, max_bytes: 1024 });
  assert.deepEqual(MODULE_TO_EXTENSION_KINDS["devtools_hints.ask"], { args: { ask: "int" }, reply: true, max_bytes: 256 });
  assert.equal(validate_message({ v: V, id: "a1", kind: "devtools_hints.ask", args: { ask: "1" } }, MODULE_TO_EXTENSION_KINDS).ok, false);
});

test("hints on Firefox's own pages: the want carries the token and the matched keys, the collect takes an action of the fixed list only, and the state and hello flags are kept only when true", () => {
  assert.deepEqual(MODULE_TO_EXTENSION_KINDS["page_hints.want"], { args: { start: "int", keys: "text", count: "int" }, reply: true, max_bytes: 512 });
  const collect = (action: unknown) => validate_message({ v: V, id: "p1", kind: "page_hints.collect", args: { session: 1, start: 2, action, colors: "" } }, EXTENSION_TO_MODULE_KINDS);
  for (const action of PAGE_HINT_ACTIONS) assert.ok(collect(action).ok, action);
  for (const action of ["here", "window", "copy", "inspect", "", undefined, 1]) assert.equal(collect(action).ok, false, String(action));
  // A selector or an address never fits a collect: its only text is the colors, and the action is a name of the list.
  assert.deepEqual(Object.keys(EXTENSION_TO_MODULE_KINDS["page_hints.collect"]!.args), ["session", "start", "action", "colors"]);
  const kept = validate_module_state(state({ page_hints: true }));
  assert.ok(kept.ok && kept.value.page_hints === true);
  for (const flag of [false, "true", 1, undefined]) {
    const checked = validate_module_state(state({ page_hints: flag }));
    assert.ok(checked.ok && !("page_hints" in checked.value), String(flag));
  }
  assert.deepEqual(validate_module_hello({ v: V, module_version: "1", page_hints: true }), { ok: true, value: { v: V, module_version: "1", page_hints: true } });
  assert.deepEqual(validate_module_hello({ v: V, module_version: "1", page_hints: 1 }), { ok: true, value: { v: V, module_version: "1" } });
});

test("firefox_page.open takes a page name from the module's list, an optional where and tab id, and never an address", () => {
  const open = (args: Record<string, unknown>) => validate_message({ v: V, id: "f1", kind: "firefox_page.open", args }, EXTENSION_TO_MODULE_KINDS);
  for (const page of MODULE_FIREFOX_PAGES) assert.deepEqual(open({ page }), { ok: true, value: { v: V, id: "f1", kind: "firefox_page.open", args: { page } } }, page);
  assert.deepEqual(open({ page: "config", where: "here", tab_id: 4 }), { ok: true, value: { v: V, id: "f1", kind: "firefox_page.open", args: { page: "config", where: "here", tab_id: 4 } } });
  // A field the row does not list is dropped, so an address cannot ride along.
  assert.deepEqual(open({ page: "config", address: "https://example.com/" }), { ok: true, value: { v: V, id: "f1", kind: "firefox_page.open", args: { page: "config" } } });
  for (const page of ["logins", "about:config", "about:preferences#privacy", "Settings", "", undefined, 1]) assert.equal(open({ page }).ok, false, String(page));
  for (const where of ["window", "background", "", 1]) assert.equal(open({ page: "config", where }).ok, false, String(where));
  assert.equal(open({ page: "config", tab_id: "4" }).ok, false);
  assert.deepEqual(Object.keys(EXTENSION_TO_MODULE_KINDS["firefox_page.open"]!.args), ["page", "where", "tab_id"]);
  assert.equal(EXTENSION_TO_MODULE_KINDS["firefox_page.open"]!.reply, true);
  assert.equal(wrong_shape_refusal("firefox_page.open", "page"), "firefox_page.open page has the wrong shape");
});

test("the hello says firefox_pages only when it is true, and an older hello has none", () => {
  assert.deepEqual(validate_module_hello({ v: V, module_version: "1", firefox_pages: true }), { ok: true, value: { v: V, module_version: "1", firefox_pages: true } });
  for (const flag of [false, "true", 1]) assert.deepEqual(validate_module_hello({ v: V, module_version: "1", firefox_pages: flag }), { ok: true, value: { v: V, module_version: "1" } }, String(flag));
  assert.deepEqual(validate_module_hello({ v: V, module_version: "1" }), { ok: true, value: { v: V, module_version: "1" } });
});

const WHICH_KEY = { delay_ms: 300, skip: ["g"], border: "round", panels: { g: { title: ["+Go"], rows: [{ keys: "g", command: "Scroll to top" }, { keys: "o", command: "+Open", more: true }] }, "g o": { title: ["+Go", "+Open"], rows: [{ keys: "<key>", command: "Open quickmark" }] } } };

test("a which-key table of known fields is kept, its unknown fields dropped, and it rides in the state", () => {
  const extra = { ...WHICH_KEY, extra: 1, panels: { ...WHICH_KEY.panels, g: { ...WHICH_KEY.panels.g, extra: 1, rows: [{ ...WHICH_KEY.panels.g.rows[0]!, description: "x", chain: {} }] } } };
  assert.deepEqual(which_key_table_of(extra), { ...WHICH_KEY, panels: { ...WHICH_KEY.panels, g: { title: ["+Go"], rows: [{ keys: "g", command: "Scroll to top" }] } } });
  const checked = validate_module_state(state({ which_key: WHICH_KEY }));
  assert.ok(checked.ok);
  assert.deepEqual(checked.value.which_key, WHICH_KEY);
});

test("a bad which-key table is left out whole and never fails the state", () => {
  const panel = WHICH_KEY.panels.g;
  const row = panel.rows[0]!;
  const bad_tables = [
    "x",
    { ...WHICH_KEY, delay_ms: 0 },
    { ...WHICH_KEY, delay_ms: 1.5 },
    { ...WHICH_KEY, delay_ms: 600_000 },
    { ...WHICH_KEY, border: "dotted" },
    { ...WHICH_KEY, skip: "g" },
    { ...WHICH_KEY, panels: [] },
    { ...WHICH_KEY, panels: { "": panel } },
    { ...WHICH_KEY, panels: { "g  o": panel } },
    { ...WHICH_KEY, panels: { "a b c d e f g h i": panel } },
    { ...WHICH_KEY, panels: { g: { ...panel, rows: [] } } },
    { ...WHICH_KEY, panels: { g: { ...panel, rows: [{ ...row, keys: "" }] } } },
    { ...WHICH_KEY, panels: { g: { ...panel, rows: [{ ...row, keys: 7 }] } } },
    { ...WHICH_KEY, panels: { g: { ...panel, rows: [{ ...row, command: "a\u202eb" }] } } },
    { ...WHICH_KEY, panels: { g: { ...panel, rows: [{ ...row, command: "<img src=x>".repeat(10) }] } } },
    { ...WHICH_KEY, panels: { g: { ...panel, rows: [{ ...row, more: "yes" }] } } },
    { ...WHICH_KEY, panels: { g: { ...panel, title: ["+Go\n"] } } },
    { ...WHICH_KEY, panels: { g: { ...panel, title: "+Go" } } },
    { ...WHICH_KEY, panels: { g: { ...panel, rows: Array.from({ length: MAX_WHICH_KEY_ROWS + 1 }, () => row) } } },
    { ...WHICH_KEY, panels: Object.fromEntries(Array.from({ length: MAX_WHICH_KEY_PANELS + 1 }, (_, index) => [`<F${index}>`, panel])) },
    { ...WHICH_KEY, padding: "x".repeat(MAX_WHICH_KEY_BYTES) },
  ];
  for (const which_key of bad_tables) {
    const checked = validate_module_state(state({ which_key }));
    assert.ok(checked.ok && checked.value.which_key === undefined, JSON.stringify(which_key).slice(0, 120));
  }
});

test("a __proto__ panel path stays a plain key and sets no prototype", () => {
  const table = which_key_table_of({ ...WHICH_KEY, panels: JSON.parse(`{"__proto__": ${JSON.stringify(WHICH_KEY.panels.g)}}`) });
  assert.ok(table);
  assert.equal(Object.getPrototypeOf(table.panels), Object.prototype);
  assert.deepEqual(Object.keys(table.panels), ["__proto__"]);
});

test("selection.read takes a tab id only and answers with text, so no address or selector crosses", () => {
  const read = (args: Record<string, unknown>) => validate_message({ v: V, id: "s1", kind: "selection.read", args }, EXTENSION_TO_MODULE_KINDS);
  assert.deepEqual(read({ tab_id: 4 }), { ok: true, value: { v: V, id: "s1", kind: "selection.read", args: { tab_id: 4 } } });
  assert.deepEqual(read({ tab_id: 4, selector: "body", url: "https://example.com/" }), { ok: true, value: { v: V, id: "s1", kind: "selection.read", args: { tab_id: 4 } } });
  assert.equal(read({}).ok, false);
  assert.equal(read({ tab_id: "4" }).ok, false);
  assert.deepEqual(Object.keys(EXTENSION_TO_MODULE_KINDS["selection.read"]!.args), ["tab_id"]);
  assert.equal(EXTENSION_TO_MODULE_KINDS["selection.read"]!.reply, true);
});
