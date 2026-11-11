import assert from "node:assert/strict";
import { test } from "node:test";
import { create_bundle_host } from "../../src/content/bundle_host.ts";
import type { Sink } from "../../src/content/bundle_host.ts";
import { create_key_flow } from "../../src/content/key_flow.ts";
import { create_mode_state } from "../../src/content/mode_state.ts";
import { create_matcher } from "../../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_VERSION } from "../../src/shared/index.ts";
import type { BundleName, CompiledKeymap, Mode, TreeNode } from "../../src/shared/index.ts";

const leaf = (id: string, args: Record<string, unknown> = {}): TreeNode => ({ kind: "leaf", steps: [{ invocation: { id, args }, runs_in: "content", count_rule: "ignore" }] });

const keymap: CompiledKeymap = {
  format_version: COMPILED_KEYMAP_VERSION,
  mode_indicator: "always",
  which_key_delay_ms: 0,
  modes: {
    normal: {
      kind: "branch",
      children: {
        f: leaf("hint.run"),
        V: leaf("mode.set", { mode: "caret" }),
        x: leaf("log_x"),
        j: leaf("log_j"),
        z: leaf("page.align"),
        g: { kind: "branch", children: { g: leaf("log_gg"), t: leaf("log_gt") } },
      },
    },
    hint: { kind: "branch", children: { "<Escape>": leaf("mode.escape") } },
    caret: { kind: "branch", children: { "<Escape>": leaf("mode.escape"), e: leaf("log_caret_e"), "<F7>": leaf("log_caret_f7") } },
  },
};

type Load = { name: BundleName; finish: (loaded: boolean, register?: () => void) => void };

