// The `key` param type: the validator, the command line, the compiled capture leaf, the matcher, the key flow and the which-key row.

import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { panel_after_prefix } from "../src/background/list_keys.ts";
import { create_key_flow } from "../src/content/key_flow.ts";
import { create_mode_state } from "../src/content/mode_state.ts";
import type { CommandMeta } from "../src/shared/command.ts";
import { create_router } from "../src/background/router.ts";
import { build_help_model } from "../src/help/model.ts";
import { key_labels } from "../src/cmdline/completion/keys.ts";
import { ANY_KEY, token_label } from "../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch, TreeLeaf } from "../src/shared/prefix_tree.ts";
import { create_matcher } from "../src/shared/keys/index.ts";
import { check_args } from "../src/shared/registry/check_args.ts";
import { parse_command_line } from "../src/shared/registry/command_line.ts";
import { DefineError } from "../src/shared/registry/define.ts";
import { print_command } from "../src/shared/registry/print_command.ts";
import { usage_line } from "../src/shared/registry/usage.ts";
import { make_fake } from "./background/fakes.ts";

const mark_input = {
  label: "Add mark",
  intent: "Save a mark under the next key.",
  name: "markadd",
  params: [{ name: "slot", type: "key" as const, pattern: "^[a-zA-Z]$" }],
  runs_in: "background" as const,
  count: "ignore" as const,
  run: () => {},
};
const wait_input = {
  label: "Wait",
  intent: "Wait for something.",
  params: [{ name: "slot", type: "key" as const }, { name: "mode", type: "enum" as const, values: ["a", "b"], default: "a" }],
  runs_in: "background" as const,
  count: "repeat" as const,
  run: () => {},
};
const scroll_input = { label: "Down", intent: "Scroll down.", runs_in: "background" as const, run: () => {} };

const { registry } = make_fake({ "test.mark": mark_input, "test.wait": wait_input, "test.down": scroll_input });
const mark = registry.get("test.mark")!;

function compiled(normal: Record<string, unknown>) {
  const config = { ...empty_config(), keymap: { normal } as never };
  return compile_config({ config, default_keymap: {}, get_command: (id) => registry.get(id), enum_sources: {} });
}

test("check_args takes exactly one key and applies a pattern", () => {
  assert.deepEqual(check_args(mark, { slot: "a" }), { ok: true, args: { slot: "a" } });
  assert.equal(check_args(mark, { slot: "ab" }).ok, false);
  assert.equal(check_args(mark, { slot: "1" }).ok, false);
  assert.equal(check_args(mark, { slot: "" }).ok, false);
  assert.deepEqual(check_args(mark, {}), { ok: false, error: "missing <slot>", missing_param: "slot" });
});

test("define allows one key param per command", () => {
  assert.throws(() => make_fake({ "t.two": { ...wait_input, params: [{ name: "a", type: "key" }, { name: "b", type: "key" }] } }), DefineError);
  assert.throws(() => make_fake({ "t.opt": { ...wait_input, params: [{ name: "a", type: "key", optional: true }] } }), DefineError);
});

test("the command line takes the key as a bare word, usage and print agree", () => {
  const parsed = parse_command_line(registry, "markadd a");
  assert.deepEqual(parsed, { kind: "invocation", invocation: { id: "test.mark", args: { slot: "a" } } });
  assert.equal(usage_line(mark), "markadd <slot>");
  assert.equal(print_command(mark, { slot: "a" }), "markadd a");
  assert.equal(print_command(mark, { slot: "-" }), "markadd -");
  const dash = parse_command_line(registry, "markadd -");
  assert.deepEqual(dash.kind === "invocation" && dash.invocation.args, { slot: "-" });
});

test("a binding that leaves the key out compiles to a capture leaf run by the router", () => {
  const { compiled: tree, warnings } = compiled({ m: { id: "test.mark" }, w: { id: "test.wait", args: { mode: "b" } }, x: { id: "test.wait", args: { mode: "zz" } }, j: { id: "test.down" } });
  const children = tree.modes.normal!.children;
  const under = (key: string) => (children[key] as TreeBranch).children[ANY_KEY] as TreeLeaf;
  assert.equal(under("m").steps[0]!.capture, "slot");
  assert.equal(under("m").steps[0]!.runs_in, "background");
  assert.equal((children.m as TreeBranch).label, "Add mark");
  assert.equal(under("w").steps[0]!.capture, "slot");
  assert.equal(tree.modes.normal!.children.x, undefined);
  assert.equal((children.j as TreeLeaf).steps[0]!.capture, undefined);
  assert.equal(warnings.filter((warning) => warning.includes("zz")).length, 1);
});

