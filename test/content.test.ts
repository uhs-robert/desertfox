import assert from "node:assert/strict";
import { test } from "node:test";
import { takes_typing } from "../src/content/editable.ts";
import { args_for_count } from "../src/content/invocation_args.ts";
import { create_cancelled_keys } from "../src/content/cancelled_keys.ts";
import { create_key_flow } from "../src/content/key_flow.ts";
import { is_ignored_site, matches_pattern } from "../src/content/match_pattern.ts";
import { mode_label } from "../src/content/mode_label.ts";
import { wire_mode_reports } from "../src/content/mode_report.ts";
import { create_mode_state } from "../src/content/mode_state.ts";
import { plan_steps } from "../src/content/plan_steps.ts";
import { percent_to_offset, pick_scroll_target } from "../src/content/scroll_target.ts";
import { create_matcher } from "../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_VERSION } from "../src/shared/index.ts";
import type { CompiledKeymap, TreeLeaf } from "../src/shared/index.ts";

const leaf = (id: string): TreeLeaf => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "content", count_rule: "ignore" }] });

const browser_chords = { kind: "branch", children: { "<A-j>": leaf("next_tab") } } as const;

const keymap: CompiledKeymap = {
  format_version: COMPILED_KEYMAP_VERSION,
  ignore_sites: [],
  mode_indicator: "always",
  which_key_delay_ms: 0,
  modes: {
    normal: { kind: "branch", children: { j: leaf("down"), g: { kind: "branch", children: { g: leaf("top") } } } },
    insert: { kind: "branch", children: { "<C-x>": leaf("insert_chord") } },
    ignore: { kind: "branch", children: { "<S-Escape>": leaf("leave") } },
    browser: browser_chords,
  },
};

function make_flow(in_field = false) {
  const state = create_mode_state();
  const ran: string[] = [];
  const flow = create_key_flow({
    in_editable_field: () => in_field,
    get_mode: state.get_mode,
    take_pass_next: state.take_pass_next,
    run_leaf: (matched, count) => ran.push(`${matched.steps[0]?.invocation.id}${count ?? ""}`),
    leave_insert: () => state.escape(),
    is_loading: () => false,
    sink_of: () => undefined,
  });
  // The same wiring main.ts does.
  state.listen(() => flow.reset_sequence());
  return { state, ran, flow };
}

test("mode state follows focus only from normal and insert", () => {
  const state = create_mode_state();
  const seen: string[] = [];
  state.listen((mode) => seen.push(mode));
  state.focus_entered_editable();
  state.focus_left_editable();
  state.set_mode("ignore");
  state.focus_entered_editable();
  state.escape();
  state.focus_left_editable();
  assert.deepEqual(seen, ["insert", "normal", "ignore"]);
});

test("escape leaves insert but not ignore", () => {
  const state = create_mode_state("insert");
  state.escape();
  assert.equal(state.get_mode(), "normal");
  state.set_mode("ignore");
  state.escape();
  assert.equal(state.get_mode(), "ignore");
});

test("pass_next fires once", () => {
  const state = create_mode_state();
  state.arm_pass_next();
  assert.equal(state.take_pass_next(), true);
  assert.equal(state.take_pass_next(), false);
});

test("key flow holds keys before the keymap and replays them", () => {
  const { ran, flow } = make_flow();
  assert.equal(flow.handle_token("j"), "cancel");
  assert.equal(flow.handle_token("g"), "cancel");
  assert.equal(flow.handle_token("g"), "cancel");
  assert.deepEqual(ran, []);
  flow.set_matcher(create_matcher(keymap));
  assert.deepEqual(ran, ["down", "top"]);
});

test("key flow cancels matches and half-typed sequences, passes unbound keys", () => {
  const { ran, flow } = make_flow();
  flow.set_matcher(create_matcher(keymap));
  assert.equal(flow.handle_token("x"), "pass");
  assert.equal(flow.handle_token("j"), "cancel");
  assert.equal(flow.handle_token("g"), "cancel");
  assert.equal(flow.handle_token("x"), "pass");
  assert.equal(flow.handle_token("x"), "pass");
  assert.equal(flow.handle_token("3"), "cancel");
  assert.equal(flow.handle_token("j"), "cancel");
  assert.deepEqual(ran, ["down", "down3"]);
});

