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
  ignore_sites: [],
  mode_indicator: "always",
  which_key_delay_ms: 0,
  modes: {
    normal: { kind: "branch", children: { f: leaf("hint.run"), V: leaf("mode.set", { mode: "caret" }), x: leaf("log_x"), j: leaf("log_j") } },
    hint: { kind: "branch", children: { "<Escape>": leaf("mode.escape") } },
    caret: { kind: "branch", children: { "<Escape>": leaf("mode.escape") } },
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
    get_mode: state.get_mode,
    take_pass_next: state.take_pass_next,
    in_editable_field: () => in_field,
    is_loading: host.is_loading,
    sink_of: host.sink_of,
    on_prefix: () => {},
    leave_insert: () => state.escape(),
    run_leaf: (matched) => {
      const { id, args } = matched.steps[0]!.invocation;
      if (id === "hint.run") host.run_command("hint.run", "hints", {}, "needs hints");
      else if (id === "mode.set") state.set_mode(args?.mode as Mode);
      else if (id === "mode.escape") state.escape();
      else events.push(`run ${id}`);
    },
  });
  state.listen((mode) => {
    flow.reset_sequence();
    host.enter_mode(mode);
  });
  host.connect({
    request_bundle: (name) => new Promise<boolean>((resolve) => loads.push({ name, finish: (loaded, register) => (register?.(), resolve(loaded)) })),
    on_idle: flow.release,
    set_mode: state.set_mode,
    show_error: (message) => errors.push(message),
    show_toast: (message) => toasts.push(message),
    on_sink_missing: (mode) => {
      events.push(`sink missing for ${mode}`);
      state.set_mode("normal");
    },
  });
  flow.set_matcher(create_matcher(keymap));

  const press = (...tokens: string[]) => {
    for (const token of tokens) decisions.push(`${token}:${flow.handle_token(token)}`);
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const recording_sink = (mode: Mode, handled: string[]): Sink => ({
    on_token: (token) => {
      events.push(`${mode} sink ${token}`);
      return handled.includes(token) ? "handled" : "pass";
    },
    enter: () => events.push(`${mode} sink enter`),
    exit: (destination) => events.push(`${mode} sink exit to ${destination}`),
  });
  return { state, host, flow, events, loads, errors, toasts, decisions, press, settle, recording_sink, set_in_field: (value: boolean) => (in_field = value) };
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
    page.host.api.register_sink("hint", sink);
    page.host.api.register_handler("hint.run", () => page.state.set_mode("hint"));
  });
  await page.settle();
  // The handler put the page in hint mode before the held keys replayed, so the sink saw a, s and d. The sink passed j to the keymap, which has no j in hint mode.
  assert.deepEqual(page.events, ["hint sink enter", "hint sink a", "hint sink s", "hint sink d", "hint sink j"]);
  assert.equal(page.state.get_mode(), "hint");
  assert.equal(page.host.is_loading(), false);
});

test("a second press after the load runs the handler at once and asks for nothing", async () => {
  const page = make_page();
  page.press("f");
  page.loads[0]!.finish(true, () => page.host.api.register_handler("hint.run", () => page.events.push("hint.run")));
  await page.settle();
  page.press("f", "f");
  assert.equal(page.loads.length, 1);
  assert.deepEqual(page.events, ["hint.run", "hint.run", "hint.run"]);
});

test("a count that runs the command several times in one turn asks for the bundle once", () => {
  const page = make_page();
  for (let time = 0; time < 3; time++) page.host.run_command("hint.run", "hints", {}, "needs hints");
  assert.equal(page.loads.length, 1);
});

test("a failed load shows an error, replays the held keys in the current mode and leaves nothing held", async () => {
  const page = make_page();
  page.press("f", "x", "j");
  page.loads[0]!.finish(false);
  await page.settle();
  assert.deepEqual(page.errors, ["OasisFox could not load hints"]);
  assert.deepEqual(page.events, ["run log_x", "run log_j"]);
  assert.equal(page.host.is_loading(), false);
  // The failure was forgotten: the next press asks again.
  page.press("f");
  assert.equal(page.loads.length, 2);
  page.loads[1]!.finish(true);
  await page.settle();
  assert.deepEqual(page.errors, ["OasisFox could not load hints", "needs hints"]);
});

test("a bundle that registers no handler refuses with the reason and the held keys still replay", async () => {
  const page = make_page();
  page.press("f", "x");
  page.loads[0]!.finish(true);
  await page.settle();
  assert.deepEqual(page.errors, ["needs hints"]);
  assert.deepEqual(page.events, ["run log_x"]);
});