test("a Firefox shortcut binding cannot capture", () => {
  const config = { ...empty_config(), keymap: { browser: { "<A-m>": { id: "test.mark" } } } as never };
  const { compiled: tree, warnings } = compile_config({ config, default_keymap: {}, get_command: (id) => registry.get(id), enum_sources: {} });
  assert.equal(tree.modes.browser, undefined);
  assert.equal(warnings.filter((warning) => warning.includes("key press")).length, 1);
});

test("a binding that sets the key has no capture", () => {
  const { compiled: tree } = compiled({ m: { id: "test.mark", args: { slot: "a" } } });
  assert.equal((tree.modes.normal!.children.m as TreeLeaf).steps[0]!.capture, undefined);
  assert.equal(tree.modes.normal!.children.m!.kind, "leaf");
});

const capture_tree = (): CompiledKeymap => compiled({ m: { id: "test.mark" }, w: { id: "test.wait" }, "<Escape>": { id: "test.down" }, gg: { id: "test.down" }, j: { id: "test.down" } }).compiled;
const slot_of = (result: ReturnType<ReturnType<typeof create_matcher>["feed"]>) => (result.kind === "match" ? result.leaf.steps[0]!.invocation.args?.slot : undefined);

test("the matcher fills the key param from the next printable token", () => {
  const matcher = create_matcher(capture_tree());
  assert.equal(matcher.feed("normal", "m").kind, "pending");
  const result = matcher.feed("normal", "x");
  assert.equal(slot_of(result), "x");
});

test("a capture key that is itself a prefix is a value, not a step in the tree", () => {
  const matcher = create_matcher(capture_tree());
  matcher.feed("normal", "m");
  assert.equal(slot_of(matcher.feed("normal", "g")), "g");
  assert.equal(matcher.feed("normal", "g").kind, "pending");
  // The tree is back at its root: `j` is a plain key.
  assert.equal(matcher.feed("normal", "j").kind, "match");
});

test("a count before the capturing key reaches the match", () => {
  const matcher = create_matcher(capture_tree());
  matcher.feed("normal", "5");
  assert.equal(matcher.feed("normal", "m").kind, "pending");
  const result = matcher.feed("normal", "q");
  assert.equal(result.kind === "match" && result.count, 5);
  assert.equal(slot_of(result), "q");
  // The count does not leak into the next sequence.
  const next = matcher.feed("normal", "j");
  assert.equal(next.kind === "match" && next.count, undefined);
});

test("Escape ends a pending capture and runs as a first key", () => {
  const matcher = create_matcher(capture_tree());
  matcher.feed("normal", "m");
  const result = matcher.feed("normal", "<Escape>");
  assert.equal(result.kind === "match" && result.leaf.steps[0]!.invocation.id, "test.down");
  assert.equal(matcher.feed("normal", "j").kind, "match");
  // A second Escape does not find a stale capture.
  matcher.feed("normal", "m");
  matcher.feed("normal", "<Escape>");
  assert.equal(slot_of(matcher.feed("normal", "a")), undefined);
});

test("a chord or named key does not fill the param", () => {
  const matcher = create_matcher(capture_tree());
  matcher.feed("normal", "m");
  assert.equal(matcher.feed("normal", "<C-a>").kind, "no_match");
  matcher.feed("normal", "m");
  assert.equal(matcher.feed("normal", "<Tab>").kind, "no_match");
});

test("a space fills the key param as a space character", () => {
  const matcher = create_matcher(capture_tree());
  matcher.feed("normal", "m");
  assert.equal(slot_of(matcher.feed("normal", "<Space>")), " ");
});

test("a mode change drops a pending capture", () => {
  const tree = capture_tree();
  tree.modes.visual = tree.modes.normal!;
  const matcher = create_matcher(tree);
  matcher.feed("normal", "m");
  assert.equal(slot_of(matcher.feed("visual", "a")), undefined);
});

test("binds_after_ reads ahead through a capture and leaves the walk as it was", () => {
  const matcher = create_matcher(capture_tree());
  matcher.feed("normal", "m");
  assert.equal(matcher.binds_after_("normal", [], "z"), true);
  assert.equal(slot_of(matcher.feed("normal", "z")), "z");
  assert.equal(matcher.binds_after_("normal", ["m"], "z"), true);
  assert.equal(matcher.feed("normal", "q").kind, "no_match");
});

function make_flow() {
  const state = create_mode_state();
  const ran: string[] = [];
  const prefixes: (string[] | undefined)[] = [];
  const flow = create_key_flow({
    in_editable_field_: () => false,
    escape_to_page_: () => false,
    get_mode_: state.get_mode_,
    take_pass_next_: state.take_pass_next_,
    run_leaf_: (leaf, count) => ran.push(`${leaf.steps[0]?.invocation.id}:${leaf.steps[0]?.invocation.args?.slot ?? ""}:${count ?? ""}`),
    leave_insert_: () => state.escape(),
    is_loading_: () => false,
    loading_sink_bundles_: () => [],
    sink_of_: () => undefined,
    on_prefix_: (prefix) => void prefixes.push(prefix?.typed_),
  });
  flow.set_matcher_(create_matcher(capture_tree()));
  return { flow, ran, prefixes };
}

