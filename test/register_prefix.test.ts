// The `"<reg>` prefix: the compiled flag, the matcher state beside the count, the key flow, which-key and the background half of a yank.

import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { list_keys } from "../src/background/list_keys.ts";
import { answer_register_request, create_register_store } from "../src/background/register_store.ts";
import { create_key_flow } from "../src/content/key_flow.ts";
import { create_mode_state } from "../src/content/mode_state.ts";
import { create_matcher } from "../src/shared/keys/index.ts";
import type { MatchResult } from "../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch } from "../src/shared/prefix_tree.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { make_fake } from "./background/fakes.ts";

const yank_input = {
  label: "Yank",
  intent: "Yank.",
  params: [{ name: "register", type: "string" as const, optional: true }],
  runs_in: "background" as const,
  modes: ["normal", "caret"] as const,
  count: "repeat" as const,
  run: () => {},
};
const plain_input = { label: "Down", intent: "Down.", runs_in: "background" as const, modes: ["normal", "caret", "insert"] as const, run: () => {} };
const { registry: fake } = make_fake({ "test.yank": yank_input, "test.down": plain_input });

function tree_of(normal: Record<string, unknown>): CompiledKeymap {
  const config = { ...empty_config(), keymap: { normal, caret: structuredClone(normal), insert: { j: { id: "test.down" } } } as never };
  return compile_config({ config, default_keymap: {}, get_command: (id) => fake.get(id), enum_sources: {} }).compiled;
}

const tree = () => tree_of({ y: { id: "test.yank" }, x: { id: "test.yank", args: { register: "z" } }, j: { id: "test.down" }, gg: { id: "test.down" }, "<Escape>": { id: "test.down" } });
// A binding that no register reached keeps the empty default the compiler filled in.
const register_of = (result: MatchResult) => (result.kind === "match" ? result.leaf.steps[0]!.invocation.args?.register || undefined : "no match");
const feed_all = (matcher: ReturnType<typeof create_matcher>, keys: string[], mode = "normal") => keys.map((key) => matcher.feed(mode, key)).at(-1)!;

test("the compiler flags a step whose command has a register param, and no other", () => {
  const children = tree().modes.normal!.children;
  const steps = (key: string) => (children[key] as { steps: { register?: true }[] }).steps;
  assert.equal(steps("j")[0]!.register, undefined);
  assert.equal(steps("y")[0]!.register, true);
});

test("the default keymap flags the yanks and the open, and the insert paste has no flag", () => {
  const { compiled, warnings } = compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
  assert.deepEqual(warnings, []);
  const flag_at = (mode: "normal" | "visual" | "insert", path: string[]) => {
    let node: TreeBranch | undefined = compiled.modes[mode];
    for (const key of path.slice(0, -1)) node = node?.children[key] as TreeBranch | undefined;
    const leaf = node?.children[path.at(-1)!];
    assert.equal(leaf?.kind, "leaf", `${mode} ${path.join("")}`);
    return leaf?.kind === "leaf" && leaf.steps[0]!.register === true;
  };
  for (const path of [["y", "y"], ["y", "l"], ["y", "L"], ["p", "p"], ["p", "t"], ["p", "w"], ["P"], [";", "y", "l"], [";", "y", "t"]]) assert.equal(flag_at("normal", path), true, path.join(""));
  assert.equal(flag_at("visual", ["y"]), true);
  assert.equal(flag_at("normal", ["j"]), false);
  assert.equal(flag_at("insert", ["<Escape>"]), false);
  const paste = (compiled.modes.insert as TreeBranch).children["<C-r>"] as TreeBranch;
  assert.deepEqual(paste.children[""] && (paste.children[""] as { steps: { capture?: string; register?: true }[] }).steps.map((step) => [step.capture, step.register]), [["name", undefined]]);
});

test("the prefix attaches its register to the next command, in the compiled steps and not the tree", () => {
  const keymap = tree();
  const matcher = create_matcher(keymap);
  assert.equal(matcher.feed("normal", '"').kind, "pending");
  assert.equal(matcher.feed("normal", "a").kind, "pending");
  assert.equal(register_of(matcher.feed("normal", "y")), "a");
  // The register is spent: the next command has none, and the stored tree is untouched.
  assert.equal(register_of(feed_all(matcher, ["y"])), undefined);
  assert.equal((keymap.modes.normal!.children.y as { steps: { invocation: { args?: { register?: string } } }[] }).steps[0]!.invocation.args?.register, "");
});

