import assert from "node:assert/strict";
import { test } from "node:test";
import { is_editable_element, set_editable_rules, takes_typing } from "../src/content/editable.ts";
import { args_for_count } from "../src/content/invocation_args.ts";
import { create_cancelled_keys } from "../src/content/cancelled_keys.ts";
import { cancels_keypress, cancels_keyup, press_target, replay_key_to_page } from "../src/content/replay_key.ts";
import { cancels_unbound_key, create_key_flow } from "../src/content/key_flow.ts";
import { match_regex_source, matches_any_address, matches_pattern } from "../src/shared/match_pattern.ts";
import { holds_own_focus, wire_mode_reports } from "../src/content/mode_report.ts";
import { create_mode_state } from "../src/content/mode_state.ts";
import { percent_to_offset, pick_scroll_target } from "../src/content/scroll_target.ts";
import { create_matcher } from "../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_VERSION, current_keymap, is_freed } from "../src/shared/index.ts";
import { compile_keymap } from "../src/shared/keys/index.ts";
import { frees_of, prune_tree } from "../src/shared/keys/prune_tree.ts";
import type { CompiledKeymap, TreeLeaf } from "../src/shared/index.ts";

const leaf = (id: string): TreeLeaf => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "content", count_rule: "ignore" }] });

const browser_chords = { kind: "branch", children: { "<A-j>": leaf("next_tab") } } as const;

const keymap: CompiledKeymap = {
  format_version: COMPILED_KEYMAP_VERSION,
  mode_indicator: "always",
  which_key_delay_ms: 0, toast_ms: 3000, toast_error_ms: 6000,
  modes: {
    normal: { kind: "branch", children: { j: leaf("down"), g: { kind: "branch", children: { g: leaf("top") } } } },
    insert: { kind: "branch", children: { "<C-x>": leaf("insert_chord") } },
    ignore: { kind: "branch", children: { "<S-Escape>": leaf("leave") } },
    browser: browser_chords,
  },
};

function make_flow(in_field = false, escape_to_page = false) {
  const state = create_mode_state();
  const ran: string[] = [];
  const flow = create_key_flow({
    in_editable_field_: () => in_field,
    escape_to_page_: () => escape_to_page,
    get_mode_: state.get_mode_,
    take_pass_next_: state.take_pass_next_,
    run_leaf_: (matched, count, repeat) => ran.push(`${matched.steps[0]?.invocation.id}${count ?? ""}${repeat ? "!" : ""}`),
    leave_insert_: () => state.escape(),
    is_loading_: () => false,
    loading_sink_bundles_: () => [],
    sink_of_: () => undefined,
    on_prefix_: () => {},
  });
  // The same wiring main.ts does.
  state.listen(() => flow.reset_sequence_());
  return { state, ran, flow };
}

test("mode state follows focus into a field from normal, caret and visual only", () => {
  const state = create_mode_state();
  const seen: string[] = [];
  state.listen((mode) => seen.push(mode));
  state.focus_entered_editable_();
  state.focus_left_editable_();
  state.set_mode_("ignore");
  state.focus_entered_editable_();
  state.escape();
  state.focus_left_editable_();
  assert.deepEqual(seen, ["insert", "normal", "ignore"]);
});

test("insert set by a mode set outlasts focus leaving a field, and Escape ends it", () => {
  const state = create_mode_state();
  state.set_mode_("insert");
  assert.equal(state.is_manual_insert_(), true);
  state.focus_entered_editable_();
  state.focus_left_editable_();
  assert.equal(state.get_mode_(), "insert");
  state.escape();
  assert.deepEqual([state.get_mode_(), state.is_manual_insert_()], ["normal", false]);
});

test("insert from focus is not manual, so leaving the field ends it", () => {
  const state = create_mode_state();
  state.focus_entered_editable_();
  assert.equal(state.is_manual_insert_(), false);
  state.focus_left_editable_();
  assert.equal(state.get_mode_(), "normal");
});

for (const mode of ["caret", "visual"] as const) {
  test(`focus in a field leaves ${mode} mode for insert, and leaving the field returns to normal`, () => {
    const state = create_mode_state();
    state.set_mode_(mode);
    state.focus_entered_editable_();
    assert.equal(state.get_mode_(), "insert");
    state.focus_left_editable_();
    assert.equal(state.get_mode_(), "normal");
  });
}

for (const mode of ["ignore", "hint", "cmdline"] as const) {
  test(`focus in a field keeps ${mode} mode`, () => {
    const state = create_mode_state();
    state.set_mode_(mode);
    state.focus_entered_editable_();
    assert.equal(state.get_mode_(), mode);
  });
}

