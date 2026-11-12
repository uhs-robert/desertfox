import assert from "node:assert/strict";
import { test } from "node:test";
import { create_bundle_host } from "../../../src/content/bundle_host.ts";
import { create_find_mode } from "../../../src/content/caret/find_mode.ts";
import { CHAR_FIND_NAMES, SEARCH_NAMES } from "../../../src/content/caret/find_paint.ts";
import { create_key_flow } from "../../../src/content/key_flow.ts";
import { create_mode_state } from "../../../src/content/mode_state.ts";
import { create_matcher } from "../../../src/shared/keys/index.ts";
import { ANY_KEY, LIVE_KEY } from "../../../src/shared/prefix_tree.ts";
import { COMPILED_KEYMAP_VERSION } from "../../../src/shared/index.ts";
import type { CompiledKeymap, TreeNode } from "../../../src/shared/index.ts";

const leaf = (id: string, args: Record<string, unknown> = {}, count_rule: "repeat" | "ignore" = "ignore", capture?: string): TreeNode => ({ kind: "leaf", steps: [{ invocation: { id, args }, runs_in: capture ? "background" : "content", count_rule, ...(capture && { capture }) }] });
const move = (args: Record<string, unknown>) => leaf("caret.move", args, "repeat");
// What the compiler builds for a binding that leaves out its `key` param.
// The live child repeats the find the way round of the binding's own direction.
const find = (args: Record<string, unknown>): TreeNode => ({
  kind: "branch",
  children: { [ANY_KEY]: leaf("caret.find", { direction: "forward", till: false, count: 1, ...args }, "ignore", "char"), [LIVE_KEY]: move({ unit: "find_repeat", direction: args.direction ?? "forward" }) },
});

const keymap: CompiledKeymap = {
  format_version: COMPILED_KEYMAP_VERSION,
  mode_indicator: "always",
  which_key_delay_ms: 0, toast_ms: 3000, toast_error_ms: 6000,
  modes: {
    normal: { kind: "branch", children: { V: leaf("mode.set", { mode: "caret" }) } },
    caret: {
      kind: "branch",
      children: {
        f: find({}),
        F: find({ direction: "back" }),
        t: find({ till: true }),
        l: move({ unit: "char" }),
        ";": move({ unit: "find_repeat" }),
        ",": move({ unit: "find_repeat", direction: "back" }),
        x: leaf("log_x"),
        "<Escape>": leaf("mode.escape"),
      },
    },
  },
};

// A page wired as main.ts wires it, with the caret bundle's find mode and the same handler contract. A key layer find reaches its handler after a round trip through the background, which the test takes as a later turn of the event loop.
function make_page() {
  const state = create_mode_state();
  const host = create_bundle_host();
  const log: string[] = [];
  let watching = 0;
  let watchers_added = 0;
  const show_calls = { count: 0 };
  const views: Array<{ colors: string | undefined; current: number | undefined }> = [];
  let palette = 0;
  let color_reads = 0;
  const find_mode = create_find_mode<string>({
    read_colors_: async () => (color_reads++, `palette ${palette}`),
    show: (view) => {
      show_calls.count++;
      views.push({ colors: view.colors, current: view.current });
    },
    hide: () => log.push("hide"),
    watch_view_: () => {
      watching++;
      watchers_added++;
      return () => void watching--;
    },
  });
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
    run_leaf_: (matched, count) => {
      const { id, args } = matched.steps[0]!.invocation;
      if (id === "mode.set") state.set_mode_(args?.mode as never);
      else if (id === "mode.escape") state.escape();
      else if (id === "caret.find") setImmediate(() => void host.run_command_("caret.find", "caret", { ...args, count: count ?? 1 }, ""));
      else if (id === "caret.move") for (let step = 0; step < (count ?? 1); step++) void host.run_command_("caret.move", "caret", args ?? {}, "");
      else log.push(`key ${id}`);
    },
  });
  state.listen((mode) => {
    flow.reset_sequence_();
    host.enter_mode_(mode);
  });
  host.connect({
    request_bundle_: async () => true,
    on_idle_: flow.release,
    hold_first_: flow.hold_first_,
    set_mode_: state.set_mode_,
    show_error_: () => {},
    show_toast_: () => {},
  });
  flow.set_matcher_(create_matcher(keymap));
  host.api.register_sink_("caret", {
    enter: () => {},
    live_: find_mode.is_live_,
    on_token_: (token) => (find_mode.is_live_() ? find_mode.on_token_(token) : "pass"),
    exit: () => find_mode.end(),
  });
  host.api.register_handler_("caret.find", (args) => {
    find_mode.start();
    log.push(`find ${args.char} x${args.count}`);
  });
  host.api.register_handler_("caret.move", (args) => {
    if (args.unit === "find_repeat") return void log.push(args.direction === "back" ? "repeat ," : "repeat ;");
    find_mode.end();
    log.push(`move ${args.unit}`);
  });
  const press = (...tokens: string[]) => tokens.map((token) => flow.handle_token_(token));
  // A tick of the event loop runs every microtask and the awaits of a count.
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const start_caret = async () => {
    state.set_mode_("normal");
    state.set_mode_("caret");
    await settle();
    log.length = 0;
  };
  const start_find = async () => {
    await start_caret();
    find_mode.start();
    await settle();
  };
  return { state, find_mode, log, views, set_palette: (value: number) => (palette = value), color_reads: () => color_reads, press, settle, start_caret, start_find, show_calls, watch: () => ({ watching, watchers_added }), hides: () => log.filter((entry) => entry === "hide").length };
}

