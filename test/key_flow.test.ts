// The hold in the key flow: Space in a group keeps it open. These cases drive its lifecycle: leaving by Escape, a key outside, a second Space, Backspace, a mode change and a lost focus.
import assert from "node:assert/strict";
import { test } from "node:test";
import { create_key_flow } from "../src/content/key_flow.ts";
import type { PendingPrefix } from "../src/content/key_flow.ts";
import { create_mode_state } from "../src/content/mode_state.ts";
import { compile_keymap, create_matcher } from "../src/shared/keys/index.ts";
import { merge_keymaps, default_layer_of } from "../src/background/keymap_merge.ts";
import type { KeymapConfig } from "../src/shared/index.ts";

const KEYMAP: KeymapConfig = { normal: { tgx: { id: "deep" }, ti: { id: "t.i" }, zi: { id: "zoom.in" }, zo: { id: "zoom.out" }, J: { id: "tab.next" }, i: { id: "mode.insert" }, "<Escape>": { id: "esc" } } };

function make_hold_flow(on_leaf?: (id: string, state: ReturnType<typeof create_mode_state>) => void) {
  const state = create_mode_state();
  const ran: string[] = [];
  const panels: (PendingPrefix | undefined)[] = [];
  const flow = create_key_flow({
    in_editable_field_: () => false,
    escape_to_page_: () => false,
    get_mode_: state.get_mode_,
    take_pass_next_: state.take_pass_next_,
    run_leaf_: (leaf) => void (ran.push(String(leaf.steps[0]?.invocation.id)), on_leaf?.(String(leaf.steps[0]?.invocation.id), state)),
    leave_insert_: () => state.escape(),
    is_loading_: () => false,
    loading_sink_bundles_: () => [],
    sink_of_: () => undefined,
    on_prefix_: (prefix) => void panels.push(prefix),
  });
  state.listen(() => flow.reset_sequence_());
  const { compiled } = compile_keymap(merge_keymaps(KEYMAP, {}), {}, () => ({ ok: true }) as never, undefined, default_layer_of(KEYMAP, {}));
  flow.set_matcher_(create_matcher(compiled));
  return { state, ran, panels, flow, matcher: create_matcher(compiled), type: (...tokens: string[]) => tokens.map((token) => flow.handle_token_(token)) };
}

test("Space opens the panel at once and each leaf runs with the panel kept", () => {
  const { ran, panels, type } = make_hold_flow();
  assert.deepEqual(type("z", "<Space>", "i", "i", "o"), ["cancel", "cancel", "cancel", "cancel", "cancel"]);
  assert.deepEqual(ran, ["zoom.in", "zoom.in", "zoom.out"]);
  assert.deepEqual(panels.at(-1), { mode: "normal", typed_: ["z"], held_: true });
  assert.equal(panels.filter((panel) => panel === undefined).length, 1, "no hide between the leaves");
});

test("Escape leaves the hold, and the next key starts from the root", () => {
  const { ran, panels, type } = make_hold_flow();
  type("z", "<Space>", "i", "<Escape>");
  assert.equal(panels.at(-1), undefined);
  type("i");
  assert.deepEqual(ran, ["zoom.in", "esc", "mode.insert"]);
});

test("a key outside the group ends the hold and runs as a first key", () => {
  const { ran, panels, type } = make_hold_flow();
  type("z", "<Space>", "J", "o");
  assert.deepEqual(ran, ["tab.next"]);
  assert.equal(panels.at(-1), undefined);
});

test("a second Space ends the hold and the page does not scroll", () => {
  const { panels, flow, type } = make_hold_flow();
  type("z", "<Space>");
  assert.equal(flow.handle_token_("<Space>"), "cancel");
  assert.equal(panels.at(-1), undefined);
  assert.equal(flow.handle_token_("<Space>"), "pass");
});

test("Backspace in a hold ends the hold and keeps the group", () => {
  const { ran, panels, type } = make_hold_flow();
  type("z", "<Space>", "i", "<Backspace>");
  assert.deepEqual(panels.at(-1), { mode: "normal", typed_: ["z"] });
  type("o");
  assert.deepEqual(ran, ["zoom.in", "zoom.out"]);
  type("o");
  assert.deepEqual(ran, ["zoom.in", "zoom.out"], "the group closed after one leaf");
});

test("a mode change ends the hold, so the next normal key does not land in the old group", () => {
  const { state, ran, type } = make_hold_flow();
  type("z", "<Space>", "i");
  state.set_mode_("hint");
  state.set_mode_("normal");
  type("o");
  assert.deepEqual(ran, ["zoom.in"]);
});

test("losing the focus to another frame ends the hold", () => {
  const { ran, panels, flow, type } = make_hold_flow();
  type("z", "<Space>");
  flow.end_hold_();
  assert.equal(panels.at(-1), undefined);
  type("i");
  assert.deepEqual(ran, ["mode.insert"]);
});

test("a lost focus with no hold leaves a half-typed sequence alone", () => {
  const { ran, flow, type } = make_hold_flow();
  type("z");
  flow.end_hold_();
  type("i");
  assert.deepEqual(ran, ["zoom.in"]);
});

test("a mode change inside run_leaf_ ends the hold and shows no panel again", () => {
  const { ran, panels, type } = make_hold_flow((id, state) => id === "zoom.in" && state.set_mode_("hint"));
  type("z", "<Space>", "i");
  assert.equal(panels.at(-1), undefined);
  type("o");
  assert.deepEqual(ran, ["zoom.in"]);
});

test("a second Space inside a nested group of a hold ends the hold", () => {
  const { flow, panels, type } = make_hold_flow();
  type("t", "<Space>", "g");
  assert.equal(flow.handle_token_("<Space>"), "cancel");
  assert.equal(panels.at(-1), undefined);
});

test("Backspace in a nested group of a hold keeps the outer group and no hold", () => {
  const { ran, panels, type } = make_hold_flow();
  type("t", "<Space>", "g", "<Backspace>");
  assert.deepEqual(panels.at(-1), { mode: "normal", typed_: ["t"] });
  type("i", "i");
  assert.deepEqual(ran, ["t.i", "mode.insert"], "the group closed after one leaf");
});

test("the auto-repeat of the Space that opened a hold does not end it", () => {
  const { ran, flow, type } = make_hold_flow();
  type("z", "<Space>");
  assert.equal(flow.handle_token_("<Space>", true), "cancel");
  type("i");
  assert.deepEqual(ran, ["zoom.in"]);
});

test("a typed count shows in the pending prefix, bare or with keys, and the hold keeps its group", () => {
  const { panels, type } = make_hold_flow();
  type("3");
  assert.deepEqual(panels.at(-1), { mode: "normal", typed_: [], count_: 3 });
  type("z");
  assert.deepEqual(panels.at(-1), { mode: "normal", typed_: ["z"], count_: 3 });
  type("<Escape>", "z", "<Space>");
  assert.deepEqual(panels.at(-1), { mode: "normal", typed_: ["z"], held_: true });
});