test("a count stands before or after the prefix", () => {
  const matcher = create_matcher(tree());
  const before = feed_all(matcher, ["3", '"', "a", "y"]);
  assert.deepEqual([before.kind === "match" && before.count, register_of(before)], [3, "a"]);
  const after = feed_all(matcher, ['"', "b", "2", "y"]);
  assert.deepEqual([after.kind === "match" && after.count, register_of(after)], [2, "b"]);
  const prompt = feed_all(matcher, ['"', "c", "1", "2", "j"]);
  assert.equal(prompt.kind === "match" && prompt.count, 12);
});

test("the prefix names every kind of register the special registers", () => {
  const matcher = create_matcher(tree());
  assert.equal(register_of(feed_all(matcher, ['"', "A", "y"])), "A");
  assert.equal(register_of(feed_all(matcher, ['"', '"', "y"])), '"');
  assert.equal(register_of(feed_all(matcher, ['"', "+", "y"])), "+");
  assert.equal(register_of(feed_all(matcher, ['"', "_", "y"])), "_");
  assert.equal(register_of(feed_all(matcher, ['"', "/", "y"])), "/");
  // A binding that fixes a register of its own gives way to the one typed.
  assert.equal(register_of(feed_all(matcher, ['"', "q", "x"])), "q");
  assert.equal(register_of(feed_all(matcher, ["x"])), "z");
});

test("the prefix reports its keys beside the typed ones, so which-key and Backspace can read it", () => {
  const matcher = create_matcher(tree());
  const waiting = matcher.feed("normal", '"');
  assert.deepEqual(waiting.kind === "pending" && [waiting.typed, waiting.register_keys], [[], '"']);
  const named = matcher.feed("normal", "a");
  assert.deepEqual(named.kind === "pending" && [named.typed, named.register_keys], [[], '"a']);
  const inside = matcher.feed("normal", "g");
  assert.deepEqual(inside.kind === "pending" && [inside.typed, inside.register_keys], [["g"], '"a']);
});

test("an invalid name or a key with no binding ends the prefix, and the key gets its one retry as a first key", () => {
  const matcher = create_matcher(tree());
  matcher.feed("normal", '"');
  assert.equal(matcher.feed("normal", "!").kind, "no_match");
  assert.equal(register_of(feed_all(matcher, ["y"])), undefined);
  // `"a` then a key with no binding: no match, and the register is gone.
  matcher.feed("normal", '"');
  matcher.feed("normal", "a");
  assert.equal(matcher.feed("normal", "Z").kind, "no_match");
  assert.equal(register_of(feed_all(matcher, ["y"])), undefined);
  // Escape cancels the prefix and then runs as a first key.
  matcher.feed("normal", '"');
  const escape = matcher.feed("normal", "<Escape>");
  assert.equal(escape.kind === "match" && escape.leaf.steps[0]!.invocation.id, "test.down");
  assert.equal(register_of(feed_all(matcher, ["y"])), undefined);
  // A digit is no register name, so it starts a count on its retry.
  matcher.feed("normal", '"');
  const digit = matcher.feed("normal", "1");
  assert.deepEqual(digit.kind === "pending" && [digit.count, digit.register_keys], [1, undefined]);
});

test("a mode change between the register and the command drops the register", () => {
  const matcher = create_matcher(tree());
  matcher.feed("normal", '"');
  matcher.feed("normal", "a");
  assert.equal(register_of(matcher.feed("caret", "y")), undefined);
});

test("in insert mode `\"` is an ordinary key", () => {
  const matcher = create_matcher(tree());
  assert.equal(matcher.feed("insert", '"').kind, "no_match");
  assert.equal(matcher.feed("insert", "j").kind, "match");
});

test("a user binding of `\"` wins over the prefix", () => {
  const matcher = create_matcher(tree_of({ '"': { id: "test.down" }, y: { id: "test.yank" } }));
  assert.equal(matcher.feed("normal", '"').kind, "match");
});

test("binds_after_ reads ahead through the prefix and leaves the walk as it was", () => {
  const matcher = create_matcher(tree());
  matcher.feed("normal", '"');
  assert.equal(matcher.binds_after_("normal", [], "a"), true);
  assert.equal(matcher.binds_after_("normal", ["a"], "y"), true);
  assert.equal(matcher.binds_after_("normal", [], "!"), false);
  assert.equal(register_of(feed_all(matcher, ["a", "y"])), "a");
});

