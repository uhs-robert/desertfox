// The one-shot normal prefix (`mode.normal_once` on <A-o>): the next whole sequence reads as normal mode in every mode, and Escape or the prefix again only drops it.

import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import { create_key_flow } from "../../src/content/key_flow.ts";
import { create_mode_state } from "../../src/content/mode_state.ts";
import type { Sink } from "../../src/content/bundle_host.ts";
import type { Mode, TreeLeaf } from "../../src/shared/index.ts";
import { create_matcher } from "../../src/shared/keys/index.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const PREFIX = "<A-o>";
const { compiled } = compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });

// The command a key runs in the compiled normal tree.
const normal_id = (...keys: string[]): string => {
  let node = compiled.modes.normal!.children[keys[0]!]!;
  for (const key of keys.slice(1)) node = (node as { children: Record<string, TreeLeaf> }).children[key]!;
  return (node as TreeLeaf).steps[0]!.invocation.id;
};

function make_flow(mode: Mode, options: { in_field?: boolean } = {}) {
  const state = create_mode_state();
  const ran: { id: string; count: number | undefined; mode: Mode }[] = [];
  const sink_tokens: string[] = [];
  const flags = { loading: false, in_field: options.in_field ?? false };
  // A sink that takes every key, as the hint, caret and command line sinks do.
  const greedy_sink: Sink = { exit: () => {}, on_token_: (token) => (sink_tokens.push(token), "handled") };
  const flow = create_key_flow({
    user_input_seen_: () => true,
    blur_window_open_: () => false,
    // As content main.ts: the armed prefix reads the keys as normal ones, in a field too.
    in_editable_field_: () => !state.is_once_armed_() && flags.in_field,
    escape_to_page_: () => false,
    get_mode_: state.key_mode_,
    take_pass_next_: state.take_pass_next_,
    take_once_: state.take_once_,
    run_leaf_: (leaf: TreeLeaf, count) => {
      const id = leaf.steps[0]!.invocation.id;
      ran.push({ id, count, mode: state.get_mode_() });
      if (id === "mode.normal_once") state.arm_once_();
    },
    leave_insert_: () => state.escape(),
    is_loading_: () => flags.loading,
    loading_sink_bundles_: () => [],
    sink_of_: (current) => (["hint", "cmdline", "caret", "visual", "visual_line"].includes(current) ? greedy_sink : undefined),
    on_prefix_: () => {},
  });
  flow.set_matcher_(create_matcher(compiled), compiled.modes.browser);
  state.listen(() => flow.reset_sequence_());
  state.set_mode_(mode);
  const ids = () => ran.map((entry) => entry.id);
  return { flow, state, ran, ids, sink_tokens, flags };
}

test("the compile marks the prefix chord as any-mode and no other browser chord", () => {
  const browser = compiled.modes.browser!.children;
  assert.equal((browser[PREFIX] as TreeLeaf).any_mode, true);
  for (const key of ["<A-j>", "<A-k>", "<A-,>", "<A-l>"]) assert.equal((browser[key] as TreeLeaf).any_mode, undefined, key);
});

for (const mode of ["insert", "visual", "caret", "item", "ignore", "media"] as const) {
  test(`in ${mode} mode the prefix then j runs normal j once and the frame stays in ${mode} mode`, () => {
    const { flow, state, ran, ids } = make_flow(mode, { in_field: mode === "insert" });
    assert.equal(flow.handle_token_(PREFIX), "cancel");
    assert.equal(state.is_once_armed_(), true);
    assert.equal(state.key_mode_(), "normal");
    assert.equal(flow.handle_token_("j"), "cancel");
    assert.equal(ids()[1], normal_id("j"));
    assert.equal(ran[1]!.mode, mode, "the leaf ran with the frame still in its own mode");
    assert.equal(state.is_once_armed_(), false);
    assert.equal(state.get_mode_(), mode);
  });
}

test("a count and a two-key sequence are one command", () => {
  const { flow, state, ran, ids } = make_flow("insert", { in_field: true });
  flow.handle_token_(PREFIX);
  flow.handle_token_("5");
  assert.equal(state.is_once_armed_(), true, "a count keeps the prefix");
  flow.handle_token_("j");
  assert.equal(ran[1]!.count, 5);
  assert.equal(state.is_once_armed_(), false);
  flow.handle_token_(PREFIX);
  flow.handle_token_("g");
  assert.equal(state.is_once_armed_(), true, "a half-typed sequence keeps the prefix");
  flow.handle_token_("g");
  assert.equal(ids().at(-1), normal_id("g", "g"));
  assert.equal(state.is_once_armed_(), false);
});

test("a key that binds nothing in normal mode ends the prefix and goes nowhere, and the next key reads the frame's own mode", () => {
  for (const [mode, in_field] of [["insert", true], ["ignore", false]] as const) {
    const { flow, state } = make_flow(mode, { in_field });
    flow.handle_token_(PREFIX);
    assert.equal(flow.handle_token_("Q"), "cancel", `${mode}: Q neither types nor reaches the page`);
    assert.equal(state.is_once_armed_(), false);
  }
  const { flow, state, ids } = make_flow("insert", { in_field: true });
  flow.handle_token_(PREFIX);
  assert.equal(flow.handle_token_("<F13>"), "cancel");
  assert.equal(state.is_once_armed_(), false);
  assert.equal(flow.handle_token_("j"), "pass", "j is typing again");
  assert.deepEqual(ids(), ["mode.normal_once"]);
});