// One simulated document: a mode state, a key flow and a host wired as main.ts wires them.
function make_page() {
  const state = create_mode_state();
  const host = create_bundle_host();
  const events: string[] = [];
  const loads: Load[] = [];
  const errors: string[] = [];
  const toasts: string[] = [];
  const decisions: string[] = [];
  let in_field = false;

  const flow = create_key_flow({
    get_mode_: state.get_mode_,
    take_pass_next_: state.take_pass_next_,
    in_editable_field_: () => in_field,
    escape_to_page_: () => false,
    is_loading_: host.is_loading_,
    loading_sink_bundles_: host.loading_sink_bundles_,
    sink_of_: host.sink_of_,
    on_prefix_: () => {},
    leave_insert_: () => state.escape(),
    run_leaf_: (matched, count) => {
      const { id, args } = matched.steps[0]!.invocation;
      // As main.ts does: a failed outcome is shown once, by the caller.
      if (id === "hint.run") void host.run_command_("hint.run", "hints", {}, "needs hints").then((outcome) => outcome.ok || errors.push(outcome.message));
      // The which-key bundle stands in for any bundle without a sink.
      else if (id === "page.align") void host.run_command_("page.align", "whichkey", {}, "needs page");
      // As main.ts does: the mode.set handler answers the outcome, and the caller shows a failure.
      else if (id === "mode.set") void Promise.resolve(host.set_mode_(args?.mode as Mode)).then((outcome) => outcome?.ok === false && errors.push(outcome.message));
      else if (id === "mode.escape") state.escape();
      else events.push(`run ${id}${count ?? ""}`);
    },
  });
  // What main.ts sends the background as mode_changed, one per mode change.
  const reports: Mode[] = [];
  state.listen((mode) => {
    flow.reset_sequence_();
    host.enter_mode_(mode);
    reports.push(mode);
  });
  host.connect({
    request_bundle_: (name) => new Promise<boolean>((resolve) => loads.push({ name, finish: (loaded, register) => (register?.(), resolve(loaded)) })),
    on_idle_: flow.release,
    hold_first_: flow.hold_first_,
    set_mode_: state.set_mode_,
    show_error_: (message) => errors.push(message),
    show_toast_: (message) => toasts.push(message),
  });
  flow.set_matcher_(create_matcher(keymap));

  const press = (...tokens: string[]) => {
    for (const token of tokens) decisions.push(`${token}:${flow.handle_token_(token)}`);
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const recording_sink = (mode: Mode, handled: string[]): Sink => ({
    on_token_: (token) => {
      events.push(`${mode} sink ${token}`);
      return handled.includes(token) ? "handled" : "pass";
    },
    enter: () => events.push(`${mode} sink enter`),
    exit: (destination) => events.push(`${mode} sink exit to ${destination}`),
  });
  // What caret.js registers: a recording sink per caret mode, then the handler that sets a caret mode.
  const register_caret = (modes: readonly Mode[] = ["caret"], handled: string[] = []) => {
    for (const mode of modes) host.api.register_sink_(mode, recording_sink(mode, handled));
    host.api.register_handler_("caret.mode", (args) => host.api.set_mode_(args.mode as Mode));
  };
  return { state, host, flow, events, loads, errors, reports, toasts, decisions, press, settle, recording_sink, register_caret, set_in_field: (value: boolean) => (in_field = value) };
}

test("keys typed while a bundle loads are held and replay in order once its sink is in", async () => {
  const page = make_page();
  page.press("f", "a", "s", "d", "j");
  assert.equal(page.loads.length, 1);
  assert.equal(page.loads[0]!.name, "hints");
  assert.deepEqual(page.decisions, ["f:cancel", "a:cancel", "s:cancel", "d:cancel", "j:cancel"]);
  assert.deepEqual(page.events, []);

  const sink = page.recording_sink("hint", ["a", "s", "d"]);
  page.loads[0]!.finish(true, () => {
    page.host.api.register_sink_("hint", sink);
    page.host.api.register_handler_("hint.run", () => page.state.set_mode_("hint"));
  });
  await page.settle();
  // The handler put the page in hint mode before the held keys replayed, so the sink saw a, s and d. The sink passed j to the keymap, which has no j in hint mode.
  assert.deepEqual(page.events, ["hint sink enter", "hint sink a", "hint sink s", "hint sink d", "hint sink j"]);
  assert.equal(page.state.get_mode_(), "hint");
  assert.equal(page.host.is_loading_(), false);
});

test("a second press after the load runs the handler at once and asks for nothing", async () => {
  const page = make_page();
  page.press("f");
  page.loads[0]!.finish(true, () => page.host.api.register_handler_("hint.run", () => void page.events.push("hint.run")));
  await page.settle();
  page.press("f", "f");
  assert.equal(page.loads.length, 1);
  assert.deepEqual(page.events, ["hint.run", "hint.run", "hint.run"]);
});

test("a count that runs the command several times in one turn asks for the bundle once", () => {
  const page = make_page();
  for (let time = 0; time < 3; time++) page.host.run_command_("hint.run", "hints", {}, "needs hints");
  assert.equal(page.loads.length, 1);
});

test("a failed load shows an error, replays the held keys in the current mode and leaves nothing held", async () => {
  const page = make_page();
  page.press("f", "x", "j");
  page.loads[0]!.finish(false);
  await page.settle();
  assert.deepEqual(page.errors, ["DesertFox could not load hints"]);
  assert.deepEqual(page.events, ["run log_x", "run log_j"]);
  assert.equal(page.host.is_loading_(), false);
  // The failure was forgotten: the next press asks again.
  page.press("f");
  assert.equal(page.loads.length, 2);
  page.loads[1]!.finish(true);
  await page.settle();
  assert.deepEqual(page.errors, ["DesertFox could not load hints", "needs hints"]);
});

test("a bundle that registers no handler refuses with the reason and the held keys still replay", async () => {
  const page = make_page();
  page.press("f", "x");
  page.loads[0]!.finish(true);
  await page.settle();
  assert.deepEqual(page.errors, ["needs hints"]);
  assert.deepEqual(page.events, ["run log_x"]);
});

test("entering a caret mode loads its bundle first, and a bundle that cannot set it leaves the page in normal mode", async () => {
  const page = make_page();
  page.press("V", "x", "j");
  assert.equal(page.state.get_mode_(), "normal");
  assert.equal(page.loads[0]!.name, "caret");
  page.loads[0]!.finish(true);
  await page.settle();
  assert.equal(page.state.get_mode_(), "normal");
  assert.deepEqual(page.errors, ["needs caret mode"]);
  assert.deepEqual(page.events, ["run log_x", "run log_j"]);
  assert.equal(page.host.is_loading_(), false);
});

test("a caret mode whose bundle fails to load stays unset, the keys replay in normal mode, and the next try loads again", async () => {
  const page = make_page();
  page.press("V", "x");
  page.loads[0]!.finish(false);
  await page.settle();
  assert.equal(page.state.get_mode_(), "normal");
  assert.deepEqual(page.errors, ["DesertFox could not load caret"]);
  assert.deepEqual(page.events, ["run log_x"]);
  page.press("V");
  page.loads[1]!.finish(true, () => page.register_caret());
  await page.settle();
  assert.equal(page.state.get_mode_(), "caret");
  assert.deepEqual(page.events, ["run log_x", "caret sink enter"]);
});

test("entering a sink mode with the sink in place loads nothing, and leaving it calls exit", async () => {
  const page = make_page();
  page.host.api.register_sink_("caret", page.recording_sink("caret", []));
  page.press("V");
  assert.equal(page.loads.length, 0);
  assert.equal(page.state.get_mode_(), "caret");
  page.press("<Escape>");
  assert.equal(page.state.get_mode_(), "normal");
  assert.deepEqual(page.events, ["caret sink enter", "caret sink <Escape>", "caret sink exit to normal"]);
});

test("mode caret and visual share one bundle load", async () => {
  const page = make_page();
  page.press("V");
  page.host.set_mode_("visual");
  assert.deepEqual(page.loads.map((load) => load.name), ["caret"]);
  page.loads[0]!.finish(true, () => page.register_caret(["caret", "visual"]));
  await page.settle();
  assert.equal(page.state.get_mode_(), "visual");
  assert.deepEqual(page.events, ["caret sink enter", "caret sink exit to visual", "visual sink enter"]);
});

test("a leaving page mid-load strands nothing: the held keys are gone with the page and a new page starts clean", async () => {
  const old_page = make_page();
  old_page.press("f", "x");
  const new_page = make_page();
  assert.equal(new_page.host.is_loading_(), false);
  new_page.press("x");
  assert.deepEqual(new_page.events, ["run log_x"]);
  // The old page's load never answers. Nothing outside it is waiting.
  assert.equal(old_page.host.is_loading_(), true);
});

test("40 keys held during a load all replay in order", async () => {
  const page = make_page();
  page.press("f");
  const typed = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? "x" : "j"));
  page.press(...typed);
  assert.ok(page.decisions.every((decision) => decision.endsWith(":cancel")));
  page.loads[0]!.finish(true);
  await page.settle();
  assert.deepEqual(page.events, typed.map((key) => `run log_${key}`));
});

