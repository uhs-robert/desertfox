import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import type { KeymapConfig } from "../src/shared/keymap.ts";
import type { TreeBranch, TreeNode } from "../src/shared/prefix_tree.ts";
import { registry } from "../src/shared/registry/builtin.ts";

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
  return { group_names: {}, modifiers, normal: { ";l": { ...hint({ filter: "links" }, "Click link"), variant_label: "Link" }, ";i": hint({ filter: "inputs" }, "Click input"), ";I": hint({ filter: "images" }, "Open image"), ...normal } as never };
}

test("a modifier derives a variant of each key in its group, with its args added and the sibling label kept", () => {
  const { compiled, warnings } = compile(keymap_with({}, { ";B": { action: "background", label: "Background tab" } }));
  assert.deepEqual(warnings, []);
  assert.deepEqual(args_at(compiled, ";", "B", "l"), { action: "background", filter: "links", text: "", rapid: false, register: "" });
  assert.deepEqual(args_at(compiled, ";", "B", "I")?.action, "background");
  const variant = node_at(compiled, ";", "B", "l");
  assert.equal(variant?.kind === "leaf" && variant.label, "Link");
  assert.equal((node_at(compiled, ";", "B") as TreeBranch).label, "Background tab");
});

test("rapid on links backgrounds, and rapid on other filters clicks", () => {
  const { compiled } = compile(keymap_with({}, { ";r": { rapid: true } }));
  assert.equal(args_at(compiled, ";", "r", "l")?.action, "background");
  assert.equal(args_at(compiled, ";", "r", "i")?.action, "here");
  assert.equal(args_at(compiled, ";", "r", "i")?.rapid, true);
});

test("a key that sets its own action gets no variants, and no warning", () => {
  const { compiled, warnings } = compile(keymap_with({ ";s": hint({ action: "focus", filter: "scrollable" }) }, { ";B": { action: "background" }, ";r": { rapid: true } }));
  assert.deepEqual(warnings, []);
  assert.equal(node_at(compiled, ";", "B", "s"), undefined);
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
  const { compiled, warnings } = compile(keymap_with({ ";Bl": hint({ filter: "images" }) }, { ";B": { action: "background" } }));
  assert.deepEqual(warnings, []);
  assert.equal(args_at(compiled, ";", "B", "l")?.filter, "images");
  assert.equal(args_at(compiled, ";", "B", "I")?.action, "background");
});

test("a null under a modifier removes that variant and leaves its siblings", () => {
  const { compiled, warnings } = compile(keymap_with({ ";Bl": null }, { ";B": { action: "background" } }));
  assert.deepEqual(warnings, []);
  assert.equal(node_at(compiled, ";", "B", "l"), undefined);
  assert.ok(node_at(compiled, ";", "B", "I"));
});

test("a null on a modifier key drops that modifier and all its variants", () => {
  const { compiled, warnings } = compile(keymap_with({ ";r": null }, { ";r": { rapid: true }, ";B": { action: "background" } }));
  assert.deepEqual(warnings, []);
  assert.equal(node_at(compiled, ";", "r"), undefined);
  assert.ok(node_at(compiled, ";", "B", "l"));
});

test("a key whose required param comes from a prompt still gets variants", () => {
  const prompted = { id: "open.url", args: { where: "tab" }, prompt: { param: "url" } };
  // Opening here needs a url, so the variant is valid only because the prompt supplies it.
  const { compiled, warnings } = compile(keymap_with({ ";o": prompted }, { ";t": { where: "here" } }));
  assert.deepEqual(warnings, []);
  const variant = node_at(compiled, ";", "t", "o");
  assert.equal(variant?.kind === "leaf" && variant.steps[0]!.invocation.args?.where, "here");
});

test("the default modifiers give the owner's keys and no stacked or refused ones", () => {
  const { compiled, warnings } = compile(DEFAULT_KEYMAP);
  assert.deepEqual(warnings, []);
  for (const keys of [["r", "l"], ["B", "l"], ["W", "l"], ["h", "a"], ["x", "a"], ["2", "a"], ["B", "I"]]) assert.ok(node_at(compiled, ";", ...keys), keys.join(""));
  assert.equal(args_at(compiled, ";", "h", "a")?.action, "hover");
  assert.equal(args_at(compiled, ";", "2", "a")?.action, "double_click");
  assert.equal(node_at(compiled, ";", "2", "l"), undefined);
  // Keys that set their own action, the cmdline keys and stacked modifiers do not exist.
  for (const keys of [["B", "b"], ["B", "t"], ["B", "p"], ["h", "s"], ["r", "v"], ["r", "V"], ["B", ";"], ["r", "B"], ["p"], ["R"]]) assert.equal(node_at(compiled, ";", ...keys), undefined, keys.join(""));
});

