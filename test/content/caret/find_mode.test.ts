import assert from "node:assert/strict";
import { test } from "node:test";
import { create_bundle_host } from "../../../src/content/bundle_host.ts";
import { create_find_mode } from "../../../src/content/caret/find_mode.ts";
import { CHAR_FIND_NAMES, SEARCH_NAMES } from "../../../src/content/caret/find_paint.ts";
import { create_key_flow } from "../../../src/content/key_flow.ts";
import { create_mode_state } from "../../../src/content/mode_state.ts";
import { create_matcher } from "../../../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_VERSION } from "../../../src/shared/index.ts";
import type { CompiledKeymap, TreeNode } from "../../../src/shared/index.ts";

const leaf = (id: string, args: Record<string, unknown> = {}, count_rule: "repeat" | "ignore" = "ignore"): TreeNode => ({ kind: "leaf", steps: [{ invocation: { id, args }, runs_in: "content", count_rule }] });
const move = (args: Record<string, unknown>) => leaf("caret.move", args, "repeat");

const keymap: CompiledKeymap = {
  format_version: COMPILED_KEYMAP_VERSION,
  mode_indicator: "always",
  which_key_delay_ms: 0,
  modes: {
    normal: { kind: "branch", children: { V: leaf("mode.set", { mode: "caret" }) } },
    caret: {
      kind: "branch",
      children: {
        f: move({ unit: "char_find" }),
        F: move({ unit: "char_find", direction: "back" }),
        t: move({ unit: "char_find", till: true }),
        ";": move({ unit: "find_repeat" }),
        x: leaf("log_x"),
        "<Escape>": leaf("mode.escape"),
      },
    },
  },
};

// A page wired as main.ts wires it, with the caret bundle's find mode and the same handler contract: a find key calls `note_find_key` first, in the turn of the key press.
function make_page() {
  const state = create_mode_state();
  const host = create_bundle_host();
  const log: string[] = [];
  let watching = 0;
  let watchers_added = 0;
  const show_calls = { count: 0 };
  const find_mode = create_find_mode({
    show: () => void show_calls.count++,
    hide: () => log.push("hide"),
    watch_view: () => {
      watching++;
      watchers_added++;
      return () => void watching--;
    },
    defer: queueMicrotask,
  });
  let armed = false;
  const flow = create_key_flow({
    get_mode: state.get_mode,
    take_pass_next: state.take_pass_next,
    in_editable_field: () => false,
    is_loading: host.is_loading,
    sink_of: host.sink_of,
    on_prefix: () => {},
    leave_insert: () => state.escape(),
    run_leaf: (matched, count) => {
      const { id, args } = matched.steps[0]!.invocation;
      if (id === "mode.set") state.set_mode(args?.mode as never);
      else if (id === "mode.escape") state.escape();
      else if (id === "caret.move") {
        // As run_content does: the first call runs in this turn, the rest after an await.
        void (async () => {
          for (let time = 0; time < (count ?? 1); time++) await host.run_command("caret.move", "caret", args ?? {}, "");
        })();
      } else log.push(`key ${id}`);
    },
  });
  state.listen((mode) => {
    flow.reset_sequence();
    host.enter_mode(mode);
  });
  host.connect({
    request_bundle: async () => true,
    on_idle: flow.release,
    set_mode: state.set_mode,
    show_error: () => {},
    show_toast: () => {},
    on_sink_missing: () => state.set_mode("normal"),
  });
  flow.set_matcher(create_matcher(keymap));
  host.api.register_sink("caret", {
    enter: () => {},
    on_token: (token) => (armed ? ((armed = false), "handled") : find_mode.is_live() ? find_mode.on_token(token) : "pass"),
    exit: () => find_mode.end(),
  });
  host.api.register_handler("caret.move", (args) => {
    find_mode.note_find_key();
    if (args.unit === "find_repeat") return void log.push("repeat ;");
    const till = args.till === true;
    if (find_mode.is_live() && find_mode.is_till() === till) return void log.push(`repeat ${args.direction ?? "forward"}`);
    find_mode.end();
    armed = true;
    log.push("armed");
  });
  const press = (...tokens: string[]) => tokens.map((token) => flow.handle_token(token));
  // A tick of the event loop runs every microtask and the awaits of a count.
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const start_find = async (till = false) => {
    state.set_mode("normal");
    state.set_mode("caret");
    await settle();
    find_mode.start(till);
    log.length = 0;
  };
  return { state, find_mode, log, press, settle, start_find, show_calls, watch: () => ({ watching, watchers_added }), hides: () => log.filter((entry) => entry === "hide").length };
}