test("keys the command line hands back replay ahead of the keys the page held meanwhile, and an unbound key passes at once", async () => {
  const page = make_page();
  let hand_back!: (tokens: readonly string[]) => void;
  page.host.api.hold_keys_until_(new Promise((resolve) => (hand_back = resolve)));
  page.press("q", "x");
  assert.deepEqual(page.decisions, ["q:pass", "x:cancel"]);
  assert.deepEqual(page.events, []);
  hand_back(["j", "g", "g"]);
  await page.settle();
  assert.deepEqual(page.events, ["run log_j", "run log_gg", "run log_x"]);
  assert.equal(page.host.is_loading_(), false);
});

test("a hand-back that fails still releases the keys the page held", async () => {
  const page = make_page();
  page.host.api.hold_keys_until_(Promise.reject(new Error("frame gone")));
  page.press("x");
  await page.settle();
  assert.deepEqual(page.events, ["run log_x"]);
});

test("a hold that drops on hide ends with its reply, with a failure, or when the page goes away, and only once", async () => {
  const succeeded = make_page();
  let reply!: (tokens: readonly string[]) => void;
  succeeded.host.api.hold_keys_until_(new Promise((resolve) => (reply = resolve)), true);
  succeeded.press("x");
  assert.deepEqual(succeeded.events, []);
  reply([]);
  await succeeded.settle();
  assert.deepEqual(succeeded.events, ["run log_x"]);
  assert.equal(succeeded.host.is_loading_(), false);

  const refused = make_page();
  refused.host.api.hold_keys_until_(Promise.reject(new Error("refused")), true);
  refused.press("x");
  await refused.settle();
  assert.deepEqual(refused.events, ["run log_x"]);

  const hidden = make_page();
  let late!: (tokens: readonly string[]) => void;
  hidden.host.api.hold_keys_until_(new Promise((resolve) => (late = resolve)), true);
  hidden.press("x");
  hidden.host.page_hidden_();
  await hidden.settle();
  assert.deepEqual(hidden.events, ["run log_x"]);
  assert.equal(hidden.host.is_loading_(), false);
  // The lost reply arrives after the page returns: it neither replays keys nor releases a second time.
  late(["j"]);
  await hidden.settle();
  assert.deepEqual(hidden.events, ["run log_x"]);
  assert.equal(hidden.host.is_loading_(), false);
});

test("a hold without drop on hide survives the page going away, as the command line hand-back does", async () => {
  const page = make_page();
  page.host.api.hold_keys_until_(new Promise(() => {}));
  page.host.page_hidden_();
  assert.equal(page.host.is_loading_(), true);
});

test("chords and keys typed in a field pass through while a bundle loads", async () => {
  const page = make_page();
  page.press("f");
  page.press("<C-c>");
  page.set_in_field(true);
  page.press("q");
  assert.deepEqual(page.decisions.slice(1), ["<C-c>:pass", "q:pass"]);
});

test("a replayed key that starts another load keeps the keys behind it waiting for that load", async () => {
  const page = make_page();
  // Mode caret needs the caret bundle. The hints bundle's own handler enters it, so the replayed keys wait twice.
  page.press("f", "x", "V", "j");
  page.loads[0]!.finish(true, () => page.host.api.register_handler_("hint.run", () => void page.events.push("hint.run")));
  await page.settle();
  // x replayed in normal mode, V entered caret mode and started the caret load, j waits for it.
  assert.deepEqual(page.events, ["hint.run", "run log_x"]);
  assert.equal(page.loads[1]?.name, "caret");
  assert.equal(page.host.is_loading_(), true);
  page.loads[1]!.finish(true, () => page.register_caret(["caret"], ["j"]));
  await page.settle();
  assert.deepEqual(page.events, ["hint.run", "run log_x", "caret sink enter", "caret sink j"]);
  assert.equal(page.state.get_mode_(), "caret");
});

test("a sink that handles a token keeps it from the keymap", () => {
  const page = make_page();
  page.host.api.register_sink_("hint", page.recording_sink("hint", ["a"]));
  page.state.set_mode_("hint");
  page.press("a", "<Escape>");
  assert.deepEqual(page.decisions, ["a:cancel", "<Escape>:cancel"]);
  assert.equal(page.state.get_mode_(), "normal");
});