test("key flow in ignore mode passes everything but the leaving binding", () => {
  const { state, ran, flow } = make_flow();
  flow.set_matcher(create_matcher(keymap));
  state.set_mode("ignore");
  assert.equal(flow.handle_token("j"), "pass");
  assert.equal(flow.handle_token("<S-Escape>"), "cancel");
  assert.deepEqual(ran, ["leave"]);
});

test("key flow in insert mode leaves on Escape and passes letters", () => {
  const { state, flow } = make_flow();
  flow.set_matcher(create_matcher(keymap));
  state.set_mode("insert");
  assert.equal(flow.handle_token("j"), "pass");
  assert.equal(flow.handle_token("<Escape>"), "pass");
  assert.equal(state.get_mode(), "normal");
});

test("pass_next passes one key that would match", () => {
  const { state, ran, flow } = make_flow();
  flow.set_matcher(create_matcher(keymap));
  state.arm_pass_next();
  assert.equal(flow.handle_token("j"), "pass");
  assert.equal(flow.handle_token("j"), "cancel");
  assert.deepEqual(ran, ["down"]);
});

test("a key that breaks a sequence is retried from the root", () => {
  const { ran, flow } = make_flow();
  flow.set_matcher(create_matcher(keymap));
  assert.equal(flow.handle_token("g"), "cancel");
  assert.equal(flow.handle_token("j"), "cancel");
  assert.deepEqual(ran, ["down"]);
});

test("a mode change drops a pending sequence and count", () => {
  const { state, ran, flow } = make_flow();
  flow.set_matcher(create_matcher(keymap));
  assert.equal(flow.handle_token("g"), "cancel");
  state.set_mode("insert");
  state.set_mode("normal");
  assert.equal(flow.handle_token("x"), "pass");
  assert.equal(flow.handle_token("5"), "cancel");
  state.set_mode("ignore");
  state.set_mode("normal");
  assert.equal(flow.handle_token("j"), "cancel");
  assert.deepEqual(ran, ["down"]);
});

test("browser chords run in normal and insert mode and are cancelled", () => {
  const { state, ran, flow } = make_flow();
  flow.set_matcher(create_matcher(keymap), browser_chords);
  assert.equal(flow.handle_token("<A-j>"), "cancel");
  state.set_mode("insert");
  assert.equal(flow.handle_token("<A-j>"), "cancel");
  assert.equal(flow.handle_token("<C-x>"), "cancel");
  state.set_mode("ignore");
  assert.equal(flow.handle_token("<A-j>"), "pass");
  assert.deepEqual(ran, ["next_tab", "next_tab", "insert_chord"]);
});

test("startup holds plain keys outside fields and drops what matches nothing", () => {
  const { ran, flow } = make_flow();
  assert.equal(flow.handle_token("<A-j>"), "pass");
  assert.equal(flow.handle_token("x"), "cancel");
  assert.equal(flow.handle_token("j"), "cancel");
  flow.set_matcher(create_matcher(keymap));
  assert.deepEqual(ran, ["down"]);
  const in_field = make_flow(true);
  assert.equal(in_field.flow.handle_token("j"), "pass");
});

test("startup replay uses the mode set before the keymap", () => {
  const { state, ran, flow } = make_flow();
  assert.equal(flow.handle_token("j"), "cancel");
  state.set_mode("ignore");
  flow.set_matcher(create_matcher(keymap));
  assert.deepEqual(ran, []);
});

test("a stale cancelled code does not eat a later typed letter", () => {
  const keys = create_cancelled_keys();
  keys.record_keydown("KeyJ", "cancel");
  // The keyup went to another tab. Later the same key is typed into a field.
  keys.record_keydown("KeyJ", "pass");
  assert.equal(keys.cancels_keypress("KeyJ"), false);
  keys.record_keydown("KeyK", "cancel");
  assert.equal(keys.cancels_keypress("KeyK"), true);
  assert.equal(keys.take_keyup("KeyK"), true);
});

test("match patterns", () => {
  assert.ok(matches_pattern("<all_urls>", "https://a.test/x"));
  assert.ok(matches_pattern("*://*.docs.test/*", "https://a.docs.test/p?q=1"));
  assert.ok(matches_pattern("*://*.docs.test/*", "http://docs.test/"));
  assert.ok(!matches_pattern("*://*.docs.test/*", "https://evildocs.test/"));
  assert.ok(!matches_pattern("https://a.test/*", "http://a.test/"));
  assert.ok(matches_pattern("https://a.test/app/*", "https://a.test:8080/app/x"));
  assert.ok(!matches_pattern("https://a.test/app/*", "https://a.test/other"));
  assert.ok(is_ignored_site(["https://x.test/*", "https://a.test/*"], "https://a.test/z"));
  assert.ok(!is_ignored_site([], "https://a.test/z"));
});