test("a find key keeps the find alive until its handler runs, after the round trip", async () => {
  const page = make_page();
  await page.start_caret();
  page.press("f", "x");
  await page.settle();
  assert.deepEqual(page.log, ["find x x1"]);
  assert.equal(page.find_mode.is_live_(), true);
  assert.equal(page.hides(), 0);
});

test("a count before f reaches the handler as one call with the count", async () => {
  const page = make_page();
  await page.start_caret();
  page.press("3", "f", "x");
  await page.settle();
  assert.deepEqual(page.log, ["find x x3"]);
  assert.equal(page.find_mode.is_live_(), true);
});

test("; keeps the find alive", async () => {
  const page = make_page();
  await page.start_find();
  page.press(";");
  await page.settle();
  assert.deepEqual(page.log, ["repeat ;"]);
  assert.equal(page.find_mode.is_live_(), true);
});

test("a new find after Escape keeps the view listener of a find that is gone and starts a fresh one", async () => {
  const page = make_page();
  await page.start_find();
  page.press("<Escape>", "t", "y");
  await page.settle();
  assert.deepEqual(page.log, ["hide", "find y x1"]);
  assert.equal(page.find_mode.is_live_(), true);
  assert.deepEqual(page.watch(), { watching: 1, watchers_added: 2 });
});

test("while a find is live its key repeats it in the same key press, with no wait for a target", async () => {
  const page = make_page();
  await page.start_find();
  assert.deepEqual(page.press("f"), ["cancel"]);
  assert.deepEqual(page.log, ["repeat ;"]);
  assert.equal(page.find_mode.is_live_(), true);
  page.press("x");
  await page.settle();
  assert.deepEqual(page.log, ["repeat ;", "key log_x"]);
});

test("the opposite key reverses, and t repeats the find of any kind", async () => {
  const page = make_page();
  await page.start_find();
  page.press("F", "t");
  assert.deepEqual(page.log, ["repeat ,", "repeat ;"]);
  assert.equal(page.find_mode.is_live_(), true);
});

test("a count with a live find repeats it that many times and keeps it live", async () => {
  const page = make_page();
  await page.start_find();
  page.press("3", "f");
  assert.deepEqual(page.log, ["repeat ;", "repeat ;", "repeat ;"]);
  assert.equal(page.find_mode.is_live_(), true);
});

test("a repeat and ; and , keep the find live, and nothing hides", async () => {
  const page = make_page();
  await page.start_find();
  page.press("f", ";", ",", "F");
  await page.settle();
  assert.deepEqual(page.log, ["repeat ;", "repeat ;", "repeat ,", "repeat ,"]);
  assert.equal(page.find_mode.is_live_(), true);
  assert.equal(page.hides(), 0);
});

test("with no find live f waits for a target, also after Escape and after a motion ended the find", async () => {
  const page = make_page();
  await page.start_find();
  page.press("l");
  page.press("f");
  assert.deepEqual(page.log, ["hide", "move char"]);
  page.press("a");
  await page.settle();
  assert.deepEqual(page.log, ["hide", "move char", "find a x1"]);
});

test("Escape ends the live state, so the next f captures a target", async () => {
  const page = make_page();
  await page.start_find();
  page.press("<Escape>", "f", "z");
  await page.settle();
  assert.deepEqual(page.log, ["hide", "find z x1"]);
});