test("entering a sink mode loads its bundle, and a bundle without the sink returns the page to normal mode", async () => {
  const page = make_page();
  page.press("V", "x", "j");
  assert.equal(page.state.get_mode(), "caret");
  assert.equal(page.loads[0]!.name, "caret");
  page.loads[0]!.finish(true);
  await page.settle();
  assert.equal(page.state.get_mode(), "normal");
  assert.deepEqual(page.events, ["sink missing for caret", "run log_x", "run log_j"]);
  assert.equal(page.host.is_loading(), false);
});

test("entering a sink mode with the sink in place loads nothing, and leaving it calls exit", async () => {
  const page = make_page();
  page.host.api.register_sink("caret", page.recording_sink("caret", []));
  page.press("V");
  assert.equal(page.loads.length, 0);
  assert.equal(page.state.get_mode(), "caret");
  page.press("<Escape>");
  assert.equal(page.state.get_mode(), "normal");
  assert.deepEqual(page.events, ["caret sink enter", "caret sink <Escape>", "caret sink exit to normal"]);
});

test("mode caret and visual share one bundle load", async () => {
  const page = make_page();
  page.press("V");
  page.state.set_mode("visual");
  assert.deepEqual(page.loads.map((load) => load.name), ["caret"]);
  page.loads[0]!.finish(true, () => {
    page.host.api.register_sink("caret", page.recording_sink("caret", []));
    page.host.api.register_sink("visual", page.recording_sink("visual", []));
  });
  await page.settle();
  assert.equal(page.state.get_mode(), "visual");
  // Caret mode was left before its sink existed, so only visual mode is entered.
  assert.deepEqual(page.events, ["visual sink enter"]);
});

test("a leaving page mid-load strands nothing: the held keys are gone with the page and a new page starts clean", async () => {
  const old_page = make_page();
  old_page.press("f", "x");
  const new_page = make_page();
  assert.equal(new_page.host.is_loading(), false);
  new_page.press("x");
  assert.deepEqual(new_page.events, ["run log_x"]);
  // The old page's load never answers. Nothing outside it is waiting.
  assert.equal(old_page.host.is_loading(), true);
});

test("held keys beyond 32 are dropped, the first 32 replay in order", async () => {
  const page = make_page();
  page.press("f");
  const typed = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? "x" : "j"));
  page.press(...typed);
  page.loads[0]!.finish(true);
  await page.settle();
  assert.equal(page.events.filter((event) => event.startsWith("run")).length, 32);
  assert.deepEqual(page.events.slice(0, 4), ["run log_x", "run log_j", "run log_x", "run log_j"]);
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
  page.loads[0]!.finish(true, () => page.host.api.register_handler("hint.run", () => page.events.push("hint.run")));
  await page.settle();
  // x replayed in normal mode, V entered caret mode and started the caret load, j waits for it.
  assert.deepEqual(page.events, ["hint.run", "run log_x"]);
  assert.equal(page.loads[1]?.name, "caret");
  assert.equal(page.host.is_loading(), true);
  page.loads[1]!.finish(true, () => page.host.api.register_sink("caret", page.recording_sink("caret", ["j"])));
  await page.settle();
  assert.deepEqual(page.events, ["hint.run", "run log_x", "caret sink enter", "caret sink j"]);
  assert.equal(page.state.get_mode(), "caret");
});

test("a sink that handles a token keeps it from the keymap", () => {
  const page = make_page();
  page.host.api.register_sink("hint", page.recording_sink("hint", ["a"]));
  page.state.set_mode("hint");
  page.press("a", "<Escape>");
  assert.deepEqual(page.decisions, ["a:cancel", "<Escape>:cancel"]);
  assert.equal(page.state.get_mode(), "normal");
});