test("editable kinds", () => {
  assert.ok(takes_typing("INPUT", "text", false));
  assert.ok(takes_typing("input", "", false));
  assert.ok(takes_typing("TEXTAREA", "", false));
  assert.ok(takes_typing("DIV", "", true));
  assert.ok(!takes_typing("INPUT", "checkbox", false));
  assert.ok(!takes_typing("SELECT", "", false));
  assert.ok(!takes_typing("DIV", "", false));
});

test("count rules", () => {
  const args = { a: 1 };
  assert.deepEqual(args_for_count(args, undefined, { param: "n" }), [args]);
  assert.deepEqual(args_for_count(args, 3, "ignore"), [args]);
  assert.equal(args_for_count(args, 3, "repeat").length, 3);
  assert.deepEqual(args_for_count(args, 3, { param: "n" }), [{ a: 1, n: 3 }]);
});

test("plan steps batches background runs in order", () => {
  const step = (id: string, runs_in: "content" | "background") => ({ invocation: { id }, runs_in, count_rule: "ignore" }) as const;
  const segments = plan_steps([step("a", "background"), step("b", "background"), step("c", "content"), step("d", "background")], 2);
  assert.deepEqual(segments.map((s) => s.runs_in), ["background", "content", "background"]);
  assert.deepEqual(segments[0], { runs_in: "background", invocations: [{ id: "a", count: 2 }, { id: "b", count: 2 }] });
});

const area = (ref: string, can_scroll_x: boolean, can_scroll_y: boolean, size: number) => ({ ref, can_scroll_x, can_scroll_y, area: size });

test("scroll target order: focus chain, page, largest", () => {
  const pane = area("pane", false, true, 100);
  const page = area("page", false, true, 900);
  const big = area("big", false, true, 500);
  const small = area("small", false, true, 50);
  assert.equal(pick_scroll_target([area("input", false, false, 5), pane], page, () => [], "y"), "pane");
  assert.equal(pick_scroll_target([], page, () => [big], "y"), "page");
  assert.equal(pick_scroll_target([], area("page", false, false, 900), () => [small, big], "y"), "big");
  assert.equal(pick_scroll_target([], page, () => [big], "x"), undefined);
});

test("percent offsets clamp", () => {
  assert.equal(percent_to_offset(100, 1000, 400), 600);
  assert.equal(percent_to_offset(50, 1000, 400), 300);
  assert.equal(percent_to_offset(-5, 1000, 400), 0);
  assert.equal(percent_to_offset(100, 300, 400), 0);
});

test("mode label follows the mode_indicator setting", () => {
  assert.equal(mode_label("normal", false, "always"), "NORMAL");
  assert.equal(mode_label("normal", false, "not_normal"), undefined);
  assert.equal(mode_label("insert", false, "always"), "INSERT");
  assert.equal(mode_label("insert", false, "not_normal"), "INSERT");
  assert.equal(mode_label("ignore", false, "not_normal"), "IGNORE");
  assert.equal(mode_label("normal", true, "always"), "PASS");
  assert.equal(mode_label("normal", true, "not_normal"), "PASS");
  assert.equal(mode_label("hint", false, "always"), undefined);
  assert.equal(mode_label("cmdline", false, "always"), undefined);
  assert.equal(mode_label("caret", false, "always"), "CARET");
  assert.equal(mode_label("visual", false, "not_normal"), "VISUAL");
  assert.equal(mode_label("insert", false, "off"), undefined);
  assert.equal(mode_label("normal", true, "off"), undefined);
});

test("display listener fires on mode changes and on pass-next arming and use", () => {
  const state = create_mode_state();
  let fired = 0;
  state.listen_display(() => fired++);
  state.arm_pass_next();
  assert.equal(state.is_pass_next_armed(), true);
  assert.equal(state.take_pass_next(), true);
  assert.equal(state.take_pass_next(), false);
  state.set_mode("ignore");
  state.set_mode("ignore");
  assert.equal(fired, 3);
});

test("the mode is reported at start and on every change", () => {
  const state = create_mode_state();
  const reports: string[] = [];
  wire_mode_reports(state, (mode) => reports.push(mode));
  state.set_mode("ignore");
  assert.deepEqual(reports, ["normal", "ignore"]);
});