for (const cancel of ["<Escape>", "<C-[>", PREFIX]) {
  test(`${cancel} while armed only drops the prefix, and the mode stays`, () => {
    const { flow, state, ids, sink_tokens } = make_flow("visual");
    flow.handle_token_(PREFIX);
    assert.equal(flow.handle_token_(cancel), "cancel");
    assert.equal(state.is_once_armed_(), false);
    assert.equal(state.get_mode_(), "visual");
    assert.deepEqual(ids(), ["mode.normal_once"]);
    assert.deepEqual(sink_tokens, [], "the sink never saw either key");
  });
}

test("in hint mode the prefix ends the hint session first, then the keys read as normal mode", () => {
  const { flow, state, ids, sink_tokens } = make_flow("normal");
  state.set_mode_("hint");
  flow.handle_token_(PREFIX);
  assert.equal(state.get_mode_(), "normal", "hint mode went back to where it began");
  assert.equal(state.is_once_armed_(), true, "the end of the hint session did not drop the prefix");
  flow.handle_token_("j");
  assert.deepEqual(sink_tokens, []);
  assert.equal(ids().length, 2);
});

test("in caret and visual mode the sink steps aside for the armed sequence", () => {
  const { flow, ids, sink_tokens } = make_flow("caret");
  flow.handle_token_(PREFIX);
  flow.handle_token_("j");
  assert.deepEqual(sink_tokens, []);
  assert.equal(ids().length, 2);
  flow.handle_token_("j");
  assert.deepEqual(sink_tokens, ["j"], "the next key is the sink's again");
});

test("another browser chord while armed runs as the one command", () => {
  const { flow, state, ids } = make_flow("insert", { in_field: true });
  flow.handle_token_(PREFIX);
  flow.handle_token_("<A-j>");
  assert.deepEqual(ids(), ["mode.normal_once", "tab.next"]);
  assert.equal(state.is_once_armed_(), false);
});

test("the other browser chords still go to the sink in hint and caret mode", () => {
  for (const mode of ["hint", "caret"] as const) {
    const { flow, ids, sink_tokens } = make_flow(mode);
    flow.handle_token_("<A-j>");
    assert.deepEqual(ids(), [], mode);
    assert.deepEqual(sink_tokens, ["<A-j>"], mode);
  }
});

test("a blur or pagehide (end_hold_) drops the prefix, so the arm never follows the focus to another frame or tab", () => {
  const { flow, state } = make_flow("insert", { in_field: true });
  flow.handle_token_(PREFIX);
  flow.end_hold_();
  assert.equal(state.is_once_armed_(), false);
  assert.equal(flow.handle_token_("j"), "pass", "j types in the field");
});

test("a mode change while armed drops the prefix", () => {
  const { flow, state } = make_flow("visual");
  flow.handle_token_(PREFIX);
  state.set_mode_("normal");
  assert.equal(state.get_mode_(), "normal");
  assert.equal(state.is_once_armed_(), false);
});

test("keys typed after the prefix while a bundle loads wait and replay as normal keys, even in a field", () => {
  const { flow, state, ids, flags } = make_flow("insert", { in_field: true });
  flags.loading = true;
  assert.equal(flow.handle_token_(PREFIX), "cancel");
  assert.equal(flow.handle_token_("j", false, () => assert.fail("j must not go back to the page")), "cancel", "j waits behind the held prefix and does not reach the field");
  flags.loading = false;
  flow.release();
  assert.deepEqual(ids(), ["mode.normal_once", normal_id("j")]);
  assert.equal(state.get_mode_(), "insert");
  assert.equal(state.is_once_armed_(), false);
});

test("the prefix and the keys after it in a field wait for the first keymap read, then run as normal keys", () => {
  const state = create_mode_state("insert");
  const ran: string[] = [];
  const flow = create_key_flow({
    user_input_seen_: () => true,
    blur_window_open_: () => false,
    in_editable_field_: () => !state.is_once_armed_(),
    escape_to_page_: () => false,
    get_mode_: state.key_mode_,
    take_pass_next_: state.take_pass_next_,
    take_once_: state.take_once_,
    run_leaf_: (leaf) => {
      const id = leaf.steps[0]!.invocation.id;
      ran.push(id);
      if (id === "mode.normal_once") state.arm_once_();
    },
    leave_insert_: () => {},
    is_loading_: () => false,
    loading_sink_bundles_: () => [],
    sink_of_: () => undefined,
    on_prefix_: () => {},
  });
  assert.equal(flow.handle_token_(PREFIX, false, () => assert.fail("the prefix must not reach the page")), "cancel");
  assert.equal(flow.handle_token_("G", false, () => assert.fail("G must not type in the field")), "cancel");
  flow.set_matcher_(create_matcher(compiled), compiled.modes.browser);
  assert.deepEqual(ran, ["mode.normal_once", normal_id("G")]);
  assert.equal(state.get_mode_(), "insert");
});

test("without a held prefix, a key in a field still passes at once during a load", () => {
  const { flow, flags } = make_flow("insert", { in_field: true });
  flags.loading = true;
  assert.equal(flow.handle_token_("j"), "pass");
});

test("the mode state arms one flag at a time and tells the badge on each change", () => {
  const state = create_mode_state("insert");
  let shown = 0;
  state.listen_display_(() => void shown++);
  state.arm_pass_next_();
  state.arm_once_();
  assert.equal(state.is_pass_next_armed_(), false, "the prefix drops a pending pass-next");
  assert.equal(state.is_once_armed_(), true);
  assert.equal(state.key_mode_(), "normal");
  assert.equal(state.get_mode_(), "insert");
  assert.equal(state.take_pass_next_(), false);
  assert.equal(state.take_once_(), true);
  assert.equal(state.take_once_(), false);
  assert.equal(state.key_mode_(), "insert");
  assert.equal(shown, 3);
});