test("typing in a field after focus from caret mode passes through the key flow", () => {
  const { state, ran, flow } = make_flow(true);
  flow.set_matcher_(create_matcher({ ...keymap, modes: { ...keymap.modes, caret: { kind: "branch", children: { j: leaf("caret_down") } } } }));
  state.set_mode_("caret");
  state.focus_entered_editable_();
  assert.equal(flow.handle_token_("j"), "pass");
  assert.deepEqual(ran, []);
});

test("escape leaves insert but not ignore", () => {
  const state = create_mode_state("insert");
  state.escape();
  assert.equal(state.get_mode_(), "normal");
  state.set_mode_("ignore");
  state.escape();
  assert.equal(state.get_mode_(), "ignore");
});

test("pass_next fires once", () => {
  const state = create_mode_state();
  state.arm_pass_next_();
  assert.equal(state.take_pass_next_(), true);
  assert.equal(state.take_pass_next_(), false);
});

test("key flow holds keys before the keymap and replays them", () => {
  const { ran, flow } = make_flow();
  assert.equal(flow.handle_token_("j"), "cancel");
  assert.equal(flow.handle_token_("g"), "cancel");
  assert.equal(flow.handle_token_("g"), "cancel");
  assert.deepEqual(ran, []);
  flow.set_matcher_(create_matcher(keymap));
  assert.deepEqual(ran, ["down", "top"]);
});

test("key flow cancels matches and half-typed sequences, passes unbound keys", () => {
  const { ran, flow } = make_flow();
  flow.set_matcher_(create_matcher(keymap));
  assert.equal(flow.handle_token_("x"), "pass");
  assert.equal(flow.handle_token_("j"), "cancel");
  assert.equal(flow.handle_token_("g"), "cancel");
  assert.equal(flow.handle_token_("x"), "pass");
  assert.equal(flow.handle_token_("x"), "pass");
  assert.equal(flow.handle_token_("3"), "cancel");
  assert.equal(flow.handle_token_("j"), "cancel");
  assert.deepEqual(ran, ["down", "down3"]);
});

test("a tree swap mid-sequence drops the sequence, and keys held at load replay against the new tree", () => {
  const { ran, flow } = make_flow();
  flow.set_matcher_(create_matcher(keymap));
  assert.equal(flow.handle_token_("g"), "cancel");
  const pruned = { ...keymap, modes: { ...keymap.modes, normal: prune_tree(keymap.modes.normal, { pass: [["g"]] }) } };
  flow.set_matcher_(create_matcher(pruned));
  assert.equal(flow.handle_token_("g"), "pass");
  const held = make_flow();
  assert.equal(held.flow.handle_token_("g"), "cancel");
  assert.equal(held.flow.handle_token_("j"), "cancel");
  held.flow.set_matcher_(create_matcher(pruned));
  assert.deepEqual([ran, held.ran], [[], ["down"]]);
});

test("a rule hands Quick Find keys and digits to the page", () => {
  const { ran, flow } = make_flow();
  const rule = { pass: [["/"], ["j"]] };
  const ruled = { ...keymap, modes: { ...keymap.modes, normal: prune_tree(keymap.modes.normal, rule) } };
  flow.set_matcher_(create_matcher(ruled, (token) => is_freed(frees_of(rule), token)));
  assert.equal(flow.handle_token_("/"), "pass");
  assert.equal(flow.handle_token_("j"), "pass");
  assert.equal(flow.handle_token_("'"), "cancel");
  const only = { only: [["g", "g"]] };
  const only_flow = make_flow();
  only_flow.flow.set_matcher_(create_matcher({ ...keymap, modes: { ...keymap.modes, normal: prune_tree(keymap.modes.normal, only) } }, (token) => is_freed(frees_of(only), token)));
  assert.equal(only_flow.flow.handle_token_("'"), "pass");
  assert.equal(only_flow.flow.handle_token_("4"), "pass");
  assert.equal(only_flow.flow.handle_token_("g"), "cancel");
  assert.equal(only_flow.flow.handle_token_("g"), "cancel");
  assert.deepEqual([ran, only_flow.ran], [[], ["top"]]);
});

test("key flow in ignore mode passes everything but the leaving binding", () => {
  const { state, ran, flow } = make_flow();
  flow.set_matcher_(create_matcher(keymap));
  state.set_mode_("ignore");
  assert.equal(flow.handle_token_("j"), "pass");
  assert.equal(flow.handle_token_("<S-Escape>"), "cancel");
  assert.deepEqual(ran, ["leave"]);
});