test("a key the site hands to the page does not join a pending prefix", () => {
  const matcher = create_matcher(tree(), (token) => token === "a");
  matcher.feed("normal", '"');
  assert.equal(matcher.passes_("normal", "a"), false);
  assert.equal(matcher.feed("normal", "a").kind, "pending");
});

function make_flow(keymap = tree()) {
  const state = create_mode_state();
  const ran: string[] = [];
  const prefixes: (string[] | undefined)[] = [];
  const flow = create_key_flow({
    in_editable_field_: () => false,
    get_mode_: state.get_mode_,
    take_pass_next_: state.take_pass_next_,
    run_leaf_: (leaf, count) => ran.push(`${leaf.steps[0]?.invocation.id}:${leaf.steps[0]?.invocation.args?.register ?? ""}:${count ?? ""}`),
    leave_insert_: () => state.escape(),
    is_loading_: () => false,
    loading_sink_bundles_: () => [],
    sink_of_: () => undefined,
    on_prefix_: (prefix) => void prefixes.push(prefix?.typed),
  });
  flow.set_matcher_(create_matcher(keymap));
  return { flow, ran, prefixes, state };
}

test("key flow runs `3\"ay` and `\"a3y` the same, and lists the registers only while a name is awaited", () => {
  for (const keys of [["3", '"', "a", "y"], ['"', "a", "3", "y"]]) {
    const { flow, ran, prefixes } = make_flow();
    for (const key of keys) assert.equal(flow.handle_token_(key), "cancel", key);
    assert.deepEqual(ran, ["test.yank:a:3"]);
    assert.equal(prefixes.at(-1), undefined);
  }
  const { flow, prefixes } = make_flow();
  flow.handle_token_('"');
  assert.deepEqual(prefixes.at(-1), ['"']);
  flow.handle_token_("a");
  assert.equal(prefixes.at(-1), undefined);
});

test("key flow: insert mode with no field passes the insert keys and leaves on Escape", () => {
  const { flow, ran, state } = make_flow();
  state.set_mode_("insert");
  assert.equal(flow.handle_token_("j"), "pass");
  assert.deepEqual(ran, []);
  assert.equal(flow.handle_token_("<Escape>"), "pass");
  assert.equal(state.get_mode_(), "normal");
});

test("key flow: Escape ends a pending prefix, hides the panel and runs the Escape binding", () => {
  const { flow, ran, prefixes } = make_flow();
  flow.handle_token_('"');
  flow.handle_token_("<Escape>");
  assert.deepEqual(ran, ["test.down::"]);
  assert.equal(prefixes.at(-1), undefined);
});

test("key flow: a bad name or a key with no binding cancels the prefix and passes the key", () => {
  const { flow, ran } = make_flow();
  flow.handle_token_('"');
  assert.equal(flow.handle_token_("!"), "pass");
  flow.handle_token_('"');
  flow.handle_token_("a");
  assert.equal(flow.handle_token_("Z"), "pass");
  assert.deepEqual(ran, []);
  assert.equal(flow.handle_token_("y"), "cancel");
  assert.deepEqual(ran, ["test.yank::"]);
});

test("key flow: Backspace drops the last key of the prefix, then the prefix", () => {
  const { flow, ran, prefixes } = make_flow();
  flow.handle_token_('"');
  flow.handle_token_("a");
  flow.handle_token_("<Backspace>");
  assert.deepEqual(prefixes.at(-1), ['"']);
  flow.handle_token_("b");
  flow.handle_token_("<Backspace>");
  flow.handle_token_("<Backspace>");
  assert.equal(prefixes.at(-1), undefined);
  flow.handle_token_("y");
  assert.deepEqual(ran, ["test.yank::"]);
});

test("key flow: Backspace inside a longer key keeps the prefix and the count", () => {
  const { flow, ran, prefixes } = make_flow();
  for (const key of ["2", '"', "a", "g"]) flow.handle_token_(key);
  assert.deepEqual(prefixes.at(-1), ["g"]);
  flow.handle_token_("<Backspace>");
  assert.equal(prefixes.at(-1), undefined);
  flow.handle_token_("y");
  assert.deepEqual(ran, ["test.yank:a:2"]);
});

