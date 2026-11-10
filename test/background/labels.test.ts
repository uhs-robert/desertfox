import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import type { CompileInput } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { build_config } from "../../tools/build-config/build_config.ts";
import type { CommandMeta } from "../../src/shared/command.ts";
import type { KeymapConfig, ModeBindings } from "../../src/shared/keymap.ts";
import type { MergedConfig } from "../../src/shared/config.ts";
import type { CompiledKeymap, TreeBranch, TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { build_commands_file } from "../../src/shared/registry/index.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { make_fake } from "./fakes.ts";

const fake_commands = {
  "tab.close": {
    label: "Close tab",
    intent: "x",
    params: [{ name: "focus", type: "enum" as const, values: ["right", "left"], default: "right", value_labels: { left: "and focus left" } }],
    runs_in: "background" as const,
    run: () => {},
  },
  "open.search": {
    label: "Search",
    intent: "x",
    params: [
      { name: "engine", type: "enum" as const, values: { from: "search_engines" as const }, default: "" },
      { name: "where", type: "enum" as const, values: ["here", "tab"], default: "here", value_labels: { tab: "in new tab" } },
      { name: "query", type: "string" as const, default: "" },
    ],
    runs_in: "background" as const,
    run: () => {},
  },
  "open.url": {
    label: "Open URL",
    intent: "x",
    params: [
      { name: "url", type: "string" as const, default: "" },
      { name: "where", type: "enum" as const, values: ["here", "tab"], default: "here", value_labels: { tab: "in new tab" } },
      { name: "container", type: "string" as const, values: { from: "containers" as const } },
    ],
    runs_in: "background" as const,
    run: () => {},
  },
  "tab.reopen_in_container": {
    label: "Reopen in container",
    intent: "x",
    params: [{ name: "container", type: "string" as const, values: { from: "containers" as const } }],
    runs_in: "background" as const,
    run: () => {},
  },
  "caret.move": {
    label: "Move caret",
    intent: "x",
    params: [
      { name: "unit", type: "enum" as const, values: ["char", "word_end"], value_labels: { char: "by character" } },
      { name: "big", type: "bool" as const, default: false },
      { name: "count", type: "int" as const, default: 1 },
    ],
    runs_in: "background" as const,
    run: () => {},
  },
  "page.reload": {
    label: "Reload",
    intent: "x",
    params: [{ name: "hard", type: "bool" as const, default: false }],
    runs_in: "background" as const,
    run: () => {},
  },
};

function labels_of(keymap: KeymapConfig, extra: Partial<MergedConfig> = {}, default_keymap: KeymapConfig = {}) {
  const { registry: fake } = make_fake(fake_commands);
  const config = {
    ...empty_config(),
    keymap,
    search_engines: { ddg: { url: "https://d/?q=%s", label: "DuckDuckGo" }, arch: { url: "https://a/?q=%s", label: "Arch Wiki" } },
    ...extra,
  };
  const { compiled, warnings } = compile_config({
    config,
    default_keymap,
    get_command: (id) => fake.get(id),
    enum_sources: { search_engines: ["ddg", "arch", "nope", "bad", "blank", ...Object.keys(config.search_engines)], containers: ["Work", "default"] },
  });
  const children = compiled.modes.normal!.children;
  const leaf_at = (...keys: string[]) => {
    let node: TreeBranch = compiled.modes.normal!;
    for (const key of keys.slice(0, -1)) node = node.children[key] as TreeBranch;
    return node.children[keys.at(-1)!] as TreeLeaf;
  };
  return { children, leaf_at, warnings };
}

test("the label is the command label plus a phrase for each enum value the binding sets", () => {
  const { leaf_at, warnings } = labels_of({
    normal: {
      a: { id: "tab.close" },
      b: { id: "tab.close", args: { focus: "left" } },
      c: { id: "tab.close", args: { focus: "right" } },
    },
  });
  assert.deepEqual(warnings, []);
  assert.equal(leaf_at("a").label, "Close tab");
  assert.equal(leaf_at("b").label, "Close tab and focus left");
  assert.equal(leaf_at("c").label, "Close tab");
});

test("a value with no phrase reads as the raw value with spaces for underscores", () => {
  const { leaf_at } = labels_of({ normal: { e: { id: "caret.move", args: { unit: "word_end" } } } });
  assert.equal(leaf_at("e").label, "Move caret word end");
});

test("a true bool adds the param name, a false one and a number add nothing", () => {
  const { leaf_at } = labels_of({
    normal: {
      a: { id: "caret.move", args: { unit: "char", big: true } },
      b: { id: "caret.move", args: { unit: "char", big: false, count: 4 } },
      c: { id: "page.reload", args: { hard: true } },
    },
  });
  assert.equal(leaf_at("a").label, "Move caret by character big");
  assert.equal(leaf_at("b").label, "Move caret by character");
  assert.equal(leaf_at("c").label, "Reload hard");
});

test("defaults the compile fills in do not reach the label", () => {
  const { leaf_at } = labels_of({ normal: { a: { id: "open.url", prompt: { param: "url" } }, b: { id: "open.url", args: { where: "tab" }, prompt: { param: "url" } } } });
  assert.equal(leaf_at("a").label, "Open URL");
  assert.equal(leaf_at("b").label, "Open URL in new tab");
});

test("a binding label wins over the derived label", () => {
  const { leaf_at } = labels_of({ normal: { a: { id: "tab.close", args: { focus: "left" }, label: "Close and look left" } } });
  assert.equal(leaf_at("a").label, "Close and look left");
  assert.equal("label" in leaf_at("a").steps[0]!.invocation, false);
});

test("a key with several commands takes the label on the first command", () => {
  const { leaf_at } = labels_of({
    normal: {
      a: [{ id: "tab.close", args: { focus: "left" }, label: "First" }, { id: "page.reload", label: "Second" }],
      b: [{ id: "page.reload", args: { hard: true } }, { id: "tab.close", label: "Ignored" }],
      c: [{ id: "page.reload" }, { id: "tab.close", label: "Not the first" }],
    },
  });
  assert.equal(leaf_at("a").label, "First");
  assert.equal(leaf_at("b").label, "Reload hard");
  assert.equal(leaf_at("c").label, "Reload");
});

test("an empty label or one with control characters warns and skips the key", () => {
  const { children, warnings } = labels_of({ normal: { a: { id: "tab.close", label: "  " }, b: { id: "tab.close", label: "one\ntwo" }, c: { id: "tab.close" } } });
  assert.deepEqual(Object.keys(children), ["c"]);
  assert.equal(warnings.length, 2);
});

test("the default keymap labels override the derived ones", () => {
  const { leaf_at } = labels_of({}, {}, { normal: { a: { id: "tab.close", args: { focus: "left" }, label: "Hand label" }, b: { id: "tab.close", args: { focus: "left" } } } });
  assert.equal(leaf_at("a").label, "Hand label");
  assert.equal(leaf_at("b").label, "Close tab and focus left");
});

test("a user binding without a label replaces the default label", () => {
  const { leaf_at } = labels_of({ normal: { a: { id: "tab.close" } } }, {}, { normal: { a: { id: "tab.close", label: "Hand label" } } });
  assert.equal(leaf_at("a").label, "Close tab");
});

test("a derived label with a control character warns and keeps the command label, while a bad binding label skips the key", () => {
  const { children, leaf_at, warnings } = labels_of(
    { normal: { a: { id: "open.search", args: { engine: "bad" } }, b: { id: "tab.close", args: { focus: "left" } }, c: { id: "tab.close", label: "x\ny" } } },
    { search_engines: { bad: { url: "https://b/?q=%s", label: "Bad\nEngine" } } },
  );
  assert.deepEqual(Object.keys(children), ["a", "b"]);
  assert.equal(leaf_at("a").label, "Search");
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /"a" keeps the command label: a label must not hold control characters/);
  assert.match(warnings[1]!, /skipped "c": a label must not hold control characters/);
});