test("key flow in insert mode leaves on Escape and passes letters", () => {
  const { state, flow } = make_flow();
  flow.set_matcher_(create_matcher(keymap));
  state.set_mode_("insert");
  assert.equal(flow.handle_token_("j"), "pass");
  assert.equal(flow.handle_token_("<Escape>"), "pass");
  assert.equal(state.get_mode_(), "normal");
});

test("with escape_to_page, Escape in a field passes to the page and insert mode stays", () => {
  const { state, flow } = make_flow(true, true);
  flow.set_matcher_(create_matcher(keymap));
  state.focus_entered_editable_();
  assert.equal(flow.handle_token_("<Escape>"), "pass");
  assert.equal(state.get_mode_(), "insert");
  state.focus_left_editable_();
  assert.equal(state.get_mode_(), "normal");
});

test("with escape_to_page, Escape in a field cancels a pending insert sequence", () => {
  const { state, flow } = make_flow(true, true);
  const pending = { ...keymap, modes: { ...keymap.modes, insert: { kind: "branch" as const, children: { "<C-x>": { kind: "branch" as const, children: { j: leaf("insert_chord") } } } } } };
  flow.set_matcher_(create_matcher(pending));
  state.focus_entered_editable_();
  assert.equal(flow.handle_token_("<C-x>"), "cancel");
  assert.equal(flow.handle_token_("<Escape>"), "pass");
  assert.equal(state.get_mode_(), "insert");
  // The pending <C-x> is gone, so j is no longer its second key.
  assert.equal(flow.handle_token_("j"), "pass");
});

test("with escape_to_page, Escape in a manual insert with no field still leaves", () => {
  const { state, flow } = make_flow(false, true);
  flow.set_matcher_(create_matcher(keymap));
  state.set_mode_("insert");
  assert.equal(flow.handle_token_("<Escape>"), "pass");
  assert.equal(state.get_mode_(), "normal");
});

test("without escape_to_page, Escape in a field leaves insert mode", () => {
  const { state, flow } = make_flow(true, false);
  flow.set_matcher_(create_matcher(keymap));
  state.focus_entered_editable_();
  flow.handle_token_("<Escape>");
  assert.equal(state.get_mode_(), "normal");
});

test("pass_next passes one key that would match", () => {
  const { state, ran, flow } = make_flow();
  flow.set_matcher_(create_matcher(keymap));
  state.arm_pass_next_();
  assert.equal(flow.handle_token_("j"), "pass");
  assert.equal(flow.handle_token_("j"), "cancel");
  assert.deepEqual(ran, ["down"]);
});

test("a key that breaks a sequence is retried from the root", () => {
  const { ran, flow } = make_flow();
  flow.set_matcher_(create_matcher(keymap));
  assert.equal(flow.handle_token_("g"), "cancel");
  assert.equal(flow.handle_token_("j"), "cancel");
  assert.deepEqual(ran, ["down"]);
});

test("a mode change drops a pending sequence and count", () => {
  const { state, ran, flow } = make_flow();
  flow.set_matcher_(create_matcher(keymap));
  assert.equal(flow.handle_token_("g"), "cancel");
  state.set_mode_("insert");
  state.set_mode_("normal");
  assert.equal(flow.handle_token_("x"), "pass");
  assert.equal(flow.handle_token_("5"), "cancel");
  state.set_mode_("ignore");
  state.set_mode_("normal");
  assert.equal(flow.handle_token_("j"), "cancel");
  assert.deepEqual(ran, ["down"]);
});

test("an insert chord runs while a field is focused", () => {
  const { state, ran, flow } = make_flow(true);
  flow.set_matcher_(create_matcher(keymap), browser_chords);
  state.set_mode_("insert");
  assert.equal(flow.handle_token_("<C-x>"), "cancel");
  assert.deepEqual(ran, ["insert_chord"]);
});

test("browser chords run in normal and insert mode and are cancelled", () => {
  const { state, ran, flow } = make_flow();
  flow.set_matcher_(create_matcher(keymap), browser_chords);
  assert.equal(flow.handle_token_("<A-j>"), "cancel");
  state.set_mode_("insert");
  assert.equal(flow.handle_token_("<A-j>"), "cancel");
  // With no field focused, an insert chord is the browser's.
  assert.equal(flow.handle_token_("<C-x>"), "pass");
  state.set_mode_("ignore");
  assert.equal(flow.handle_token_("<A-j>"), "pass");
  assert.deepEqual(ran, ["next_tab", "next_tab"]);
});

test("startup holds keys and chords outside fields and, with no page callback, lets what matches nothing go", () => {
  const { ran, flow } = make_flow();
  assert.equal(flow.handle_token_("<A-j>"), "cancel");
  assert.equal(flow.handle_token_("x"), "cancel");
  assert.equal(flow.handle_token_("j"), "cancel");
  flow.set_matcher_(create_matcher(keymap));
  assert.deepEqual(ran, ["down"]);
  const in_field = make_flow(true);
  assert.equal(in_field.flow.handle_token_("j"), "pass");
});

