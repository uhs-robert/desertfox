import assert from "node:assert/strict";
import { test } from "node:test";
import { create_key_flow } from "../../src/content/key_flow.ts";
import type { PendingPrefix } from "../../src/content/key_flow.ts";
import { create_mode_state } from "../../src/content/mode_state.ts";
import { create_which_key_timer } from "../../src/content/which_key_timer.ts";
import { create_matcher } from "../../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeNode } from "../../src/shared/prefix_tree.ts";

const DELAY_MS = 30;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const leaf = (id: string): TreeNode => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "content", count_rule: "ignore" }] });

const keymap: CompiledKeymap = {
  format_version: COMPILED_KEYMAP_VERSION,
  ignore_sites: [],
  mode_indicator: "always",
  which_key_delay_ms: DELAY_MS,
  modes: {
    normal: { kind: "branch", children: { j: leaf("down"), g: { kind: "branch", children: { g: leaf("top"), x: { kind: "branch", children: { x: leaf("close") } } } } } },
    caret: { kind: "branch", children: { g: { kind: "branch", children: { g: leaf("start") } } } },
  },
};

// The wiring main.ts does: key flow, timer, and a mode change that resets the sequence.
function make_page(delay_ms: number | undefined) {
  const state = create_mode_state();
  const shown: string[] = [];
  const hidden: boolean[] = [];
  let panel_up = false;
  const follow_prefix = create_which_key_timer(
    () => delay_ms,
    (prefix: PendingPrefix | undefined, is_current) => {
      if (!prefix) return void (panel_up && (hidden.push(true), (panel_up = false)));
      // The bundle answers later, like the background does.
      void Promise.resolve().then(() => {
        if (!is_current()) return;
        shown.push(`${prefix.mode}:${prefix.typed.join("")}`);
        panel_up = true;
      });
    },
  );
  const flow = create_key_flow({
    get_mode: state.get_mode,
    take_pass_next: state.take_pass_next,
    in_editable_field: () => false,
    is_loading: () => false,
    sink_of: () => undefined,
    leave_insert: () => state.escape(),
    run_leaf: () => {},
    on_prefix: follow_prefix,
  });
  state.listen(() => flow.reset_sequence());
  flow.set_matcher(create_matcher(keymap));
  return { state, flow, shown, hidden, is_up: () => panel_up };
}

test("a prefix key starts the timer and the panel shows after the delay", async () => {
  const page = make_page(DELAY_MS);
  page.flow.handle_token("g");
  assert.deepEqual(page.shown, []);
  await sleep(DELAY_MS + 40);
  assert.deepEqual(page.shown, ["normal:g"]);
});

test("the next key cancels the timer before it fires", async () => {
  const page = make_page(DELAY_MS);
  page.flow.handle_token("g");
  await sleep(DELAY_MS / 2);
  page.flow.handle_token("g");
  await sleep(DELAY_MS + 40);
  assert.deepEqual(page.shown, []);
});

test("the next key hides a panel that is up, and a longer prefix shows again after a new pause", async () => {
  const page = make_page(DELAY_MS);
  page.flow.handle_token("g");
  await sleep(DELAY_MS + 40);
  assert.equal(page.is_up(), true);
  page.flow.handle_token("x");
  assert.equal(page.is_up(), false);
  await sleep(DELAY_MS + 40);
  assert.deepEqual(page.shown, ["normal:g", "normal:gx"]);
});

test("a mode change cancels the timer", async () => {
  const page = make_page(DELAY_MS);
  page.flow.handle_token("g");
  page.state.set_mode("ignore");
  await sleep(DELAY_MS + 40);
  assert.deepEqual(page.shown, []);
});

test("a mode change hides a panel that is up", async () => {
  const page = make_page(DELAY_MS);
  page.flow.handle_token("g");
  await sleep(DELAY_MS + 40);
  page.state.set_mode("caret");
  assert.equal(page.is_up(), false);
});

test("a key that is not a prefix, or a bare count, starts no timer", async () => {
  const page = make_page(DELAY_MS);
  page.flow.handle_token("j");
  page.flow.handle_token("3");
  await sleep(DELAY_MS + 40);
  assert.deepEqual(page.shown, []);
});

test("a delay of zero or none turns which-key off", async () => {
  for (const delay of [0, undefined] as const) {
    const page = make_page(delay);
    page.flow.handle_token("g");
    await sleep(DELAY_MS + 40);
    assert.deepEqual(page.shown, []);
  }
});

test("an answer that arrives after the next key finds its prefix no longer current", () => {
  const asked: (() => boolean)[] = [];
  const follow = create_which_key_timer(() => 1, (prefix, is_current) => void (prefix && asked.push(is_current)));
  follow({ mode: "normal", typed: ["g"] });
  return sleep(10).then(() => {
    assert.equal(asked[0]?.(), true);
    follow(undefined);
    assert.equal(asked[0]?.(), false);
  });
});

test("Backspace drops the last key of the prefix and shows the parent group", async () => {
  const page = make_page(DELAY_MS);
  page.flow.handle_token("g");
  page.flow.handle_token("x");
  await sleep(DELAY_MS + 40);
  assert.equal(page.flow.handle_token("<Backspace>"), "cancel");
  assert.equal(page.is_up(), false);
  await sleep(DELAY_MS + 40);
  assert.deepEqual(page.shown, ["normal:gx", "normal:g"]);
  // The shorter prefix is live: `g` completes `gg`.
  assert.equal(page.flow.handle_token("g"), "cancel");
});

test("Backspace at the first level closes the panel and clears the prefix", async () => {
  const page = make_page(DELAY_MS);
  page.flow.handle_token("g");
  await sleep(DELAY_MS + 40);
  assert.equal(page.is_up(), true);
  assert.equal(page.flow.handle_token("<Backspace>"), "cancel");
  assert.equal(page.is_up(), false);
  await sleep(DELAY_MS + 40);
  assert.deepEqual(page.shown, ["normal:g"]);
  // No prefix is left: `x` alone is not the group's `x`, so it is not matched here.
  assert.equal(page.flow.handle_token("x"), "pass");
});

test("Escape closes the panel and clears the prefix at any depth", async () => {
  const page = make_page(DELAY_MS);
  page.flow.handle_token("g");
  page.flow.handle_token("x");
  await sleep(DELAY_MS + 40);
  assert.equal(page.is_up(), true);
  page.flow.handle_token("<Escape>");
  assert.equal(page.is_up(), false);
  assert.equal(page.flow.handle_token("x"), "pass");
});

test("Backspace with no prefix pending goes to the page", () => {
  const page = make_page(DELAY_MS);
  assert.equal(page.flow.handle_token("<Backspace>"), "pass");
});