test("an empty engine label keeps the command label with a warning", () => {
  const { leaf_at, warnings } = labels_of(
    { normal: { a: { id: "open.search", args: { engine: "blank" } } } },
    { search_engines: { blank: { url: "https://b/?q=%s", label: "  " } } },
  );
  assert.equal(leaf_at("a").label, "Search");
  assert.match(warnings.join("\n"), /"a" keeps the command label: a label must not be empty/);
});

test("a search engine entry with no usable label is ignored for labels", () => {
  const { leaf_at, warnings } = labels_of(
    { normal: { a: { id: "open.search", args: { engine: "ddg" } }, b: { id: "open.search", args: { engine: "arch" } } } },
    { search_engines: { ddg: null, arch: { url: "https://a/?q=%s" } } as unknown as MergedConfig["search_engines"] },
  );
  assert.deepEqual(warnings, []);
  assert.equal(leaf_at("a").label, "Search");
  assert.equal(leaf_at("b").label, "Search");
});

// Engine and container keys.
test("generated search keys are labeled with the engine label", () => {
  const { leaf_at } = labels_of({ search_keys: { d: "ddg", a: "arch" } });
  assert.equal(leaf_at("s", "d").label, "DuckDuckGo");
  assert.equal(leaf_at("S", "d").label, "DuckDuckGo in new tab");
  assert.equal(leaf_at("s", "a").label, "Arch Wiki");
});

