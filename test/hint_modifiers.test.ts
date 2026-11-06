import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import type { KeymapConfig } from "../src/shared/keymap.ts";
import type { TreeBranch, TreeNode } from "../src/shared/prefix_tree.ts";
import { registry } from "../src/shared/registry/index.ts";

function compile(keymap: KeymapConfig) {
  return compile_config({ config: empty_config(), default_keymap: keymap, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
}

function node_at(compiled: ReturnType<typeof compile>["compiled"], ...tokens: string[]): TreeNode | undefined {
  let node: TreeNode | undefined = compiled.modes.normal;
  for (const token of tokens) node = node?.kind === "branch" ? node.children[token] : undefined;
  return node;
}

function args_at(compiled: ReturnType<typeof compile>["compiled"], ...tokens: string[]) {
  const node = node_at(compiled, ...tokens);
  return node?.kind === "leaf" ? node.steps[0]!.invocation.args : undefined;
}

const hint = (args: Record<string, unknown>, label?: string) => ({ id: "hint.run", args, ...(label ? { label } : {}) });

// A small group with one modifier of each kind, so each test reads one rule.
function keymap_with(normal: Record<string, unknown>, modifiers: NonNullable<KeymapConfig["modifiers"]>): KeymapConfig {
  return { group_names: {}, modifiers, normal: { ";l": hint({ filter: "links" }, "Click link"), ";i": hint({ filter: "inputs" }, "Click input"), ...normal } as never };
}

test("a modifier derives a variant of each key in its group, with its args added and the sibling label kept", () => {
  const { compiled, warnings } = compile(keymap_with({}, { ";b": { action: "background", label: "Background tab" } }));
  assert.deepEqual(warnings, []);
  assert.deepEqual(args_at(compiled, ";", "b", "l"), { action: "background", filter: "links", text: "", rapid: false });
  assert.deepEqual(args_at(compiled, ";", "b", "i")?.action, "background");
  const variant = node_at(compiled, ";", "b", "l");
  assert.equal(variant?.kind === "leaf" && variant.label, "Click link");
  assert.equal((node_at(compiled, ";", "b") as TreeBranch).label, "Background tab");
});

test("rapid on links backgrounds, and rapid on other filters clicks", () => {
  const { compiled } = compile(keymap_with({}, { ";r": { rapid: true } }));
  assert.equal(args_at(compiled, ";", "r", "l")?.action, "background");
  assert.equal(args_at(compiled, ";", "r", "i")?.action, "here");
  assert.equal(args_at(compiled, ";", "r", "i")?.rapid, true);
});

test("a key that sets its own action gets no variants, and no warning", () => {
  const { compiled, warnings } = compile(keymap_with({ ";s": hint({ action: "focus", filter: "scrollable" }) }, { ";b": { action: "background" }, ";r": { rapid: true } }));
  assert.deepEqual(warnings, []);
  assert.equal(node_at(compiled, ";", "b", "s"), undefined);
  assert.equal(node_at(compiled, ";", "r", "s"), undefined);
  assert.ok(node_at(compiled, ";", "s"));
});

test("a variant the param schema refuses is never inserted, with no warning", () => {
  const { compiled, warnings } = compile(keymap_with({ ";;": { id: "cmdline.open", args: { text: "hint " } } }, { ";r": { rapid: true } }));
  assert.deepEqual(warnings, []);
  assert.equal(node_at(compiled, ";", "r", ";"), undefined);
  assert.ok(node_at(compiled, ";", ";"));
});

test("a modifier that no key of its group accepts warns", () => {
  const { warnings } = compile(keymap_with({}, { ";z": { nonsense: true } }));
  assert.deepEqual(warnings, ['modifiers: ";z" matches no key of its group, so it makes no variants']);
});

test("a user key at the modifier key wins over the modifier, with a warning", () => {
  const { compiled, warnings } = compile(keymap_with({ ";r": { id: "page.reload" } }, { ";r": { rapid: true } }));
  assert.deepEqual(warnings, ['modifiers: skipped ";r": the key has its own binding, which wins']);
  assert.equal(node_at(compiled, ";", "r")?.kind, "leaf");
});

test("a user key under the modifier wins over the variant, with no warning", () => {
  const { compiled, warnings } = compile(keymap_with({ ";bl": hint({ filter: "images" }) }, { ";b": { action: "background" } }));
  assert.deepEqual(warnings, []);
  assert.equal(args_at(compiled, ";", "b", "l")?.filter, "images");
  assert.equal(args_at(compiled, ";", "b", "i")?.action, "background");
});

test("the default modifiers give the owner's keys and no stacked or refused ones", () => {
  const { compiled, warnings } = compile(DEFAULT_KEYMAP);
  assert.deepEqual(warnings, []);
  for (const keys of [["r", "l"], ["b", "l"], ["w", "l"], ["y", "l"], ["Y", "p"], ["h", "a"], ["x", "a"], ["b", "B"]]) assert.ok(node_at(compiled, ";", ...keys), keys.join(""));
  assert.equal(args_at(compiled, ";", "h", "a")?.action, "hover");
  assert.equal(args_at(compiled, ";", "Y", "p")?.action, "copy_text");
  // Keys that set their own action, the cmdline keys and stacked modifiers do not exist.
  for (const keys of [["b", "t"], ["h", "s"], ["y", "v"], ["r", "v"], ["r", "V"], ["b", ";"], ["r", "b"], ["t"], ["R"]]) assert.equal(node_at(compiled, ";", ...keys), undefined, keys.join(""));
});
