// Escape while a key argument is awaited (the target of `f`, the name of a mark, a macro register, `"<reg>`) drops the argument and nothing else. The mode stays, and the next Escape does what Escape does.

import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { create_key_flow } from "../../src/content/key_flow.ts";
import { create_mode_state } from "../../src/content/mode_state.ts";
import type { Mode } from "../../src/shared/index.ts";
import { create_matcher } from "../../src/shared/keys/index.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const { compiled } = compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });

function make_flow(mode: Mode) {
  const state = create_mode_state();
  const ran: string[] = [];
  const sink_tokens: string[] = [];
  const flow = create_key_flow({
    in_editable_field_: () => false,
    escape_to_page_: () => false,
    get_mode_: state.get_mode_,
    take_pass_next_: state.take_pass_next_,
    run_leaf_: (leaf) => {
      const id = leaf.steps[0]!.invocation.id;
      ran.push(id);
      if (id === "mode.escape") state.escape();
    },
    leave_insert_: () => state.escape(),
    is_loading_: () => false,
    loading_sink_bundles_: () => [],
    // The caret bundle's sink: a visual mode takes Escape and goes back to caret mode.
    sink_of_: (current) =>
      current === "visual" || current === "visual_line"
        ? {
            enter: () => {},
            exit: () => {},
            on_token_: (token) => {
              sink_tokens.push(token);
              if (token !== "<Escape>") return "pass";
              state.set_mode_("caret");
              return "handled";
            },
          }
        : undefined,
    on_prefix_: () => {},
  });
  flow.set_matcher_(create_matcher(compiled));
  state.set_mode_(mode);
  return { flow, state, ran, sink_tokens };
}

const arguments_in: Array<[Mode, string[]]> = [
  ["normal", ["m", "'", "q", "@", '"']],
  ["caret", ["f", "t", "F", "T", '"']],
  ["visual", ["f", "t", "F", "T", '"']],
  ["visual_line", ["f", '"']],
];

for (const [mode, prefixes] of arguments_in) {
  for (const prefix of prefixes) {
    for (const escape of ["<Escape>", "<C-[>"]) {
      test(`${escape} after ${prefix} in ${mode} mode drops the argument and keeps the mode`, () => {
        const { flow, state, ran, sink_tokens } = make_flow(mode);
        for (const key of prefix) assert.equal(flow.handle_token_(key), "cancel");
        assert.equal(flow.handle_token_(escape), "cancel");
        assert.equal(state.get_mode_(), mode);
        assert.deepEqual(ran, []);
        assert.equal(sink_tokens.some((token) => token === "<Escape>" || token === "<C-[>"), false, "the sink never saw the Escape");
        // The sequence is gone: the next key is a first key, not the argument.
        flow.handle_token_("j");
        assert.equal(ran.length, 1, "j ran as a motion key");
      });
    }
  }
}

test("a second Escape does what Escape does: normal mode runs its binding, a visual mode goes back to caret mode, caret mode runs mode.escape", () => {
  for (const [mode, expected_mode] of [["visual", "caret"], ["visual_line", "caret"], ["caret", "normal"]] as const) {
    const { flow, state, ran } = make_flow(mode);
    flow.handle_token_("f");
    flow.handle_token_("<Escape>");
    assert.equal(state.get_mode_(), mode);
    flow.handle_token_("<Escape>");
    assert.equal(state.get_mode_(), expected_mode, mode);
    assert.equal(ran.at(-1), mode === "caret" ? "mode.escape" : undefined);
  }
  const { flow, ran } = make_flow("normal");
  flow.handle_token_("m");
  flow.handle_token_("<Escape>");
  assert.deepEqual(ran, []);
  flow.handle_token_("<Escape>");
  assert.deepEqual(ran, ["mode.escape"]);
});

test("Escape with no argument pending still runs Escape: after a prefix that waits for a key of the tree, and after a bare count", () => {
  const { flow, ran } = make_flow("normal");
  flow.handle_token_("g");
  flow.handle_token_("<Escape>");
  assert.equal(ran.at(-1), "mode.escape");
  flow.handle_token_("3");
  flow.handle_token_("<Escape>");
  assert.equal(ran.length, 2);
  assert.equal(ran.at(-1), "mode.escape");
});

test("Escape after a count and an argument prefix drops both", () => {
  const { flow, ran } = make_flow("caret");
  flow.handle_token_("3");
  flow.handle_token_("f");
  assert.equal(flow.handle_token_("<Escape>"), "cancel");
  assert.deepEqual(ran, []);
  flow.handle_token_("x");
  assert.equal(ran.length, 0, "x is no target and no binding, so nothing runs with a stale count");
});

test("a target typed after the Escape starts a fresh sequence", () => {
  const { flow, ran } = make_flow("normal");
  flow.handle_token_("m");
  flow.handle_token_("<Escape>");
  flow.handle_token_("a");
  assert.deepEqual(ran, [], "a is no binding in normal mode, so it sets no mark");
});

test("insert mode Escape is unchanged", () => {
  const { flow, state } = make_flow("insert");
  flow.handle_token_("<Escape>");
  assert.equal(state.get_mode_(), "normal");
});
