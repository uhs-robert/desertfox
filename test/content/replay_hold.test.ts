// The page side of a macro replay: the key hold that lasts the whole replay, the hint pick that takes keys through it, and the drop of held keys when the replay fails.
import assert from "node:assert/strict";
import { test } from "node:test";
import { create_bundle_host } from "../../src/content/bundle_host.ts";
import type { Sink } from "../../src/content/bundle_host.ts";
import { create_key_flow } from "../../src/content/key_flow.ts";
import { create_mode_state } from "../../src/content/mode_state.ts";
import { create_matcher } from "../../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_VERSION } from "../../src/shared/index.ts";
import type { CompiledKeymap, Mode, TreeNode } from "../../src/shared/index.ts";

const leaf = (id: string): TreeNode => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "content", count_rule: "ignore" }] });

const keymap: CompiledKeymap = {
  format_version: COMPILED_KEYMAP_VERSION,
  mode_indicator: "always",
  which_key_delay_ms: 0,
  modes: {
    normal: { kind: "branch", children: { j: leaf("log_j"), k: leaf("log_k") } },
    hint: { kind: "branch", children: {} },
    caret: { kind: "branch", children: { e: leaf("log_caret_e") } },
  },
};

type Load = { finish: (register: () => void) => void };

// One document wired as main.ts wires it, with the replay hold built the way main.ts builds it on `replay_hold`.
function make_page() {
  const state = create_mode_state();
  const host = create_bundle_host();
  const events: string[] = [];
  const loads: Load[] = [];
  const flow = create_key_flow({
    get_mode_: state.get_mode_,
    take_pass_next_: state.take_pass_next_,
    in_editable_field_: () => false,
    escape_to_page_: () => false,
    is_loading_: host.is_loading_,
    loading_sink_bundles_: host.loading_sink_bundles_,
    sink_of_: host.sink_of_,
    on_prefix_: () => {},
    leave_insert_: () => state.escape(),
    run_leaf_: (matched) => void events.push(`run ${matched.steps[0]!.invocation.id} in ${state.get_mode_()}`),
  });
  state.listen((mode) => {
    flow.reset_sequence_();
    host.enter_mode_(mode);
  });
  host.connect({
    request_bundle_: () => new Promise<boolean>((resolve) => loads.push({ finish: (register) => (register(), resolve(true)) })),
    on_idle_: flow.release,
    hold_first_: flow.hold_first_,
    set_mode_: state.set_mode_,
    show_error_: (message) => events.push(`error ${message}`),
  });
  flow.set_matcher_(create_matcher(keymap));
  const sink = (mode: Mode): Sink => ({ on_token_: (token) => (events.push(`${mode} sink ${token}`), "handled"), exit: () => {} });
  // What `replay_end` answers. The hold ends when it settles.
  const replay_hold = () => {
    let answer!: (ended: { ok: boolean }) => void;
    const ended = new Promise<{ ok: boolean }>((resolve) => (answer = resolve));
    host.api.hold_keys_until_(ended.then((reply) => (reply.ok || flow.drop_held_(), [])), true);
    return answer;
  };
  const press = (...tokens: string[]) => tokens.map((token) => flow.handle_token_(token));
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { state, host, flow, events, loads, sink, replay_hold, press, settle };
}

test("a hint pick during a replay takes its labels through the hold, and the keys held before it run after the replay in order", async () => {
  const page = make_page();
  page.host.api.register_sink_("hint", page.sink("hint"));
  const end = page.replay_hold();
  assert.deepEqual(page.press("j", "k"), ["cancel", "cancel"]);
  page.state.set_mode_("hint");
  assert.deepEqual(page.press("a"), ["cancel"]);
  assert.deepEqual(page.events, ["hint sink a"]);
  // The pick ends and the replay runs on. The held keys still wait.
  page.state.set_mode_("normal");
  page.flow.release();
  assert.deepEqual(page.events, ["hint sink a"]);
  end({ ok: true });
  await page.settle();
  assert.deepEqual(page.events, ["hint sink a", "run log_j in normal", "run log_k in normal"]);
});

test("the keys held before a pick do not drain into it when the hint bundle's load ends", async () => {
  const page = make_page();
  const end = page.replay_hold();
  page.press("j");
  // As `hint.run` does: the hints bundle enters hint mode once its sink is in.
  void page.host.run_command_("hint.run", "hints", {}, "needs hints");
  // A key typed while the bundle loads waits too, because no sink is there to take it.
  page.press("a");
  assert.equal(page.loads.length, 1);
  page.loads[0]!.finish(() => {
    page.host.api.register_sink_("hint", page.sink("hint"));
    page.host.api.register_handler_("hint.run", () => page.host.api.set_mode_("hint"));
  });
  await page.settle();
  assert.deepEqual(page.events, []);
  // Once the sink is in, a new key reaches it at once.
  page.press("s");
  assert.deepEqual(page.events, ["hint sink s"]);
  page.state.set_mode_("normal");
  end({ ok: true });
  await page.settle();
  // `a` was typed for the pick but held, so after the replay it runs as a normal-mode key, which binds nothing.
  assert.deepEqual(page.events, ["hint sink s", "run log_j in normal"]);
});

test("a caret mode under a replay hold gets no keys until the replay ends", async () => {
  const page = make_page();
  page.host.api.register_sink_("caret", { on_token_: () => "pass", exit: () => {} });
  const end = page.replay_hold();
  page.state.set_mode_("caret");
  assert.deepEqual(page.press("e"), ["cancel"]);
  assert.deepEqual(page.events, []);
  end({ ok: true });
  await page.settle();
  assert.deepEqual(page.events, ["run log_caret_e in caret"]);
});

test("a hold that is not a replay's still holds keys during a pick", async () => {
  const page = make_page();
  page.host.api.register_sink_("hint", page.sink("hint"));
  page.replay_hold();
  let hand_back!: (tokens: string[]) => void;
  page.host.api.hold_keys_until_(new Promise((resolve) => (hand_back = resolve)));
  page.state.set_mode_("hint");
  assert.deepEqual(page.press("a"), ["cancel"]);
  assert.deepEqual(page.events, []);
  hand_back([]);
  await page.settle();
  page.press("s");
  assert.deepEqual(page.events, ["hint sink s"]);
});

test("a failed or stopped replay drops the keys typed during it", async () => {
  const page = make_page();
  const end = page.replay_hold();
  page.press("j", "k");
  end({ ok: false });
  await page.settle();
  assert.deepEqual(page.events, []);
  assert.equal(page.host.is_loading_(), false);
  page.press("j");
  assert.deepEqual(page.events, ["run log_j in normal"]);
});

test("the replay's own key hold and its replay hold both end before the keys run, in either order", async () => {
  for (const leaf_first of [true, false]) {
    const page = make_page();
    let leaf_done!: (tokens: string[]) => void;
    page.host.api.hold_keys_until_(new Promise((resolve) => (leaf_done = resolve)), true);
    const end = page.replay_hold();
    page.press("j");
    if (leaf_first) leaf_done([]);
    end({ ok: false });
    if (!leaf_first) leaf_done([]);
    await page.settle();
    assert.deepEqual(page.events, [], `leaf hold first: ${leaf_first}`);
    assert.equal(page.host.is_loading_(), false);
  }
});

test("a page that goes away ends its replay hold, so its keys run there at once", async () => {
  const page = make_page();
  page.replay_hold();
  page.press("j");
  page.host.page_hidden_();
  await page.settle();
  assert.deepEqual(page.events, ["run log_j in normal"]);
  assert.equal(page.host.is_loading_(), false);
});