test("toasts and badge updates requested before the ui bundle loads are kept and run in order, without holding keys", async () => {
  const page = make_page();
  const drawn: string[] = [];
  page.host.run_command_("ui.badge", "ui", { label: "NORMAL" }, "ui missing", false);
  page.host.run_command_("ui.toast", "ui", { message: "first" }, "ui missing", false);
  page.host.run_command_("ui.toast", "ui", { message: "second" }, "ui missing", false);
  assert.equal(page.loads.length, 1);
  assert.equal(page.host.is_loading_(), false);
  page.press("x");
  assert.deepEqual(page.events, ["run log_x"]);
  page.loads[0]!.finish(true, () => {
    page.host.api.register_handler_("ui.badge", (args) => void drawn.push(`badge ${args.label}`));
    page.host.api.register_handler_("ui.toast", (args) => void drawn.push(`toast ${args.message}`));
  });
  await page.settle();
  assert.deepEqual(drawn, ["badge NORMAL", "toast first", "toast second"]);
  page.host.run_command_("ui.toast", "ui", { message: "third" }, "ui missing", false);
  assert.equal(drawn.at(-1), "toast third");
  assert.equal(page.loads.length, 1);
});

test("when the ui bundle cannot load, the error is reported once and does not ask for the bundle again by itself", async () => {
  const page = make_page();
  page.host.run_command_("ui.toast", "ui", { message: "lost" }, "ui missing", false);
  page.loads[0]!.finish(false);
  await page.settle();
  assert.deepEqual(page.errors, ["DesertFox could not load ui"]);
  assert.equal(page.host.has_handler_("ui.toast"), false);
  assert.equal(page.loads.length, 1);
});

test("a bundle enters hint mode with set_mode_, its sink gets the keys, and set_mode_ normal leaves it", () => {
  const page = make_page();
  page.host.api.register_sink_("hint", page.recording_sink("hint", ["a"]));
  page.host.api.set_mode_("hint");
  assert.equal(page.state.get_mode_(), "hint");
  page.press("a");
  assert.deepEqual(page.events, ["hint sink enter", "hint sink a"]);
  page.host.api.set_mode_("normal");
  assert.equal(page.state.get_mode_(), "normal");
  assert.deepEqual(page.events, ["hint sink enter", "hint sink a", "hint sink exit to normal"]);
});

test("a sink is entered once when its bundle finishes loading, and keys held for the load see the entered mode", async () => {
  const page = make_page();
  page.press("V");
  page.loads[0]!.finish(true, () => page.register_caret());
  await page.settle();
  assert.deepEqual(page.events, ["caret sink enter"]);
});

test("a sink entered again after it exited gets one more enter and one more exit", () => {
  const page = make_page();
  page.host.api.register_sink_("caret", page.recording_sink("caret", []));
  page.press("V", "<Escape>", "V", "<Escape>");
  assert.deepEqual(page.events.filter((event) => event.includes("enter") || event.includes("exit")), [
    "caret sink enter", "caret sink exit to normal", "caret sink enter", "caret sink exit to normal",
  ]);
});

test("exit names the mode the page went to, whichever way it left", () => {
  const page = make_page();
  page.host.api.register_sink_("caret", page.recording_sink("caret", []));
  page.host.api.register_sink_("visual", page.recording_sink("visual", []));
  page.press("V");
  page.state.set_mode_("visual");
  page.state.set_mode_("caret");
  // A command such as `:` takes the page to the command line mode.
  page.state.set_mode_("cmdline");
  assert.deepEqual(page.events, [
    "caret sink enter", "caret sink exit to visual", "visual sink enter", "visual sink exit to caret", "caret sink enter", "caret sink exit to cmdline",
  ]);
});

test("a page that hides leaves the mode with exit page_hidden_, once, and returns to normal", () => {
  const page = make_page();
  page.host.api.register_sink_("caret", page.recording_sink("caret", []));
  page.press("V");
  page.host.page_hidden_();
  page.host.page_hidden_();
  assert.equal(page.state.get_mode_(), "normal");
  assert.deepEqual(page.events, ["caret sink enter", "caret sink exit to page_hidden"]);
  page.press("V");
  assert.deepEqual(page.events.slice(2), ["caret sink enter"]);
});

test("a page that hides in a mode without a sink is left alone", () => {
  const page = make_page();
  page.state.set_mode_("insert");
  page.host.page_hidden_();
  assert.equal(page.state.get_mode_(), "insert");
});

test("a bundle shows a toast through the host, and the error path takes it when the page gave no toast", () => {
  const page = make_page();
  page.host.api.show_toast_("Copied x");
  assert.deepEqual(page.toasts, ["Copied x"]);
  const bare = create_bundle_host();
  const shown: string[] = [];
  bare.connect({ request_bundle_: async () => true, on_idle_: () => {}, hold_first_: () => {}, show_error_: (message) => shown.push(message), set_mode_: () => {} });
  bare.api.show_toast_("hello");
  assert.deepEqual(shown, ["hello"]);
});