test("the ;o modifier derives an inspect variant of the filter keys and none of the keys with their own action", () => {
  const { compiled, warnings } = compile(DEFAULT_KEYMAP);
  assert.deepEqual(warnings, []);
  assert.equal((node_at(compiled, ";", "o") as TreeBranch).label, "Inspect");
  for (const [key, filter] of [["a", "every"], ["l", "links"], ["t", "prose"], ["I", "images"], ["i", "inputs"], ["b", "buttons"]] as const) {
    assert.deepEqual([args_at(compiled, ";", "o", key)?.action, args_at(compiled, ";", "o", key)?.filter], ["inspect", filter], key);
  }
  for (const keys of [["B", "a"], ["W", "a"], ["d", "a"]]) assert.equal(node_at(compiled, ";", ...keys), undefined, keys.join(""));
  for (const keys of [["o", "s"], ["o", "v"], ["o", ";"], ["o", "o"], ["o", "y"], ["o", "B"]]) assert.equal(node_at(compiled, ";", ...keys), undefined, keys.join(""));
});

test("the yank keys are eight plain leaves, each with a fixed action and filter", () => {
  const { compiled, warnings } = compile(DEFAULT_KEYMAP);
  assert.deepEqual(warnings, []);
  const expected = { l: ["copy", "links"], i: ["copy_image", "images"], I: ["copy", "images"], m: ["copy", "media"], f: ["copy", "frames"], t: ["copy_text", "all"], c: ["copy_selector", "every"], h: ["copy_html", "every"] };
  for (const [key, [action, filter]] of Object.entries(expected)) {
    assert.equal(node_at(compiled, ";", "y", key)?.kind, "leaf", key);
    assert.deepEqual([args_at(compiled, ";", "y", key)?.action, args_at(compiled, ";", "y", key)?.filter], [action, filter], key);
  }
  // Nothing derives beyond them: no filter step and no modifiers under the leaves, and the old modifiers are gone.
  assert.deepEqual(Object.keys((node_at(compiled, ";", "y") as unknown as TreeBranch).children).sort(), Object.keys(expected).sort());
  assert.equal(DEFAULT_KEYMAP.modifiers![";y"], undefined);
  assert.equal(DEFAULT_KEYMAP.modifiers![";Y"], undefined);
});

test("the default picture keys: ;d reaches images, links and media", () => {
  const { compiled, warnings } = compile(DEFAULT_KEYMAP);
  assert.deepEqual(warnings, []);
  assert.equal(args_at(compiled, ";", "I")?.action, "tab");
  for (const [key, filter] of [["I", "images"], ["l", "links"], ["m", "media"]] as const) {
    assert.deepEqual([args_at(compiled, ";", "d", key)?.action, args_at(compiled, ";", "d", key)?.filter], ["download", filter], key);
  }
  // `;a` labels every element, most of which have no address to save, and `;Ba` and `;Wa` likewise.
  for (const key of ["B", "i", "t", "f", "a"]) assert.equal(node_at(compiled, ";", "d", key), undefined, key);
});

test("the ;: modifier derives a prompt variant for filters with an address and none for the others", () => {
  const { compiled, warnings } = compile(DEFAULT_KEYMAP);
  assert.deepEqual(warnings, []);
  assert.equal((node_at(compiled, ";", ":") as TreeBranch).label, "Edit in command line");
  assert.equal(args_at(compiled, ";", ":", "l")?.action, "prompt");
  assert.equal(args_at(compiled, ";", ":", "l")?.command, "open");
  assert.equal(args_at(compiled, ";", ":", "I")?.action, "prompt");
  for (const keys of [[":", "b"], [":", "i"], [":", "t"], [":", "s"], [":", ":"], [":", "r"]]) assert.equal(node_at(compiled, ";", ...keys), undefined, keys.join(""));
});

test(";Y copies link addresses in rapid mode", () => {
  const { compiled } = compile(DEFAULT_KEYMAP);
  assert.deepEqual(args_at(compiled, ";", "Y"), { action: "copy", filter: "links", text: "", rapid: true, register: "" });
});