test("Space reaches the page when nothing binds it", () => {
  const { ran, flow } = make_flow();
  flow.set_matcher_(create_matcher(keymap));
  assert.equal(flow.handle_token_("<Space>"), "pass");
  assert.deepEqual(ran, []);
});

test("startup replay uses the mode set before the keymap", () => {
  const { state, ran, flow } = make_flow();
  assert.equal(flow.handle_token_("j"), "cancel");
  state.set_mode_("ignore");
  flow.set_matcher_(create_matcher(keymap));
  assert.deepEqual(ran, []);
});

test("normal mode keeps only the unbound Quick Find keys from the page, outside fields", () => {
  assert.equal(cancels_unbound_key("normal", "/", false), true);
  assert.equal(cancels_unbound_key("normal", "'", false), true);
  assert.equal(cancels_unbound_key("normal", "'", true), false);
  for (const mode of ["insert", "ignore", "hint", "cmdline"] as const) assert.equal(cancels_unbound_key(mode, "/", false), false, mode);
  for (const token of ["<C-/>", "<A-'>", "x", "?", "<Space>"]) assert.equal(cancels_unbound_key("normal", token, false), false, token);
});

test("caret and both visual modes keep every unbound plain key from the page, outside fields", () => {
  for (const mode of ["caret", "visual", "visual_line"] as const) {
    for (const token of ["/", "'", "e", "E", "5", "<Space>", "<Enter>", "<S-Enter>", "<Backspace>"]) assert.equal(cancels_unbound_key(mode, token, false), true, `${mode} ${token}`);
    for (const token of ["<Tab>", "<S-Tab>", "<F5>", "<PageUp>", "<PageDown>", "<Home>", "<End>", "<S-End>", "<S-F12>", "<Escape>", "<S-Escape>", "<C-c>", "<A-x>", "<M-v>", "<CS-c>"]) assert.equal(cancels_unbound_key(mode, token, false), false, `${mode} ${token}`);
    assert.equal(cancels_unbound_key(mode, "e", true), false, mode);
  }
});

test("key flow in caret mode cancels an unbound letter and passes Tab and Ctrl+C", () => {
  const { state, flow } = make_flow();
  flow.set_matcher_(create_matcher(keymap));
  state.set_mode_("caret");
  assert.equal(flow.handle_token_("e"), "cancel");
  assert.equal(flow.handle_token_("<Tab>"), "pass");
  assert.equal(flow.handle_token_("<C-c>"), "pass");
});

test("key flow cancels an unbound Quick Find key and drops the sequence or count before it", () => {
  const { state, ran, flow } = make_flow();
  flow.set_matcher_(create_matcher(keymap));
  assert.equal(flow.handle_token_("'"), "cancel");
  assert.equal(flow.handle_token_("g"), "cancel");
  assert.equal(flow.handle_token_("'"), "cancel");
  assert.equal(flow.handle_token_("3"), "cancel");
  assert.equal(flow.handle_token_("/"), "cancel");
  assert.equal(flow.handle_token_("j"), "cancel");
  state.set_mode_("insert");
  assert.equal(flow.handle_token_("/"), "pass");
  assert.deepEqual(ran, ["down"]);
});

test("a bound Quick Find key runs its command", () => {
  const bound: CompiledKeymap = { ...keymap, modes: { ...keymap.modes, normal: { kind: "branch", children: { "/": leaf("find") } } } };
  const { ran, flow } = make_flow();
  flow.set_matcher_(create_matcher(bound));
  assert.equal(flow.handle_token_("2"), "cancel");
  assert.equal(flow.handle_token_("/"), "cancel");
  assert.deepEqual(ran, ["find2"]);
});

test("a held key the keymap does not bind goes back to the page on replay, and a bound one stays swallowed", () => {
  const { ran, flow } = make_flow();
  const to_page: string[] = [];
  for (const token of ["<Space>", "j", "x", "g", "<Tab>"]) assert.equal(flow.handle_token_(token, false, () => to_page.push(token)), "cancel");
  flow.set_matcher_(create_matcher(keymap));
  // g waits for a second key and is lost with the sequence that Tab breaks. Space, x and Tab reach the page in order.
  assert.deepEqual([to_page, ran], [["<Space>", "x", "<Tab>"], ["down"]]);
});

