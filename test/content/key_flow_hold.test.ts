import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CHORDS, create_key_flow } from "../../src/content/key_flow.ts";
import { create_mode_state } from "../../src/content/mode_state.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { parse_sequence } from "../../src/shared/keys/notation.ts";
import { create_matcher } from "../../src/shared/keys/index.ts";
import { is_chord } from "../../src/shared/keys/token.ts";
import { COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch, TreeLeaf } from "../../src/shared/prefix_tree.ts";

const leaf = (id: string, extra = {}): TreeLeaf => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "content", count_rule: "ignore", ...extra }] });

function make(with_keymap = true) {
  const ran: string[] = [];
  const state = create_mode_state();
  const flags = { loading: false };
  const flow = create_key_flow({
    get_mode_: state.get_mode_,
    take_pass_next_: state.take_pass_next_,
    in_editable_field_: () => false,
    escape_to_page_: () => false,
    is_loading_: () => flags.loading,
    loading_sink_bundles_: () => [],
    sink_of_: () => undefined,
    on_prefix_: () => {},
    leave_insert_: () => {},
    run_leaf_: (matched, _count, repeat) => void ran.push(`${matched.steps[0]!.invocation.id}${repeat ? " repeat" : ""}`),
  });
  const keymap: CompiledKeymap = { format_version: COMPILED_KEYMAP_VERSION, mode_indicator: "always", which_key_delay_ms: 0, modes: { normal: { kind: "branch", children: { G: leaf("scroll.to", { jump: true }), "<C-o>": leaf("page.jump") } } } };
  const browser_chords: TreeBranch = { kind: "branch", children: { "<C-t>": leaf("tab.new") } };
  const read_keymap = () => flow.set_matcher_(create_matcher(keymap), browser_chords);
  if (with_keymap) read_keymap();
  return { flow, ran, flags, read_keymap, state };
}

test("a held key replays with its repeat flag, so a queued auto-repeat of a jump key is a repeat", () => {
  const { flow, ran, flags } = make();
  flags.loading = true;
  assert.equal(flow.handle_token_("G", false), "cancel");
  assert.equal(flow.handle_token_("G", true), "cancel");
  flags.loading = false;
  flow.release();
  assert.deepEqual(ran, ["scroll.to", "scroll.to repeat"]);
});

test("a chord that only the browser chords bind waits behind a hold and runs after it, not in Firefox", () => {
  const { flow, ran, flags } = make();
  flags.loading = true;
  assert.equal(flow.handle_token_("<C-t>", false), "cancel");
  flags.loading = false;
  flow.release();
  assert.deepEqual(ran, ["tab.new"]);
});

test("a chord typed before the keymap is read waits if the default keymap binds it, and passes at once if not", () => {
  const { flow, ran, read_keymap } = make(false);
  assert.equal(flow.handle_token_("<C-o>", false, () => assert.fail("<C-o> must not go back to the page")), "cancel", "<C-o> must not reach Firefox's Open File");
  assert.equal(flow.handle_token_("<C-k>", false), "pass", "<C-k> is not a default chord");
  read_keymap();
  assert.deepEqual(ran, ["page.jump"]);
});

test("DEFAULT_CHORDS matches every normal-mode and browser chord of the default keymap and no other chord", () => {
  const bound = new Set<string>();
  for (const bindings of [DEFAULT_KEYMAP.normal, DEFAULT_KEYMAP.browser]) {
    for (const sequence of Object.keys(bindings ?? {})) for (const token of parse_sequence(sequence).tokens ?? []) if (is_chord(token)) bound.add(token);
  }
  for (const token of bound) assert.ok(DEFAULT_CHORDS.test(token), `${token} is bound in normal mode or the browser table but DEFAULT_CHORDS misses it`);
  const keys = [..."abcdefghijklmnopqrstuvwxyz0123456789,.[]/;'-=\\`", "Space", "Escape", "Enter", "Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "Backspace", "F5"];
  for (const mods of ["C", "A", "M", "CS", "AS", "AC"]) {
    for (const key of keys) {
      const token = `<${mods}-${key}>`;
      if (DEFAULT_CHORDS.test(token)) assert.ok(bound.has(token), `${token} matches DEFAULT_CHORDS but normal mode and the browser table do not bind it`);
    }
  }
});

test("a browser chord typed during a load in a mode where browser chords do not run goes to Firefox", () => {
  const { flow, ran, flags, state } = make();
  state.set_mode_("caret");
  flags.loading = true;
  assert.equal(flow.handle_token_("<C-t>", false), "pass");
  flags.loading = false;
  flow.release();
  assert.deepEqual(ran, []);
});