test("key flow: Backspace drops the last typed key, a count digit after the register first", () => {
  const { flow, ran, prefixes } = make_flow();
  for (const key of ['"', "a", "3"]) flow.handle_token_(key);
  flow.handle_token_("<Backspace>");
  flow.handle_token_("y");
  assert.deepEqual(ran, ["test.yank:a:"]);
  assert.equal(prefixes.at(-1), undefined);
  const again = make_flow();
  for (const key of ["3", '"', "a"]) again.flow.handle_token_(key);
  again.flow.handle_token_("<Backspace>");
  again.flow.handle_token_("b");
  again.flow.handle_token_("y");
  assert.deepEqual(again.ran, ["test.yank:b:3"]);
});

test("key flow: a mode change between the register and the command drops the register", () => {
  const { flow, ran, state } = make_flow();
  flow.handle_token_('"');
  flow.handle_token_("a");
  state.set_mode_("caret");
  flow.handle_token_("y");
  assert.deepEqual(ran, ["test.yank::"]);
});

function keymap_storage(keymap: CompiledKeymap) {
  return { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) } as never;
}

test("which-key lists the stored registers under `\"`, and the tree under any other prefix", async () => {
  const items = async () => [
    { name: '"', description: "last" },
    { name: "a", description: "one" },
  ];
  const panel = await list_keys(keymap_storage(tree()), () => undefined, { mode: "normal", prefix: ['"'] }, { registers: items });
  assert.deepEqual(panel.title, ["registers"]);
  assert.deepEqual(panel.rows, [
    { keys: '"', command: "last", description: "", more: false },
    { keys: "a", command: "one", description: "", more: false },
  ]);
  assert.deepEqual((await list_keys(keymap_storage(tree()), () => undefined, { mode: "normal", prefix: ["g"] }, { registers: items })).title, ["+g"]);
  assert.deepEqual((await list_keys(keymap_storage(tree()), () => undefined, { mode: "normal", prefix: ['"'] }, { registers: async () => Promise.reject(new Error("x")) })).rows, []);
});

test("a user binding of `\"` keeps its own which-key tree", async () => {
  const keymap = tree_of({ '"': { id: "test.down" }, y: { id: "test.yank" } });
  const panel = await list_keys(keymap_storage(keymap), () => undefined, { mode: "normal", prefix: ['"'] }, { registers: async () => [{ name: "a", description: "one" }] });
  assert.notDeepEqual(panel.title, ["registers"]);
});

function make_store() {
  const values = new Map<string, unknown>();
  const area = {
    get: async (keys: string | string[]) => Object.fromEntries([keys].flat().filter((key) => values.has(key)).map((key) => [key, values.get(key)])),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, value)),
    remove: async () => {},
  } as never;
  const clipboard = { text: "", write: async (text: string) => void (clipboard.text = text) };
  const store = create_register_store({ local: () => area, session: () => area, clipboard: { read: async () => clipboard.text, write: clipboard.write } });
  return { store, clipboard };
}

test("a yank fills the unnamed register and the named one, and the black hole drops it", async () => {
  const { store } = make_store();
  await store.yank("", "one", false);
  assert.deepEqual([await store.read('"', false), await store.read("a", false)], ["one", undefined]);
  await store.yank("a", "two", false);
  assert.deepEqual([await store.read('"', false), await store.read("a", false)], ["two", "two"]);
  await store.yank("A", "+three", false);
  assert.deepEqual([await store.read('"', false), await store.read("a", false)], ["+three", "two+three"]);
  await store.yank("_", "gone", false);
  assert.deepEqual([await store.read('"', false), await store.read("a", false)], ["+three", "two+three"]);
});

test("a yank into + leaves the clipboard to the content script and fills the unnamed register", async () => {
  const { store, clipboard } = make_store();
  await store.yank("+", "text", false);
  assert.deepEqual([clipboard.text, await store.read('"', false)], ["", "text"]);
});

test("a yank into a macro register refuses and leaves the unnamed register as it was", async () => {
  const { store } = make_store();
  await store.write("m", [{ id: "page.reload" }], false);
  await store.yank("", "old", false);
  await assert.rejects(store.yank("M", "text", false), /holds a macro/);
  assert.equal(await store.read('"', false), "old");
});

test("the background answers a yank by the sender tab's privacy", async () => {
  const { store } = make_store();
  assert.deepEqual(await answer_register_request(store, { type: "register_yank", name: "a", text: "x" }, { incognito: false }), { ok: true });
  assert.equal(await store.read("a", false), "x");
  assert.equal(await answer_register_request(store, { type: "register_yank", name: "a", text: "x" }, undefined), undefined);
  assert.deepEqual(await answer_register_request(store, { type: "register_yank", name: "!", text: "x" }, { incognito: false }), { ok: false, message: "No register named !" });
});