test("leaving the mode ends the live state", async () => {
  const page = make_page();
  await page.start_find();
  page.state.set_mode_("normal");
  page.state.set_mode_("caret");
  await page.settle();
  page.log.length = 0;
  page.press("f", "q");
  await page.settle();
  assert.deepEqual(page.log, ["find q x1"]);
});

test("a caret command that is not a find ends the find once", async () => {
  const page = make_page();
  await page.start_find();
  page.press("l");
  await page.settle();
  assert.deepEqual(page.log, ["hide", "move char"]);
  assert.equal(page.find_mode.is_live_(), false);
});

test("a key that binds nothing in the caret keymap keeps the find", async () => {
  const page = make_page();
  await page.start_find();
  page.press("x");
  await page.settle();
  assert.deepEqual(page.log, ["key log_x"]);
  assert.equal(page.find_mode.is_live_(), true);
  page.press("q");
  await page.settle();
  assert.equal(page.find_mode.is_live_(), true);
});

test("a first find is not live in the gap between the target key and the handler, so a second f there still waits for a target", async () => {
  const page = make_page();
  await page.start_caret();
  page.press("f", "x");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(page.find_mode.is_live_(), false);
  assert.deepEqual(page.log, []);
  await page.settle();
  assert.deepEqual(page.log, ["find x x1"]);
  assert.equal(page.find_mode.is_live_(), true);
});

test("Escape ends the find, is spent and leaves the mode", async () => {
  const page = make_page();
  await page.start_find();
  assert.deepEqual(page.press("<Escape>"), ["cancel"]);
  await page.settle();
  assert.deepEqual(page.log, ["hide"]);
  assert.equal(page.state.get_mode_(), "caret");
});

test("Escape while f waits for its target drops the wait, and the next Escape leaves caret mode", async () => {
  const page = make_page();
  await page.start_caret();
  page.press("f");
  assert.deepEqual(page.press("<Escape>"), ["cancel"]);
  await page.settle();
  assert.equal(page.state.get_mode_(), "caret");
  assert.deepEqual(page.log, []);
  page.press("<Escape>");
  await page.settle();
  assert.equal(page.state.get_mode_(), "normal");
});

test("a mode change ends the find once", async () => {
  const page = make_page();
  await page.start_find();
  page.state.set_mode_("normal");
  await page.settle();
  assert.equal(page.hides(), 1);
  assert.equal(page.find_mode.is_live_(), false);
});

test("a key that ends the find and a mode change together still end it once", async () => {
  const page = make_page();
  await page.start_find();
  page.state.set_mode_("normal");
  page.press("l");
  await page.settle();
  assert.equal(page.hides(), 1);
});

test("the view listener is added once per find and removed when it ends", async () => {
  const page = make_page();
  await page.start_find();
  assert.deepEqual(page.watch(), { watching: 1, watchers_added: 1 });
  page.find_mode.start();
  page.press("f", "F");
  await page.settle();
  assert.deepEqual(page.watch(), { watching: 1, watchers_added: 1 });
  page.press("l");
  await page.settle();
  assert.deepEqual(page.watch(), { watching: 0, watchers_added: 1 });
  page.find_mode.start();
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

test("a new find starts with no current match, even after a find that had one", async () => {
  const page = make_page();
  await page.start_find();
  page.find_mode.set_current_(42, "model");
  page.find_mode.refresh();
  assert.equal(page.views.at(-1)!.current, 42);
  // A new target that finds nothing sets no current match, so the old one must not linger.
  page.find_mode.start();
  page.find_mode.refresh();
  assert.equal(page.views.at(-1)!.current, undefined);
});

test("every new find reads the colors again, and ; does not", async () => {
  const page = make_page();
  page.set_palette(1);
  await page.start_find();
  assert.equal(page.color_reads(), 1);
  assert.equal(page.views.at(-1)!.colors, "palette 1");
  page.press(";", ";");
  await page.settle();
  page.find_mode.refresh();
  assert.equal(page.color_reads(), 1);
  // The palette changed while the find stayed live: the next target picks it up.
  page.set_palette(2);
  page.find_mode.start();
  await page.settle();
  assert.equal(page.color_reads(), 2);
  assert.equal(page.views.at(-1)!.colors, "palette 2");
});

test("colors that arrive after the find ended draw nothing", async () => {
  const page = make_page();
  page.state.set_mode_("caret");
  await page.settle();
  const before = page.show_calls.count;
  page.find_mode.start();
  page.find_mode.end();
  await page.settle();
  assert.equal(page.show_calls.count, before);
});