test("a held Quick Find key stays swallowed on replay while a plain key goes to the page", () => {
  const { flow } = make_flow();
  const to_page: string[] = [];
  flow.handle_token_("/", false, () => to_page.push("/"));
  flow.handle_token_("e", false, () => to_page.push("e"));
  flow.set_matcher_(create_matcher(keymap));
  assert.deepEqual(to_page, ["e"]);
});

test("keys handed back by the command line are replayed to the keymap but not to the page", () => {
  const { ran, flow } = make_flow();
  flow.hold_first_(["j", "x"]);
  flow.set_matcher_(create_matcher(keymap));
  assert.deepEqual(ran, ["down"]);
});

test("a held key replayed to the page clears its cancelled code, and the real keyup then reaches the page", () => {
  const keys = create_cancelled_keys();
  const press = { keyup_seen_: false };
  keys.saw_keydown_("Space");
  keys.record_keydown_("Space", "cancel", press);
  assert.equal(keys.release_for_replay_("Space", press), false);
  assert.equal(keys.cancels_keypress_("Space"), false);
  assert.equal(keys.take_keyup_("Space"), false);
});

test("a keyup that came before the replay was swallowed, so replay reports it and leaves no state", () => {
  const keys = create_cancelled_keys();
  const press = { keyup_seen_: false };
  keys.record_keydown_("Space", "cancel", press);
  assert.equal(keys.take_keyup_("Space"), true);
  assert.equal(keys.release_for_replay_("Space", press), true);
  assert.equal(keys.cancels_keypress_("Space"), false);
});

test("replaying an early press does not clear the code of a later press of the same key that is still down", () => {
  const keys = create_cancelled_keys();
  const first = { keyup_seen_: false };
  const second = { keyup_seen_: false };
  keys.record_keydown_("Space", "cancel", first);
  keys.take_keyup_("Space");
  keys.saw_keydown_("Space");
  keys.record_keydown_("Space", "cancel", second);
  assert.equal(keys.release_for_replay_("Space", first), true);
  assert.equal(keys.cancels_keypress_("Space"), true);
  assert.equal(keys.release_for_replay_("Space", second), false);
  assert.equal(keys.take_keyup_("Space"), false);
});

const key_fields = { key: " ", code: "Space", location: 0, repeat: false, keyCode: 32, ctrlKey: false, shiftKey: true, altKey: false, metaKey: false };

function make_target(isConnected = true) {
  const seen: { type: string; init: KeyboardEventInit }[] = [];
  return { seen, target: { isConnected, dispatchEvent: (event: Event) => (seen.push(event as unknown as { type: string; init: KeyboardEventInit }), true) } };
}
const make_event = (type: string, init: KeyboardEventInit) => ({ type, init }) as unknown as Event;

test("a replayed key goes to the target as a keydown with every field of the press", () => {
  const keys = create_cancelled_keys();
  const press = { keyup_seen_: false };
  keys.record_keydown_("Space", "cancel", press);
  const { seen, target } = make_target();
  replay_key_to_page(key_fields, target, press, keys, make_event);
  assert.deepEqual(seen.map((event) => event.type), ["keydown"]);
  assert.deepEqual(seen[0]!.init, { ...key_fields, bubbles: true, cancelable: true, composed: true });
});

test("a replayed key also gets a keyup when the real keyup was swallowed", () => {
  const keys = create_cancelled_keys();
  const press = { keyup_seen_: false };
  keys.record_keydown_("Space", "cancel", press);
  keys.take_keyup_("Space");
  const { seen, target } = make_target();
  replay_key_to_page(key_fields, target, press, keys, make_event);
  assert.deepEqual(seen.map((event) => event.type), ["keydown", "keyup"]);
});

test("a replayed key to an element that left the page sends nothing and still clears the cancelled code", () => {
  const keys = create_cancelled_keys();
  const press = { keyup_seen_: false };
  keys.record_keydown_("Space", "cancel", press);
  const { seen, target } = make_target(false);
  replay_key_to_page(key_fields, target, press, keys, make_event);
  assert.deepEqual(seen, []);
  assert.equal(keys.cancels_keypress_("Space"), false);
});

test("auto-repeat during the hold gives one keydown per press and a single keyup", () => {
  const keys = create_cancelled_keys();
  const presses = [{ keyup_seen_: false }, { keyup_seen_: false }, { keyup_seen_: false }];
  for (const press of presses) keys.record_keydown_("Space", "cancel", press);
  keys.take_keyup_("Space");
  const { seen, target } = make_target();
  for (const press of presses) replay_key_to_page(key_fields, target, press, keys, make_event);
  assert.deepEqual(seen.map((event) => event.type), ["keydown", "keydown", "keydown", "keyup"]);
});

