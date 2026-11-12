import assert from "node:assert/strict";
import { test } from "node:test";
import { create_key_flow } from "../../src/content/key_flow.ts";
import { create_mode_state } from "../../src/content/mode_state.ts";
import { create_matcher } from "../../src/shared/keys/index.ts";
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

test("a chord typed before the keymap is read waits for it, then runs if bound and goes back to the page if not", () => {
  const { flow, ran, read_keymap } = make(false);
  const passed: string[] = [];
  assert.equal(flow.handle_token_("<C-o>", false, () => passed.push("<C-o>")), "cancel", "<C-o> must not reach Firefox's Open File");
  assert.equal(flow.handle_token_("<C-k>", false, () => passed.push("<C-k>")), "cancel");
  read_keymap();
  assert.deepEqual(ran, ["page.jump"]);
  assert.deepEqual(passed, ["<C-k>"]);
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