test("a phrase that an ancestor group name says as whole words is dropped, in any case and anywhere in the name", () => {
  const closing = { Xa: { id: "tab.close", args: { focus: "left" } }, Xb: { id: "tab.close", args: { focus: "left" } }, Ya: { id: "tab.close", args: { focus: "left" } } };
  const { leaf_at } = labels_of(
    { normal: { ...closing, XYa: { id: "tab.close", args: { focus: "left" } } }, group_names: { X: "Closing AND FOCUS LEFT now", Y: "Elsewhere" } },
  );
  assert.equal(leaf_at("X", "a").label, "Close tab");
  assert.equal(leaf_at("Y", "a").label, "Close tab and focus left");
  assert.equal(leaf_at("X", "Y", "a").label, "Close tab");
});

test("a name that holds the phrase only inside a word or only in part drops nothing", () => {
  const { leaf_at } = labels_of({
    normal: { Xa: { id: "tab.close", args: { focus: "left" } }, Ya: { id: "tab.close", args: { focus: "left" } } },
    group_names: { X: "Land and focus leftover", Y: "Close and focus" },
  });
  assert.equal(leaf_at("X", "a").label, "Close tab and focus left");
  assert.equal(leaf_at("Y", "a").label, "Close tab and focus left");
});

test("a hand label is kept, and a deeper group name counts for its own keys only", () => {
  const { leaf_at } = labels_of({
    normal: {
      Xa: { id: "page.reload", args: { hard: true } },
      Xb: { id: "tab.close", args: { focus: "left" } },
      Xd: { id: "tab.close", args: { focus: "left" }, label: "Close and focus left" },
      Xca: { id: "tab.close", args: { focus: "left" } },
    },
    group_names: { X: "Elsewhere", Xc: "Hard and focus left" },
  });
  assert.equal(leaf_at("X", "a").label, "Reload hard");
  assert.equal(leaf_at("X", "b").label, "Close tab and focus left");
  assert.equal(leaf_at("X", "d").label, "Close and focus left");
  assert.equal(leaf_at("X", "c", "a").label, "Close tab");
});