test("get_mode follows the mode the host entered", () => {
  const page = make_page();
  assert.equal(page.host.api.get_mode(), "normal");
  page.state.set_mode_("insert");
  assert.equal(page.host.api.get_mode(), "insert");
  page.state.escape();
  assert.equal(page.host.api.get_mode(), "normal");
});

test("run_command answers the handler's real outcome after the load", async () => {
  const page = make_page();
  const answer = page.host.api.run_command_("hint.run", "hints", {});
  page.loads[0]!.finish(true, () => page.host.api.register_handler_("hint.run", () => ({ ok: false, message: "No hints on this page" })));
  assert.deepEqual(await answer, { ok: false, message: "No hints on this page" });
  assert.equal(page.errors.length, 0);
});

test("run_command answers failed for a failed load and for a bundle with no handler, and a throw is failed", async () => {
  const page = make_page();
  const lost = page.host.api.run_command_("hint.run", "hints", {});
  page.loads[0]!.finish(false);
  assert.deepEqual(await lost, { ok: false, message: "DesertFox could not load hints" });
  assert.equal(page.host.is_loading_(), false);
  const empty = page.host.api.run_command_("hint.run", "hints", {});
  page.loads[1]!.finish(true);
  assert.deepEqual(await empty, { ok: false, message: "hints has no hint.run" });
  page.host.api.register_handler_("hint.run", () => {
    throw new Error("broken");
  });
  assert.deepEqual(await page.host.api.run_command_("hint.run", "hints", {}), { ok: false, message: "broken" });
});

test("a registered handler runs in the caller's turn, and a pending handler does not hold keys", async () => {
  const page = make_page();
  let release!: () => void;
  const ran: string[] = [];
  page.host.api.register_handler_("hint.run", () => (ran.push("run"), new Promise<void>((resolve) => (release = resolve))));
  const waiting = page.host.api.run_command_("hint.run", "hints", {});
  assert.deepEqual(ran, ["run"]);
  assert.equal(page.host.is_loading_(), false);
  page.press("x");
  assert.deepEqual(page.events, ["run log_x"]);
  release();
  assert.deepEqual(await waiting, { ok: true });
});

// The bundle script registers its handlers as it runs, and the load's answer comes a little later. A call in that gap must not overtake the calls queued on the load.
test("a call made after the bundle registered but before its load answered runs after the calls queued on the load", async () => {
  const page = make_page();
  const ran: string[] = [];
  const first = page.host.run_command_("text.input", "text", {}, "", false);
  page.host.api.register_handler_("text.input", () => void ran.push("input"));
  page.host.api.register_handler_("text.flush", () => void ran.push("flush"));
  const second = page.host.run_command_("text.flush", "text", {}, "");
  assert.deepEqual(ran, []);
  assert.equal(page.host.is_loading_(), true);
  page.loads[0]!.finish(true);
  assert.deepEqual([await first, await second], [{ ok: true }, { ok: true }]);
  assert.deepEqual(ran, ["input", "flush"]);
  assert.equal(page.loads.length, 1);
  assert.equal(page.host.is_loading_(), false);
  // Once the load answered, a call runs in the caller's turn again.
  void page.host.run_command_("text.flush", "text", {}, "");
  assert.deepEqual(ran, ["input", "flush", "flush"]);
});

test("a load that never answers keeps the calls made in the gap waiting, and once it fails the next call runs at once", async () => {
  const page = make_page();
  const ran: string[] = [];
  const queued = page.host.run_command_("text.input", "text", {}, "");
  page.host.api.register_handler_("text.input", () => void ran.push("input"));
  const in_gap = page.host.run_command_("text.input", "text", {}, "");
  page.press("x");
  await page.settle();
  assert.deepEqual(ran, []);
  assert.deepEqual(page.events, []);
  assert.equal(page.host.is_loading_(), true);
  // The script ran, so the handlers it registered answer even though the load reports a failure.
  page.loads[0]!.finish(false);
  assert.deepEqual([await queued, await in_gap], [{ ok: true }, { ok: true }]);
  await page.settle();
  assert.deepEqual(page.events, ["run log_x"]);
  void page.host.run_command_("text.input", "text", {}, "");
  assert.deepEqual(ran, ["input", "input", "input"]);
  assert.equal(page.loads.length, 1);
  assert.equal(page.host.is_loading_(), false);
});

test("keys are held for the load only, not while the loaded handler still waits", async () => {
  const page = make_page();
  let release!: () => void;
  const waiting = page.host.api.run_command_("hint.run", "hints", {});
  assert.equal(page.host.is_loading_(), true);
  page.loads[0]!.finish(true, () => page.host.api.register_handler_("hint.run", () => new Promise<void>((resolve) => (release = resolve))));
  await page.settle();
  assert.equal(page.host.is_loading_(), false);
  release();
  assert.deepEqual(await waiting, { ok: true });
});