test("toasts and badge updates requested before the ui bundle loads are kept and run in order, without holding keys", async () => {
  const page = make_page();
  const drawn: string[] = [];
  page.host.run_command("ui.badge", "ui", { label: "NORMAL" }, "ui missing", false);
  page.host.run_command("ui.toast", "ui", { message: "first" }, "ui missing", false);
  page.host.run_command("ui.toast", "ui", { message: "second" }, "ui missing", false);
  assert.equal(page.loads.length, 1);
  assert.equal(page.host.is_loading(), false);
  page.press("x");
  assert.deepEqual(page.events, ["run log_x"]);
  page.loads[0]!.finish(true, () => {
    page.host.api.register_handler("ui.badge", (args) => drawn.push(`badge ${args.label}`));
    page.host.api.register_handler("ui.toast", (args) => drawn.push(`toast ${args.message}`));
  });
  await page.settle();
  assert.deepEqual(drawn, ["badge NORMAL", "toast first", "toast second"]);
  page.host.run_command("ui.toast", "ui", { message: "third" }, "ui missing", false);
  assert.equal(drawn.at(-1), "toast third");
  assert.equal(page.loads.length, 1);
});

test("when the ui bundle cannot load, the error is reported once and does not ask for the bundle again by itself", async () => {
  const page = make_page();
  page.host.run_command("ui.toast", "ui", { message: "lost" }, "ui missing", false);
  page.loads[0]!.finish(false);
  await page.settle();
  assert.deepEqual(page.errors, ["OasisFox could not load ui"]);
  assert.equal(page.host.has_handler("ui.toast"), false);
  assert.equal(page.loads.length, 1);
});

test("a bundle enters hint mode with set_mode, its sink gets the keys, and set_mode normal leaves it", () => {
  const page = make_page();
  page.host.api.register_sink("hint", page.recording_sink("hint", ["a"]));
  page.host.api.set_mode("hint");
  assert.equal(page.state.get_mode(), "hint");
  page.press("a");
  assert.deepEqual(page.events, ["hint sink enter", "hint sink a"]);
  page.host.api.set_mode("normal");
  assert.equal(page.state.get_mode(), "normal");
  assert.deepEqual(page.events, ["hint sink enter", "hint sink a", "hint sink exit to normal"]);
});

test("a sink is entered once when its bundle finishes loading, and keys held for the load see the entered mode", async () => {
  const page = make_page();
  page.press("V");
  page.loads[0]!.finish(true, () => page.host.api.register_sink("caret", page.recording_sink("caret", [])));
  await page.settle();
  assert.deepEqual(page.events, ["caret sink enter"]);
});

test("a sink entered again after it exited gets one more enter and one more exit", () => {
  const page = make_page();
  page.host.api.register_sink("caret", page.recording_sink("caret", []));
  page.press("V", "<Escape>", "V", "<Escape>");
  assert.deepEqual(page.events.filter((event) => event.includes("enter") || event.includes("exit")), [
    "caret sink enter", "caret sink exit to normal", "caret sink enter", "caret sink exit to normal",
  ]);
});

test("exit names the mode the page went to, whichever way it left", () => {
  const page = make_page();
  page.host.api.register_sink("caret", page.recording_sink("caret", []));
  page.host.api.register_sink("visual", page.recording_sink("visual", []));
  page.press("V");
  page.state.set_mode("visual");
  page.state.set_mode("caret");
  // A command such as `:` takes the page to the command line mode.
  page.state.set_mode("cmdline");
  assert.deepEqual(page.events, [
    "caret sink enter", "caret sink exit to visual", "visual sink enter", "visual sink exit to caret", "caret sink enter", "caret sink exit to cmdline",
  ]);
});

test("a page that hides leaves the mode with exit page_hidden, once, and returns to normal", () => {
  const page = make_page();
  page.host.api.register_sink("caret", page.recording_sink("caret", []));
  page.press("V");
  page.host.page_hidden();
  page.host.page_hidden();
  assert.equal(page.state.get_mode(), "normal");
  assert.deepEqual(page.events, ["caret sink enter", "caret sink exit to page_hidden"]);
  page.press("V");
  assert.deepEqual(page.events.slice(2), ["caret sink enter"]);
});

test("a page that hides in a mode without a sink is left alone", () => {
  const page = make_page();
  page.state.set_mode("insert");
  page.host.page_hidden();
  assert.equal(page.state.get_mode(), "insert");
});

test("a bundle shows a toast through the host, and the error path takes it when the page gave no toast", () => {
  const page = make_page();
  page.host.api.show_toast("Copied x");
  assert.deepEqual(page.toasts, ["Copied x"]);
  const bare = create_bundle_host();
  const shown: string[] = [];
  bare.connect({ request_bundle: async () => true, on_idle: () => {}, show_error: (message) => shown.push(message), set_mode: () => {}, on_sink_missing: () => {} });
  bare.api.show_toast("hello");
  assert.deepEqual(shown, ["hello"]);
});