test("key flow runs the leaf with the captured key and count, and cancels both keys", () => {
  const { flow, ran } = make_flow();
  assert.equal(flow.handle_token_("3"), "cancel");
  assert.equal(flow.handle_token_("m"), "cancel");
  assert.equal(flow.handle_token_("g"), "cancel");
  assert.deepEqual(ran, ["test.mark:g:3"]);
});

test("key flow: Escape during a capture hides the panel and drops only the capture, and a second Escape runs the Escape binding", () => {
  const { flow, ran, prefixes } = make_flow();
  flow.handle_token_("m");
  assert.deepEqual(prefixes.at(-1), ["m"]);
  assert.equal(flow.handle_token_("<Escape>"), "cancel");
  assert.deepEqual(ran, []);
  assert.equal(prefixes.at(-1), undefined);
  flow.handle_token_("<Escape>");
  assert.deepEqual(ran, ["test.down::"]);
  // The next key is a plain key again.
  flow.handle_token_("j");
  assert.equal(ran.length, 2);
});

test("key flow: which-key follows the capture and a Backspace returns to the keys before it", () => {
  const { flow, ran, prefixes } = make_flow();
  flow.handle_token_("m");
  assert.deepEqual(prefixes.at(-1), ["m"]);
  flow.handle_token_("<Backspace>");
  assert.equal(prefixes.at(-1), undefined);
  assert.deepEqual(ran, []);
  flow.handle_token_("m");
  flow.handle_token_("a");
  assert.deepEqual(ran, ["test.mark:a:"]);
  assert.equal(prefixes.at(-1), undefined);
});

const commands: Record<string, CommandMeta> = { "test.mark": { id: "test.mark", label: "Add mark", intent: "Save a mark under the next key." } };

test("which-key shows one row that names the wait", () => {
  const tree = capture_tree().modes.normal!;
  const panel = panel_after_prefix(tree, ["m"], (id) => commands[id]);
  assert.deepEqual(panel.title, ["+Add mark"]);
  assert.deepEqual(panel.rows, [{ keys: "<key>", command: "Add mark", description: "Save a mark under the next key.", more: false }]);
  assert.deepEqual(panel_after_prefix(tree, ["j"], (id) => commands[id]).rows, []);
});

test("the help page and the command line hints write a capture binding as m<key>", () => {
  const { compiled: tree } = compiled({ m: { id: "test.mark" } });
  const metas = registry.list().map((command) => ({ id: command.id, name: command.name, label: command.label, intent: command.intent, params: command.params }));
  const model = build_help_model(metas as CommandMeta[], tree, []);
  const row = model.groups.flatMap((group) => group.commands).find((command) => command.id === "test.mark")!;
  assert.deepEqual(row.keys.map((keys) => keys.keys), ["m<key>"]);
  assert.equal(key_labels(tree, metas as CommandMeta[], "normal").get("test.mark"), undefined);
  assert.equal(token_label(ANY_KEY), "<key>");
});

test("the router refuses a key the pattern rejects, repeats a content command by the count and hands it to the tab", async () => {
  const { registry: reg, deps, log } = make_fake({
    "test.mark": mark_input,
    "test.paint": { label: "Paint", intent: "Paint.", params: [{ name: "slot", type: "key" as const, pattern: "^[a-z]$" }], runs_in: "content" as const, count: "repeat" as const },
  });
  const config = { ...empty_config(), keymap: { normal: { m: { id: "test.mark" }, p: { id: "test.paint" } } } as never };
  const { compiled: tree } = compile_config({ config, default_keymap: {}, get_command: (id) => reg.get(id), enum_sources: {} });
  const run = async (keys: string[]) => {
    const matcher = create_matcher(tree);
    const results = keys.map((key) => matcher.feed("normal", key));
    const last = results.at(-1)!;
    assert.equal(last.kind, "match");
    const match = last as Extract<typeof last, { kind: "match" }>;
    return create_router(deps).run({ invocations: match.leaf.steps.map((step) => ({ ...step.invocation, ...(match.count === undefined ? {} : { count: match.count }) })), mode: "normal" });
  };
  assert.equal((await run(["m", "1"])).ok, false);
  assert.deepEqual(log, ['refuse 7 slot expects text matching ^[a-zA-Z]$, got "1"']);
  assert.equal((await run(["3", "p", "x"])).ok, true);
  const one = { id: "test.paint", args: { slot: "x" } };
  assert.deepEqual(log.slice(1), [`send 7 ${JSON.stringify({ type: "run_in_content", invocations: [one, one, one] })}`]);
  assert.equal((await run(["p", "X"])).ok, false);
});