test("a waiting handler is cancelled by Escape, which the sink passes to the keymap, and by the page hiding", async () => {
  for (const leave of ["<Escape>", "page_hidden"]) {
    const page = make_page();
    let finish!: (outcome: { ok: true; cancelled?: true }) => void;
    // The sink as a bundle writes it: the first exit settles the wait, a later one changes nothing.
    page.host.api.register_sink_("hint", { on_token_: (token) => (token === "<Escape>" ? "pass" : "handled"), exit: () => finish({ ok: true, cancelled: true }) });
    page.host.api.register_handler_("hint.run", () => {
      page.state.set_mode_("hint");
      return new Promise((resolve) => (finish = resolve));
    });
    const waiting = page.host.api.run_command_("hint.run", "hints", {});
    assert.equal(page.state.get_mode_(), "hint");
    if (leave === "page_hidden") page.host.page_hidden_();
    else page.press(leave);
    assert.deepEqual(await waiting, { ok: true, cancelled: true }, leave);
    assert.equal(page.state.get_mode_(), "normal");
  }
});

test("a handler that throws something that is not an Error still answers a failed message", async () => {
  const page = make_page();
  page.host.api.register_handler_("hint.run", () => {
    throw "plain string";
  });
  assert.deepEqual(await page.host.api.run_command_("hint.run", "hints", {}), { ok: false, message: "plain string" });
});

// A bundle without a sink, loading. `z` asks for it.
async function finish_page_load(page: ReturnType<typeof make_page>) {
  page.loads.at(-1)!.finish(true, () => page.host.api.register_handler_("page.align", () => void page.events.push("align")));
  await page.settle();
}

test("a key that binds nothing reaches the page at once while a bundle without a sink loads", async () => {
  const page = make_page();
  page.press("z", "<F8>", "j");
  assert.deepEqual(page.decisions, ["z:cancel", "<F8>:pass", "j:cancel"]);
  await finish_page_load(page);
  assert.deepEqual(page.events, ["align", "run log_j"]);
});

test("while the cmdline bundle loads, or a sink takes the current mode, every plain key waits for it", async () => {
  const loading = make_page();
  void loading.host.run_command_("open", "cmdline", {}, "missing");
  loading.press("<F8>", "q");
  assert.deepEqual(loading.decisions, ["<F8>:cancel", "q:cancel"]);
  const page = make_page();
  page.host.api.register_sink_("hint", page.recording_sink("hint", ["q"]));
  page.state.set_mode_("hint");
  void page.host.run_command_("page.align", "whichkey", {}, "needs page");
  page.press("<F8>", "q");
  assert.deepEqual(page.decisions, ["<F8>:cancel", "q:cancel"]);
  await finish_page_load(page);
  assert.deepEqual(page.events, ["hint sink enter", "align", "hint sink <F8>", "hint sink q"]);
});

test("a key the page gets during a load goes ahead of the held keys typed before it", async () => {
  const page = make_page();
  page.press("z", "g", "<F8>", "t");
  assert.deepEqual(page.decisions, ["z:cancel", "g:cancel", "<F8>:pass", "t:pass"]);
  await finish_page_load(page);
  // F8 ended the held g before t came, so gt does not run.
  assert.deepEqual(page.events, ["align"]);
});

test("after a held binding every key waits, because the binding can change the mode the keys replay in", async () => {
  const page = make_page();
  page.press("z", "x", "<F8>");
  assert.deepEqual(page.decisions, ["z:cancel", "x:cancel", "<F8>:cancel"]);
  await finish_page_load(page);
  assert.deepEqual(page.events, ["align", "run log_x"]);
});

test("a held key that enters caret mode during a load hands the next key to the caret sink", async () => {
  const page = make_page();
  page.host.api.register_sink_("caret", page.recording_sink("caret", ["e"]));
  page.press("z", "V", "e");
  assert.deepEqual(page.decisions, ["z:cancel", "V:cancel", "e:cancel"]);
  await finish_page_load(page);
  assert.deepEqual(page.events, ["align", "caret sink enter", "caret sink e"]);
});

test("a held hint start during a load hands the next key to the hint sink once hints load", async () => {
  const page = make_page();
  page.press("z", "f", "s");
  assert.deepEqual(page.decisions, ["z:cancel", "f:cancel", "s:cancel"]);
  await finish_page_load(page);
  assert.equal(page.loads.at(-1)!.name, "hints");
  page.loads.at(-1)!.finish(true, () => {
    page.host.api.register_sink_("hint", page.recording_sink("hint", ["s"]));
    page.host.api.register_handler_("hint.run", () => page.state.set_mode_("hint"));
  });
  await page.settle();
  assert.deepEqual(page.events, ["align", "hint sink enter", "hint sink s"]);
});

test("breaks from many keys the page gets take one held slot, so a later bound key still waits", async () => {
  const page = make_page();
  page.press("z", "g", ...Array.from({ length: 40 }, () => "<F8>"), "j");
  assert.equal(page.decisions.at(-1), "j:cancel");
  await finish_page_load(page);
  assert.deepEqual(page.events, ["align", "run log_j"]);
});