test("a group name that another spelling of the same keys replaces drops nothing", () => {
  const { leaf_at } = labels_of({
    normal: { Sa: { id: "tab.close", args: { focus: "left" } } },
    group_names: { S: "Close and focus left", "<S-s>": "Search" },
  });
  assert.equal(leaf_at("S", "a").label, "Close tab and focus left");
});

test("a search binding without an engine takes the default engine label", () => {
  const { leaf_at } = labels_of({ normal: { ",,": { id: "open.search" } } }, { settings: { default_engine: "arch" } });
  assert.equal(leaf_at(",", ",").label, "Arch Wiki");
});

test("a search engine without a configured label keeps the command label", () => {
  const { leaf_at } = labels_of({ search_keys: { n: "nope" } });
  assert.equal(leaf_at("s", "n").label, "Search");
});

test("container keys are labeled with the container name, and default reads Default container", () => {
  const { leaf_at } = labels_of({ container_keys: { w: "Work", d: "default" } });
  assert.equal(leaf_at("c", "w").label, "Work");
  assert.equal(leaf_at("C", "w").label, "Work");
  assert.equal(leaf_at("c", "d").label, "Default container");
  assert.equal(leaf_at("C", "d").label, "Default container");
});

// The real registry and the real default keymap.

const real_commands: CommandMeta[] = build_commands_file(registry).commands;

function compile_real(config: MergedConfig, get_command: CompileInput["get_command"], containers: string[] = []): CompiledKeymap {
  const { compiled } = compile_config({
    config,
    default_keymap: DEFAULT_KEYMAP,
    get_command,
    enum_sources: { search_engines: Object.keys(config.search_engines), containers },
  });
  return compiled;
}

function leaf_label(compiled: CompiledKeymap, mode: keyof CompiledKeymap["modes"], keys: string[]): string | undefined {
  let node: TreeBranch | undefined = compiled.modes[mode];
  for (const key of keys.slice(0, -1)) node = node?.children[key] as TreeBranch | undefined;
  return (node?.children[keys.at(-1)!] as TreeLeaf | undefined)?.label;
}

test("the default keymap reads as the wording draft says", () => {
  const compiled = compile_real(empty_config(), (id) => registry.get(id));
  const expected: [string, string[], string][] = [
    ["normal", ["g", "o"], "Open URL"],
    ["normal", ["g", "O"], "Open URL in new tab"],
    ["normal", ["y", "y"], "Copy URL"],
    ["normal", ["y", "c"], "Copy URL in canonical form"],
    ["normal", ["y", "m"], "Copy URL as Markdown link"],
    ["normal", ["D"], "Close tab and focus previous"],
    ["normal", ["d", "L"], "Close tabs after this one"],
    ["normal", ["d", "H"], "Close tabs before this one"],
    ["normal", ["g", "x", "0"], "Close tabs before this one"],
    ["normal", ["g", "x", "$"], "Close tabs after this one"],
    ["normal", ["r", "r"], "Reload"],
    ["normal", ["R"], "Hard reload"],
    ["normal", ["h"], "Scroll left"],
    ["normal", ["z", "t"], "Align focus to top"],
    ["normal", ["z", "z"], "Align focus"],
    ["normal", ["w", "n"], "New window"],
    ["normal", ["w", "o"], "New window, enter URL"],
    ["normal", ["P"], "Open clipboard in new tab"],
    ["normal", ["g", "V"], "Set mode to caret"],
    ["normal", ["v"], "Start caret mode"],
    ["normal", ["V"], "Start visual mode"],
    ["normal", [";", "v"], "Start caret mode at text"],
    ["normal", [";", "V"], "Start visual mode at text"],
    ["normal", ["f"], "Click element"],
    ["normal", [";", "l"], "Click link"],
    ["normal", [";", "y", "l"], "Copy link URL"],
    ["normal", [";", "B", "I"], "Image"],
    ["normal", [";", "r", "a"], "Any element"],
    ["caret", ["w"], "Move caret by word"],
    ["caret", ["e"], "Move caret to word end"],
    ["caret", ["k"], "Move caret by line backward"],
    ["caret", ["W"], "Move caret by WORD"],
    ["visual", ["y"], "Act on selection to copy"],
    ["cmdline", ["<ArrowUp>"], "History to older entry"],
  ];
  for (const [mode, keys, label] of expected) assert.equal(leaf_label(compiled, mode as keyof CompiledKeymap["modes"], keys), label, `${mode} ${keys.join("")}`);
});

