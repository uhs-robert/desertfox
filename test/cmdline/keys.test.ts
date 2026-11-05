import assert from "node:assert/strict";
import { test } from "node:test";
import { key_labels } from "../../src/cmdline/completion/keys.ts";
import type { CompiledKeymap, TreeBranch, TreeNode } from "../../src/shared/prefix_tree.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import "../../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { command_meta, registry } from "../../src/shared/registry/index.ts";
import { COMMANDS } from "./completion/fixtures.ts";

const leaf = (id: string, args?: Record<string, unknown>, prompt?: { param: string }): TreeNode => ({
  kind: "leaf",
  steps: [{ invocation: { id, ...(args ? { args } : {}), ...(prompt ? { prompt } : {}) } as never, runs_in: "background", count_rule: "ignore" as never }],
});
const branch = (children: Record<string, TreeNode>): TreeBranch => ({ kind: "branch", children });
const keymap = (modes: CompiledKeymap["modes"]) => ({ modes }) as CompiledKeymap;

const normal = branch({
  d: leaf("tab.close"),
  H: branch({ d: leaf("tab.close", { left: true }) }),
  L: leaf("tab.close", { right: true }),
  "<C-n>": leaf("tab.next"),
  gg: leaf("window.new"),
  s: branch({ g: leaf("open.search", { engine: "duck" }) }),
  t: leaf("tab.switch", undefined, { param: "title" }),
});

test("a command lists the keys that run it bare, flags included, and shows two then +N", () => {
  const labels = key_labels(keymap({ normal }), COMMANDS, "normal");
  assert.equal(labels.get("tab.close"), "d L +1");
  assert.equal(labels.get("tab.next"), "<C-n>");
  assert.equal(labels.get("window.new"), "gg");
});

test("a binding with a value or a prompt stays off the command row", () => {
  const labels = key_labels(keymap({ normal }), COMMANDS, "normal");
  assert.equal(labels.has("open.search"), false);
  assert.equal(labels.has("tab.switch"), false);
});

test("a user tree that rebinds a command shows the new keys", () => {
  const user = branch({ x: leaf("tab.close") });
  assert.equal(key_labels(keymap({ normal: user }), COMMANDS, "normal").get("tab.close"), "x");
});

test("browser keys show in a normal line and keys of another mode do not", () => {
  const labels = key_labels(keymap({ normal, browser: branch({ "<A-w>": leaf("tab.close") }), insert: branch({ q: leaf("tab.next") }) }), COMMANDS, "normal");
  assert.equal(labels.get("tab.close"), "d <A-w> +2");
  assert.equal(labels.get("tab.next"), "<C-n>");
});

test("a line opened from another mode reads that mode's tree", () => {
  const labels = key_labels(keymap({ normal, insert: branch({ q: leaf("tab.next") }) }), COMMANDS, "insert");
  assert.deepEqual([...labels], [["tab.next", "q"]]);
});

test("no keymap gives no keys", () => {
  assert.equal(key_labels(undefined, COMMANDS, "normal").size, 0);
});

test("an arg the compiler filled with its default does not hide the key", () => {
  const meta = [{ id: "url.parent", label: "Up", intent: "Go up.", params: [{ name: "levels", type: "number", main: true, default: 1 }] }, { id: "window.new", label: "New", intent: "Open.", params: [{ name: "url", type: "string", main: true, default: "" }] }] as never;
  const labels = key_labels(keymap({ normal: branch({ gu: leaf("url.parent", { levels: 1 }), wn: leaf("window.new", { url: "" }), U: leaf("url.parent", { levels: 2 }) }) }), meta, "normal");
  assert.equal(labels.get("url.parent"), "gu");
  assert.equal(labels.get("window.new"), "wn");
});

test("keys with no flag come before flag keys, then shorter, then lowercase before uppercase", () => {
  const user = branch({ B: leaf("tab.close"), b: leaf("tab.close"), aa: leaf("tab.close"), L: leaf("tab.close", { right: true }) });
  assert.equal(key_labels(keymap({ normal: user }), COMMANDS, "normal").get("tab.close"), "b B +2");
});

test("the real default keymap shows tab.close as dd xx +5", () => {
  const { compiled } = compile_config({
    config: empty_config(),
    default_keymap: DEFAULT_KEYMAP,
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: ["google"], containers: [] },
  });
  assert.equal(key_labels(compiled, registry.list().map(command_meta), "normal").get("tab.close"), "dd xx +5");
});

test("a key bound to open -t gets its label, the conditional url default counts as the default", () => {
  const meta = [command_meta(registry.get("open.url")!)] as never;
  const labels = key_labels(keymap({ normal: branch({ T: leaf("open.url", { where: "tab", url: "" }) }) }), meta, "normal");
  assert.equal(labels.get("open.url"), "T");
});