test("a held half-typed sequence waits for the key that continues it and ends at the key the page got", async () => {
  const page = make_page();
  page.press("z", "g", "t");
  assert.deepEqual(page.decisions, ["z:cancel", "g:cancel", "t:cancel"]);
  await finish_page_load(page);
  assert.deepEqual(page.events, ["align", "run log_gt"]);

  const broken = make_page();
  broken.press("z", "g", "q", "g");
  assert.deepEqual(broken.decisions, ["z:cancel", "g:cancel", "q:pass", "g:cancel"]);
  await finish_page_load(broken);
  // q ended the first g, so the second g starts a new sequence instead of running gg.
  assert.deepEqual(broken.events, ["align"]);
  broken.press("g");
  assert.deepEqual(broken.events, ["align", "run log_gg"]);
});

test("a count typed during a load waits with its command, and a key the page gets drops it", async () => {
  const page = make_page();
  page.press("z", "3", "j");
  assert.deepEqual(page.decisions, ["z:cancel", "3:cancel", "j:cancel"]);
  await finish_page_load(page);
  assert.deepEqual(page.events, ["align", "run log_j3"]);

  const dropped = make_page();
  dropped.press("z", "4", "<F8>", "j");
  assert.deepEqual(dropped.decisions, ["z:cancel", "4:cancel", "<F8>:pass", "j:cancel"]);
  await finish_page_load(dropped);
  assert.deepEqual(dropped.events, ["align", "run log_j"]);
});

test("Backspace during a load waits with every key after it, so it still edits the held sequence", async () => {
  const page = make_page();
  page.press("z", "g", "<Backspace>", "g", "g", "<F8>");
  assert.deepEqual(page.decisions.slice(1), ["g:cancel", "<Backspace>:cancel", "g:cancel", "g:cancel", "<F8>:cancel"]);
  await finish_page_load(page);
  assert.deepEqual(page.events, ["align", "run log_gg"]);
});

test("during a load, insert mode outside a field passes unbound keys and holds Escape and every key after it", async () => {
  const page = make_page();
  page.state.set_mode_("insert");
  void page.host.run_command_("page.align", "whichkey", {}, "needs page");
  page.press("q", "<Escape>", "j");
  assert.deepEqual(page.decisions, ["q:pass", "<Escape>:cancel", "j:cancel"]);
  assert.equal(page.state.get_mode_(), "insert");
  await finish_page_load(page);
  assert.equal(page.state.get_mode_(), "normal");
  assert.deepEqual(page.events, ["align", "run log_j"]);
  page.set_in_field(true);
  page.state.set_mode_("insert");
  page.press("z");
  assert.equal(page.decisions.at(-1), "z:pass");
});

test("keys the hints mode ignores pass at once while the hints bundle loads", () => {
  const page = make_page();
  page.press("f", "a", "<Tab>", "<Enter>", "<Down>", "<PageUp>", "<Home>", "<End>", "<F5>", "<Backspace>", "<Escape>");
  assert.deepEqual(page.decisions, [
    "f:cancel", "a:cancel", "<Tab>:pass", "<Enter>:pass", "<Down>:pass", "<PageUp>:pass", "<Home>:pass", "<End>:pass", "<F5>:pass",
    "<Backspace>:cancel", "<Escape>:cancel",
  ]);
  assert.deepEqual(page.events, []);
});

// The page stays in normal mode until caret.js sets the caret mode, so the read-ahead runs in normal mode, as for hints. A held key that binds there (`j`) would hold every key after it.
test("keys the caret modes never take pass at once while the caret bundle loads", () => {
  const page = make_page();
  page.press("V", "q", "<Tab>", "<S-Tab>", "<PageDown>", "<Home>", "<End>", "<F5>", "<Escape>");
  assert.equal(page.loads[0]!.name, "caret");
  assert.deepEqual(page.decisions, [
    "V:cancel", "q:cancel", "<Tab>:pass", "<S-Tab>:pass", "<PageDown>:pass", "<Home>:pass", "<End>:pass", "<F5>:pass", "<Escape>:cancel",
  ]);
  assert.deepEqual(page.events, []);
});

test("a page key the caret keymap binds waits for the caret bundle", () => {
  const page = make_page();
  page.press("V", "<F5>", "<F7>");
  assert.deepEqual(page.decisions, ["V:cancel", "<F5>:pass", "<F7>:cancel"]);
});

test("while the cmdline and hints bundles load together every key waits", () => {
  const page = make_page();
  void page.host.run_command_("open", "hints", {}, "missing");
  void page.host.run_command_("open", "cmdline", {}, "missing");
  page.press("<Tab>", "<F5>", "j");
  assert.deepEqual(page.loads.map((load) => load.name), ["hints", "cmdline"]);
  assert.deepEqual(page.decisions, ["<Tab>:cancel", "<F5>:cancel", "j:cancel"]);
});

// A mode change that is not a held key (focus entering a field, a set_mode message, a bundle's set_mode_) reaches the host while the bundle loads.
const sink_calls = (page: ReturnType<typeof make_page>) => page.events.filter((event) => event.includes("enter") || event.includes("exit"));

test("leave and re-enter a sink mode before its first load ends: the sink sees enter, exit, enter", async () => {
  const page = make_page();
  page.host.set_mode_("caret");
  page.host.set_mode_("normal");
  page.host.set_mode_("caret");
  page.loads[0]!.finish(true, () => page.register_caret());
  await page.settle();
  assert.deepEqual(sink_calls(page), ["caret sink enter", "caret sink exit to normal", "caret sink enter"]);
});