test("the press target is the first element of the composed path, else the event target", () => {
  const host = {} as EventTarget;
  const inner = {} as EventTarget;
  assert.equal(press_target({ target: host, composedPath: () => [inner, host] }), inner);
  assert.equal(press_target({ target: host, composedPath: () => [] }), host);
});

test("keypress and keyup guards ignore untrusted events and leave the cancelled code alone", () => {
  const keys = create_cancelled_keys();
  keys.record_keydown_("Space", "cancel", { keyup_seen_: false });
  assert.equal(cancels_keypress({ isTrusted: false, code: "Space" }, keys), false);
  assert.equal(cancels_keyup({ isTrusted: false, code: "Space" }, keys), false);
  assert.equal(cancels_keypress({ isTrusted: true, code: "Space" }, keys), true);
  assert.equal(cancels_keyup({ isTrusted: true, code: "Space" }, keys), true);
  assert.equal(cancels_keypress({ isTrusted: true, code: "Space" }, keys), false);
});

test("a stale cancelled code does not eat a later typed letter", () => {
  const keys = create_cancelled_keys();
  keys.record_keydown_("KeyJ", "cancel");
  // The keyup went to another tab. Later the same key is typed into a field.
  keys.record_keydown_("KeyJ", "pass");
  assert.equal(keys.cancels_keypress_("KeyJ"), false);
  keys.record_keydown_("KeyK", "cancel");
  assert.equal(keys.cancels_keypress_("KeyK"), true);
  assert.equal(keys.take_keyup_("KeyK"), true);
});

test("a keyup whose keydown this frame never saw is cancelled, and never when the keydown was seen", () => {
  const keys = create_cancelled_keys();
  // The keydown went to another frame, which moved the focus here.
  assert.equal(cancels_keyup({ isTrusted: true, code: "Escape" }, keys), true);
  // A modifier makes no key token, so its keydown is never recorded as passed or cancelled. The page got it, and gets its keyup.
  keys.saw_keydown_("ShiftLeft");
  assert.equal(cancels_keyup({ isTrusted: true, code: "ShiftLeft" }, keys), false);
  keys.saw_keydown_("KeyA");
  keys.record_keydown_("KeyA", "pass");
  assert.equal(cancels_keyup({ isTrusted: true, code: "KeyA" }, keys), false);
  // Auto-repeat sends many keydowns and one keyup.
  for (let repeat = 0; repeat < 3; repeat++) keys.saw_keydown_("ArrowDown");
  assert.equal(cancels_keyup({ isTrusted: true, code: "ArrowDown" }, keys), false);
  assert.equal(cancels_keyup({ isTrusted: true, code: "ArrowDown" }, keys), true);
});

test("keys_off lets a lone keyup through, while a cancelled key still swallows its keyup and the seen code clears", () => {
  const keys = create_cancelled_keys();
  assert.equal(cancels_keyup({ isTrusted: true, code: "Escape" }, keys, true), false);
  keys.saw_keydown_("KeyJ");
  keys.record_keydown_("KeyJ", "cancel");
  assert.equal(cancels_keyup({ isTrusted: true, code: "KeyJ" }, keys, true), true);
  // The seen code cleared, so with keys on the next lone keyup is cancelled again.
  keys.saw_keydown_("KeyA");
  assert.equal(cancels_keyup({ isTrusted: true, code: "KeyA" }, keys, true), false);
  assert.equal(cancels_keyup({ isTrusted: true, code: "KeyA" }, keys, false), true);
});

test("a keydown whose keyup went to another frame lets the next keyup of that key through", () => {
  const keys = create_cancelled_keys();
  // Shift went down here and came up in another frame. The stale code errs towards the page: the next Shift keyup here passes, even one whose keydown was elsewhere.
  keys.saw_keydown_("ShiftLeft");
  keys.saw_keydown_("ShiftLeft");
  assert.equal(cancels_keyup({ isTrusted: true, code: "ShiftLeft" }, keys), false);
});