// JSON with sorted keys, so two bindings that set the same args in another order compare equal.
function canonical_json(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));
}

// A group is one branch: the root of a mode and every prefix under it. Two keys of a group may share a label only if they run the same binding.
function duplicate_labels(compiled: CompiledKeymap, print: (line: string) => void): string[] {
  const duplicates: string[] = [];
  const visit = (mode: string, prefix: string[], branch: TreeBranch) => {
    const by_label = new Map<string, Map<string, string[]>>();
    const lines: string[] = [];
    for (const [key, node] of Object.entries(branch.children)) {
      if (node.kind === "branch") {
        visit(mode, [...prefix, key], node);
        continue;
      }
      const label = node.label ?? "";
      const runs = canonical_json(node.steps.map((step) => step.invocation));
      const groups = by_label.get(label) ?? new Map<string, string[]>();
      groups.set(runs, [...(groups.get(runs) ?? []), key]);
      by_label.set(label, groups);
      lines.push(`${key} = ${label}`);
    }
    print(`${mode} ${prefix.join("") || "(root)"}${branch.label ? ` [${branch.label}]` : ""}: ${lines.join(" | ")}`);
    for (const [label, groups] of by_label) {
      if (groups.size > 1) duplicates.push(`${mode} ${prefix.join("") || "(root)"}: "${label}" is shared by ${[...groups.values()].map((keys) => keys.join(" ")).join(" and ")}, which run different bindings`);
    }
  };
  for (const [mode, root] of Object.entries(compiled.modes)) visit(mode, [], root as TreeBranch);
  return duplicates;
}

test("no which-key group of the default keymap has two different bindings with one label", (t: TestContext) => {
  const compiled = compile_real(empty_config(), (id) => registry.get(id));
  assert.deepEqual(duplicate_labels(compiled, (line) => t.diagnostic(line)), []);
});

test("keys that run the same binding may share a label, keys that run different ones may not", () => {
  const { registry: fake } = make_fake(fake_commands);
  const compile_normal = (normal: ModeBindings) =>
    compile_config({ config: { ...empty_config(), keymap: { normal } }, default_keymap: {}, get_command: (id) => fake.get(id), enum_sources: { search_engines: [], containers: [] } }).compiled;
  const aliases = compile_normal({ a: { id: "tab.close" }, b: { id: "tab.close" } });
  assert.deepEqual(duplicate_labels(aliases, () => {}), []);
  const clash = compile_normal({ a: { id: "tab.close", label: "Same" }, b: { id: "tab.close", args: { focus: "left" }, label: "Same" }, c: { id: "tab.close", label: "Same" } });
  const found = duplicate_labels(clash, () => {});
  assert.equal(found.length, 1);
  assert.match(found[0]!, /"Same" is shared by a c and b/);
});

// The user config is read from a copy with the symlinks resolved. The live config and the dotfiles behind it are never touched.
// DESERTFOX_USER_CONFIG points the test at another folder, for trying a config before it goes into the dotfiles.
const USER_CONFIG = process.env.DESERTFOX_USER_CONFIG ?? join(homedir(), ".config", "desertfox");