test("a mode left after its sink registered but before the load answers still sees enter, exit, enter in key order", async () => {
  const page = make_page();
  page.host.set_mode_("caret");
  page.register_caret();
  page.host.set_mode_("normal");
  page.host.set_mode_("caret");
  page.loads[0]!.finish(true);
  await page.settle();
  assert.deepEqual(sink_calls(page), ["caret sink enter", "caret sink exit to normal", "caret sink enter"]);
});

test("keys pressed in the same order are safe: the sink bundle load holds Escape and V, so the sink sees enter, exit, enter", async () => {
  const page = make_page();
  page.press("V", "<Escape>", "V");
  page.loads[0]!.finish(true, () => page.register_caret());
  await page.settle();
  assert.deepEqual(sink_calls(page), ["caret sink enter", "caret sink exit to normal", "caret sink enter"]);
});

test("focus entering a field while caret.js loads waits behind the caret mode, so the page ends in insert mode", async () => {
  const page = make_page();
  page.press("V");
  page.host.in_mode_order_(page.state.focus_entered_editable_);
  assert.equal(page.state.get_mode_(), "normal");
  page.loads[0]!.finish(true, () => page.register_caret());
  await page.settle();
  assert.equal(page.state.get_mode_(), "insert");
  assert.deepEqual(sink_calls(page), ["caret sink enter", "caret sink exit to insert"]);
  assert.deepEqual(page.reports, ["caret", "insert"]);
});

test("a set_mode message for normal mode while caret.js loads ends in normal mode, and a key typed after it replays in normal mode", async () => {
  const page = make_page();
  page.press("V");
  page.host.api.set_mode_("normal");
  page.press("x");
  page.loads[0]!.finish(true, () => page.register_caret());
  await page.settle();
  assert.equal(page.state.get_mode_(), "normal");
  assert.deepEqual(page.events, ["caret sink enter", "caret sink exit to normal", "run log_x"]);
  assert.deepEqual(page.reports, ["caret", "normal"]);
  assert.deepEqual(page.errors, []);
});

test("a bundle's set_mode_ into visual mode loads caret.js and enters visual mode once", async () => {
  const page = make_page();
  page.host.api.set_mode_("visual");
  page.host.api.set_mode_("visual");
  assert.equal(page.state.get_mode_(), "normal");
  page.loads[0]!.finish(true, () => page.register_caret(["caret", "visual"]));
  await page.settle();
  assert.deepEqual(sink_calls(page), ["visual sink enter"]);
  assert.deepEqual(page.reports, ["visual"]);
});

test("a hint pick into caret mode answers failed when caret.js does not load, and the page stays in normal mode", async () => {
  const page = make_page();
  const picked = page.host.api.run_command_("caret.mode", "caret", { mode: "caret" });
  page.loads[0]!.finish(false);
  assert.deepEqual(await picked, { ok: false, message: "DesertFox could not load caret" });
  assert.equal(page.state.get_mode_(), "normal");
  assert.deepEqual(page.reports, []);
});

test("changes made during the load replay in order with no exit before enter: caret, visual, normal, visual_line", async () => {
  const page = make_page();
  page.host.set_mode_("caret");
  page.register_caret(["caret", "visual", "visual_line"]);
  page.host.set_mode_("visual");
  page.host.in_mode_order_(page.state.escape);
  page.host.set_mode_("visual_line");
  assert.deepEqual(page.reports, []);
  page.loads[0]!.finish(true);
  await page.settle();
  assert.deepEqual(sink_calls(page), [
    "caret sink enter", "caret sink exit to visual", "visual sink enter", "visual sink exit to normal", "visual_line sink enter",
  ]);
  assert.deepEqual(page.reports, ["caret", "visual", "normal", "visual_line"]);
  // Once caret.js is in, a caret mode is set at once.
  page.host.set_mode_("caret");
  assert.equal(page.state.get_mode_(), "caret");
  assert.equal(page.loads.length, 1);
});

test("a page that hides while caret.js loads still enters the caret mode once when the load answers", async () => {
  const page = make_page();
  page.press("V");
  page.host.page_hidden_();
  page.loads[0]!.finish(true, () => page.register_caret());
  await page.settle();
  assert.equal(page.state.get_mode_(), "caret");
  assert.deepEqual(sink_calls(page), ["caret sink enter"]);
  page.host.page_hidden_();
  assert.deepEqual(sink_calls(page), ["caret sink enter", "caret sink exit to page_hidden"]);
  assert.deepEqual(page.reports, ["caret", "normal"]);
});

test("with no caret load running a mode change runs at once", () => {
  const page = make_page();
  page.host.in_mode_order_(page.state.focus_entered_editable_);
  assert.equal(page.state.get_mode_(), "insert");
  void page.host.run_command_("page.align", "whichkey", {}, "needs page");
  page.host.set_mode_("normal");
  assert.equal(page.state.get_mode_(), "normal");
});