test("a keyup that a page or an extension made is never cancelled for a missing keydown", () => {
  const keys = create_cancelled_keys();
  assert.equal(cancels_keyup({ isTrusted: false, code: "Escape" }, keys), false);
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

// What the content script does with the compiled keymap: one regex against the page URL.
const is_ignored_site = (patterns: string[], url: string): boolean => {
  const source = match_regex_source(patterns);
  return source !== undefined && new RegExp(source).test(url);
};

test("the precompiled ignore regex agrees with matches_pattern on every pattern and URL", () => {
  const patterns = [
    "<all_urls>", "*://*/*", "*://*.docs.test/*", "https://a.test/*", "https://a.test/app/*", "https://a.test/app?x=*",
    "http://a.test/", "file:///*", "ftp://f.test/*", "https://a.test/a*b*c", "https://A.test/*", "not a pattern", "https://*/x",
    "https://*foo.com/*", "https://a*.test/*", "https://*.a*.test/*", "https://a.test:8080/*", "https://[::1]/*", "https://a.test/a#b", "https://a.test/*#*",
  ];
  const urls = [
    "https://a.test/", "https://a.test/x", "http://a.test/", "https://a.test:8080/app/x", "https://a.test/app?x=1", "https://a.test/app?y=1",
    "https://a.test/app#frag", "https://a.test/abc#c", "https://a.test/aXbYc", "https://a.docs.test/p?q=1", "http://docs.test/", "https://evildocs.test/",
    "https://evil.test/?x=@a.test/", "https://a.test@evil.test/", "https://user:pw@a.test/x", "https://b.test/x", "file:///tmp/x", "ftp://f.test/z",
    "about:blank", "about:srcdoc", "data:text/html,hi", "blob:https://a.test/uuid", "javascript:void(0)", "https://[::1]:3000/x", "https://xa.test/", "https://foo.com/", "https://xfoo.com/", "https://a.test:8080/x", "https://a.test/a#b", "https://a.test/a", "https://ab.test/",
  ];
  for (const pattern of patterns) {
    for (const url of urls) {
      assert.equal(is_ignored_site([pattern], url), matches_pattern(pattern, url), `${pattern} against ${url}`);
    }
  }
  assert.equal(is_ignored_site(patterns, "https://a.test/x"), true);
  for (const bad of ["https://*foo.com/*", "https://a*.test/*", "https://a.test:8080/*", "https://a.test/a#b"]) {
    assert.equal(match_regex_source([bad]), undefined, bad);
  }
  assert.equal(match_regex_source([]), undefined);
  assert.equal(match_regex_source(["not a pattern"]), undefined);
});

test("a frame on an ignored page is ignored by the tab address, and a broken regex ignores nothing", () => {
  const source = match_regex_source(["https://ignored.test/*"]);
  assert.equal(matches_any_address(source, ["https://embed.test/video", "https://ignored.test/page"]), true);
  assert.equal(matches_any_address(source, ["https://ignored.test/frame", undefined]), true);
  assert.equal(matches_any_address(source, ["https://embed.test/video", "https://other.test/"]), false);
  assert.equal(matches_any_address(undefined, ["https://ignored.test/page"]), false);
  assert.equal(matches_any_address("(", ["https://ignored.test/page"]), false);
});

test("a keymap stored in the old format is treated as absent until the background recompiles it", () => {
  const old_format = { format_version: 3, modes: {}, ignore_regex: "^https://a\\.test/$", mode_indicator: "always", which_key_delay_ms: 0 } as unknown as CompiledKeymap;
  assert.equal(current_keymap(old_format), undefined);
  assert.equal(current_keymap(undefined), undefined);
  const compiled = compile_keymap({}, { site_rules: [{ site: "https://a.test/*" }] }, () => undefined as never).compiled;
  assert.equal(current_keymap(compiled), compiled);
  assert.equal(compiled.format_version, COMPILED_KEYMAP_VERSION);
  assert.ok(new RegExp(compiled.site_rules?.[0]?.regex ?? "").test("https://a.test/z"));
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

test("editable rules: remove beats add, unsized limits remove, a bad selector is skipped", () => {
  class StubElement {
    tagName = "DIV";
    isContentEditable = false;
    offsetWidth = 100;
    id: string;
    constructor(id: string, props: Partial<StubElement> = {}) {
      this.id = id;
      Object.assign(this, props);
    }
    matches(selector: string): boolean {
      if (selector === "!!") throw new SyntaxError("bad selector");
      return selector === `#${this.id}`;
    }
  }
  Object.assign(globalThis, { HTMLElement: StubElement, HTMLInputElement: class {} });
  const editable = (element: StubElement) => is_editable_element(element as unknown as HTMLElement);
  const field = new StubElement("f", { isContentEditable: true });
  const plain = new StubElement("p");
  try {
    assert.ok(editable(field) && !editable(plain));
    set_editable_rules({ editable_remove: ["#f"] });
    assert.ok(!editable(field), "remove makes a contenteditable not editable");
    set_editable_rules({ editable_add: ["#p"] });
    assert.ok(editable(plain) && editable(field), "add makes a div editable");
    set_editable_rules({ editable_add: ["#f"], editable_remove: ["#f"] });
    assert.ok(!editable(field), "remove beats add");
    set_editable_rules({ editable_remove: ["#f"], editable_remove_unsized: true });
    assert.ok(editable(field), "a sized match is not removed with unsized");
    field.offsetWidth = 0;
    assert.ok(!editable(field), "a match with no width is removed with unsized");
    set_editable_rules({ editable_add: ["!!", "#p"], editable_remove: ["!!"] });
    assert.ok(editable(plain) && editable(field), "a selector that does not parse matches nothing");
    set_editable_rules(undefined);
    assert.ok(editable(field) && !editable(plain), "no rules restore the default");
  } finally {
    set_editable_rules(undefined);
    Reflect.deleteProperty(globalThis, "HTMLElement");
    Reflect.deleteProperty(globalThis, "HTMLInputElement");
  }
});

test("count rules", () => {
  const args = { a: 1 };
  assert.deepEqual(args_for_count(args, undefined, { param: "n" }), [args]);
  assert.deepEqual(args_for_count(args, 3, "ignore"), [args]);
  assert.equal(args_for_count(args, 3, "repeat").length, 3);
  assert.deepEqual(args_for_count(args, 3, { param: "n" }), [{ a: 1, n: 3 }]);
});

const area = (ref: string, can_scroll_x_: boolean, can_scroll_y_: boolean, size: number) => ({ ref, can_scroll_x_, can_scroll_y_, area: size });

test("scroll target order: focus chain, page, largest", () => {
  const pane = area("pane", false, true, 100);
  const page = area("page", false, true, 900);
  const big = area("big", false, true, 500);
  const small = area("small", false, true, 50);
  assert.equal(pick_scroll_target(undefined, [area("input", false, false, 5), pane], page, () => [], "y"), "pane");
  assert.equal(pick_scroll_target(undefined, [], page, () => [big], "y"), "page");
  assert.equal(pick_scroll_target(undefined, [], area("page", false, false, 900), () => [small, big], "y"), "big");
  assert.equal(pick_scroll_target(undefined, [], page, () => [big], "x"), undefined);
});

test("scroll target: the site selector wins, and falls through when it cannot scroll or is missing", () => {
  const page = area("page", false, true, 900);
  const pane = area("pane", false, true, 100);
  const site = area("site", false, true, 10);
  assert.equal(pick_scroll_target(site, [pane], page, () => [], "y"), "site");
  assert.equal(pick_scroll_target(area("site", true, false, 10), [pane], page, () => [], "y"), "pane");
  assert.equal(pick_scroll_target(area("site", true, false, 10), [], page, () => [], "y"), "page");
  assert.equal(pick_scroll_target(undefined, [pane], page, () => [], "y"), "pane");
});

test("percent offsets clamp", () => {
  assert.equal(percent_to_offset(100, 1000, 400), 600);
  assert.equal(percent_to_offset(50, 1000, 400), 300);
  assert.equal(percent_to_offset(-5, 1000, 400), 0);
  assert.equal(percent_to_offset(100, 300, 400), 0);
});

test("display listener fires on mode changes and on pass-next arming and use", () => {
  const state = create_mode_state();
  let fired = 0;
  state.listen_display_(() => fired++);
  state.arm_pass_next_();
  assert.equal(state.is_pass_next_armed_(), true);
  assert.equal(state.take_pass_next_(), true);
  assert.equal(state.take_pass_next_(), false);
  state.set_mode_("ignore");
  state.set_mode_("ignore");
  assert.equal(fired, 3);
});

test("the mode is reported at start and on every change", () => {
  const state = create_mode_state();
  const reports: string[] = [];
  wire_mode_reports(state, (mode) => reports.push(mode));
  state.set_mode_("ignore");
  assert.deepEqual(reports, ["normal", "ignore"]);
});

test("a document holds its own focus unless a child frame has it", () => {
  const doc = (has_focus: boolean, active: object | null) => ({ hasFocus: () => has_focus, activeElement: active }) as unknown as Document;
  assert.equal(holds_own_focus(doc(true, { localName: "body" })), true);
  assert.equal(holds_own_focus(doc(true, { localName: "div" })), true);
  assert.equal(holds_own_focus(doc(true, null)), true);
  assert.equal(holds_own_focus(doc(true, { localName: "iframe", contentWindow: {} })), false);
  assert.equal(holds_own_focus(doc(false, { localName: "body" })), false);
});

test("a key repeat reaches run_leaf_ as true, and a first press, a replayed key and a browser chord as false", () => {
  const { flow, ran } = make_flow();
  flow.set_matcher_(create_matcher(keymap), keymap.modes.browser);
  flow.handle_token_("j", true);
  flow.handle_token_("j");
  flow.handle_token_("<A-j>", true);
  assert.deepEqual(ran, ["down!", "down", "next_tab"]);
});