test("the same key family repeats and keeps the find alive past the microtask", async () => {
  const page = make_page();
  await page.start_find();
  page.press("f");
  await page.settle();
  page.press("F");
  await page.settle();
  assert.deepEqual(page.log, ["repeat forward", "repeat back"]);
  assert.equal(page.find_mode.is_live(), true);
  assert.equal(page.hides(), 0);
});

test("a count digit before a find key keeps the find and the key repeats once per count", async () => {
  const page = make_page();
  await page.start_find();
  page.press("3");
  await page.settle();
  assert.equal(page.find_mode.is_live(), true);
  page.press("f");
  await page.settle();
  assert.deepEqual(page.log, ["repeat forward", "repeat forward", "repeat forward"]);
  assert.equal(page.find_mode.is_live(), true);
  assert.equal(page.hides(), 0);
});

test("a multi-digit count keeps the find, and a lone zero ends it", async () => {
  const page = make_page();
  await page.start_find();
  page.press("1", "0", "f");
  await page.settle();
  assert.equal(page.find_mode.is_live(), true);
  assert.equal(page.log.length, 10);
  page.press("0");
  await page.settle();
  assert.equal(page.find_mode.is_live(), false);
  assert.equal(page.hides(), 1);
});

test("; keeps the find alive", async () => {
  const page = make_page();
  await page.start_find();
  page.press(";");
  await page.settle();
  assert.deepEqual(page.log, ["repeat ;"]);
  assert.equal(page.find_mode.is_live(), true);
});

test("the other family ends the find once and arms its own", async () => {
  const page = make_page();
  await page.start_find(false);
  page.press("t");
  await page.settle();
  assert.deepEqual(page.log, ["hide", "armed"]);
  assert.equal(page.find_mode.is_live(), false);
});

test("another key ends the find once and still runs", async () => {
  const page = make_page();
  await page.start_find();
  page.press("x");
  assert.equal(page.find_mode.is_live(), true, "the end waits for the microtask");
  await page.settle();
  assert.deepEqual(page.log, ["key log_x", "hide"]);
  assert.equal(page.find_mode.is_live(), false);
});

test("Escape ends the find, is spent and leaves the mode", async () => {
  const page = make_page();
  await page.start_find();
  assert.deepEqual(page.press("<Escape>"), ["cancel"]);
  await page.settle();
  assert.deepEqual(page.log, ["hide"]);
  assert.equal(page.state.get_mode(), "caret");
});

test("a mode change ends the find once", async () => {
  const page = make_page();
  await page.start_find();
  page.state.set_mode("normal");
  await page.settle();
  assert.equal(page.hides(), 1);
  assert.equal(page.find_mode.is_live(), false);
});

test("a key that ends the find and a mode change together still end it once", async () => {
  const page = make_page();
  await page.start_find();
  page.state.set_mode("normal");
  page.press("x");
  await page.settle();
  assert.equal(page.hides(), 1);
});

test("the view listener is added once per find and removed when it ends", async () => {
  const page = make_page();
  await page.start_find();
  assert.deepEqual(page.watch(), { watching: 1, watchers_added: 1 });
  page.find_mode.start(false);
  page.press("f", "F");
  await page.settle();
  assert.deepEqual(page.watch(), { watching: 1, watchers_added: 1 });
  page.press("x");
  await page.settle();
  assert.deepEqual(page.watch(), { watching: 0, watchers_added: 1 });
  page.find_mode.start(true);
  assert.deepEqual(page.watch(), { watching: 1, watchers_added: 2 });
  page.find_mode.end();
  page.find_mode.end();
  assert.equal(page.watch().watching, 0);
  assert.equal(page.hides(), 2);
});

test("a refresh after the end paints nothing", async () => {
  const page = make_page();
  await page.start_find();
  const before = page.show_calls.count;
  page.find_mode.refresh();
  assert.equal(page.show_calls.count, before + 1);
  page.find_mode.end();
  page.find_mode.refresh();
  assert.equal(page.show_calls.count, before + 1);
});

test("the character find paints under names of its own", () => {
  assert.notEqual(CHAR_FIND_NAMES.all, SEARCH_NAMES.all);
  assert.notEqual(CHAR_FIND_NAMES.current, SEARCH_NAMES.current);
  assert.notEqual(CHAR_FIND_NAMES.all, SEARCH_NAMES.current);
  assert.notEqual(CHAR_FIND_NAMES.current, SEARCH_NAMES.all);
});