test("no which-key group of the user config has two different bindings with one label", { skip: !existsSync(USER_CONFIG) && "no user config folder on this machine" }, (t: TestContext) => {
  const copy = mkdtempSync(join(tmpdir(), "desertfox-user-config-"));
  try {
    cpSync(USER_CONFIG, copy, { recursive: true, dereference: true });
    const config = build_config(copy, real_commands);
    // Snippets define their own commands, so the check runs on a registry that holds them too.
    const containers = Object.values(config.keymap.container_keys ?? {});
    const snippet_commands = new Map(config.snippets.map((snippet) => [snippet.id, snippet]));
    const get_command: CompileInput["get_command"] = (id) => {
      const snippet = snippet_commands.get(id);
      return snippet ? { id, label: snippet.label, runs_in: "background", ...(snippet.params && { params: snippet.params }), ...(snippet.modes && { modes: snippet.modes }) } : registry.get(id);
    };
    const compiled = compile_real(config, get_command, containers);
    assert.deepEqual(duplicate_labels(compiled, (line) => t.diagnostic(line)), []);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test("a derived engine label under a named group keeps its whole path, even when the group name says part of it", () => {
  const engines = {
    "github.repo.issues": { url: "https://g/?q={repo}{query}", label: "GitHub: this repo: issues", slots: ["repo"] },
  };
  const { leaf_at, warnings } = labels_of(
    { normal: { Gi: { id: "open.search", args: { engine: "github.repo.issues" } }, Hi: { id: "open.search", args: { engine: "github.repo.issues", where: "tab" } } }, group_names: { G: "GitHub", H: "this repo in new tab" } },
    { search_engines: engines },
  );
  assert.deepEqual(warnings, []);
  assert.equal(leaf_at("G", "i").label, "GitHub: this repo: issues");
  assert.equal(leaf_at("H", "i").label, "GitHub: this repo: issues");
});

test("a binding intent lands on the leaf and not on its step", () => {
  const { leaf_at, warnings } = labels_of({ normal: { a: { id: "page.reload", label: "X", intent: "Y" }, b: { id: "page.reload" } } });
  assert.deepEqual(warnings, []);
  assert.equal(leaf_at("a").intent, "Y");
  assert.equal(leaf_at("a").steps[0]!.invocation.intent, undefined);
  assert.equal("intent" in leaf_at("b"), false);
});

test("an empty or multi-line intent skips the key", () => {
  const { children, warnings } = labels_of({ normal: { a: { id: "page.reload", intent: " " }, b: { id: "page.reload", intent: "x\ny" }, c: { id: "page.reload" } } });
  assert.equal(children["a"], undefined);
  assert.equal(children["b"], undefined);
  assert.match(warnings.join("\n"), /an intent must not be empty/);
  assert.match(warnings.join("\n"), /an intent must not hold control characters/);
});

test("modifier variants do not inherit the intent of their base key", () => {
  const { leaf_at } = labels_of({ normal: { ";a": { id: "page.reload", intent: "Y" } }, modifiers: { ";h": { hard: true } } });
  assert.equal(leaf_at(";", "a").intent, "Y");
  assert.equal(leaf_at(";", "h", "a").steps[0]!.invocation.args?.["hard"], true);
  assert.equal("intent" in leaf_at(";", "h", "a"), false);
});

test("W, B and E of the default keymap hover with WORD text", async () => {
  const { compiled } = compile_config({
    config: empty_config(),
    default_keymap: DEFAULT_KEYMAP,
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  const { panel_after_prefix } = await import("../../src/background/list_keys.ts");
  const rows = panel_after_prefix(compiled.modes.caret!, [], (id) => registry.get(id)).rows;
  for (const key of ["W", "B", "E"]) assert.match(rows.find((row) => row.keys === key)!.description, /WORD/);
});

test("on a multi-step binding the intent of the first command counts and none reaches a step", () => {
  const { leaf_at, warnings } = labels_of({ normal: { a: [{ id: "page.reload", intent: "First" }, { id: "page.reload", intent: "Second" }] } });
  assert.deepEqual(warnings, []);
  assert.equal(leaf_at("a").intent, "First");
  assert.deepEqual(leaf_at("a").steps.map((step) => step.invocation.intent), [undefined, undefined]);
});
