import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import type { TreeBranch } from "../../src/shared/prefix_tree.ts";
import type { KeymapConfig } from "../../src/shared/keymap.ts";
import { check_args, registry } from "../../src/shared/registry/index.ts";

const bindings_of = (keymap: KeymapConfig) => Object.entries(keymap).filter(([name]) => name !== "group_names");

const ids_in = (keymap: KeymapConfig) =>
  bindings_of(keymap).flatMap(([, section]) => [section]).flatMap((section) =>
    Object.values(section as Record<string, unknown>).flatMap((binding) => [binding].flat() as { id: string }[]),
  ).map((invocation) => invocation.id);

const used_ids = [...new Set(ids_in(DEFAULT_KEYMAP))];
const missing_ids = used_ids.filter((id) => !registry.get(id));

function compile(keymap: KeymapConfig) {
  return compile_config({
    config: empty_config(),
    default_keymap: keymap,
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
}

test("the default keymap compiles against the full registry with no warnings", () => {
  assert.deepEqual(missing_ids, []);
  const { warnings, compiled } = compile(DEFAULT_KEYMAP);
  assert.deepEqual(warnings, []);
  assert.ok(compiled.modes.normal && compiled.modes.ignore && compiled.modes.browser && compiled.modes.insert);
});

test("the default bindings of commands that exist compile with no warnings", () => {
  const present = (section: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(section).filter(([, binding]) => [binding].flat().every((step) => registry.get((step as { id: string }).id))));
  const partial = Object.fromEntries([...bindings_of(DEFAULT_KEYMAP).map(([mode, section]) => [mode, present(section)]), ["group_names", DEFAULT_KEYMAP.group_names]]) as KeymapConfig;
  assert.deepEqual(compile(partial).warnings, []);
});

test("every prompting default names a real param", () => {
  for (const [, section] of bindings_of(DEFAULT_KEYMAP)) {
    for (const binding of Object.values(section as Record<string, unknown>)) {
      for (const step of [binding].flat() as { id: string; prompt?: { param: string } }[]) {
        const command = registry.get(step.id);
        if (step.prompt && command) assert.ok(command.params?.some((param) => param.name === step.prompt!.param), step.id);
      }
    }
  }
});

test("the approved keys are all bound", () => {
  const normal = Object.keys(DEFAULT_KEYMAP.normal ?? {});
  for (const key of ["h", "j", "k", "l", "gg", "G", "<C-d>", "<C-u>", "<C-f>", "<C-b>", "H", "L", "J", "K", "gt", "gT", "rr", "rh", "R", "xx", "dd", "u", "yy", "gu", "gU", "gi", "zi", "zo", "zz", "zt", "zb", "<S-Escape>", "<Escape>", "<C-v>", "<F1>", "o", "O", "tt", "f", "F", ":", "g?"]) {
    assert.ok(normal.includes(key), key);
  }
  assert.deepEqual(Object.keys(DEFAULT_KEYMAP.browser ?? {}), ["<A-j>", "<A-k>", "<A-,>"]);
  assert.deepEqual(DEFAULT_KEYMAP.ignore?.["<S-Escape>"], { id: "mode.set", args: { mode: "normal" } });
});

test("the q group holds the OasisFox commands", () => {
  const { warnings, compiled } = compile(DEFAULT_KEYMAP);
  assert.deepEqual(warnings, []);
  assert.deepEqual(DEFAULT_KEYMAP.normal?.qr, { id: "config.reload" });
  assert.deepEqual(DEFAULT_KEYMAP.normal?.qh, { id: "help.open" });
  assert.deepEqual(DEFAULT_KEYMAP.normal?.qi, { id: "mode.set", args: { mode: "ignore" } });
  assert.deepEqual(DEFAULT_KEYMAP.normal?.qb, { id: "page.blur" });
  assert.ok(compiled.modes.normal);
});

test("plain r, t and x are prefixes only", () => {
  const normal = Object.keys(DEFAULT_KEYMAP.normal ?? {});
  for (const key of ["r", "t", "x"]) assert.ok(!normal.includes(key), key);
  for (const key of ["rr", "rh", "tt", "tT", "td", "tm", "tn", "tp", "ta", "tf", "tl", "xx", "xp"]) assert.ok(normal.includes(key), key);
});

test("zz, zt and zb align the focused field", () => {
  for (const [key, position] of Object.entries({ zz: "center", zt: "top", zb: "bottom" })) {
    assert.deepEqual(DEFAULT_KEYMAP.normal?.[key], { id: "scroll.align", args: { position } });
  }
  assert.deepEqual(DEFAULT_KEYMAP.normal?.["z="], { id: "zoom.set", args: { level: 1 }, label: "Reset zoom" });
});

test("the keys of the new modes compile and resolve to their commands", () => {
  const { warnings, compiled } = compile(DEFAULT_KEYMAP);
  assert.deepEqual(warnings, []);
  const leaf_id = (mode: "normal" | "hint" | "cmdline" | "caret" | "visual", ...tokens: string[]) => {
    let node: { kind: string; children?: Record<string, unknown>; steps?: { invocation: { id: string; args?: Record<string, unknown> } }[] } | undefined = compiled.modes[mode];
    for (const token of tokens) node = node?.children?.[token] as typeof node;
    return node?.steps?.map((step) => `${step.invocation.id} ${JSON.stringify(step.invocation.args ?? {})}`).join(",");
  };
  assert.equal(leaf_id("normal", "g", "V"), 'mode.set {"mode":"caret"}');
  assert.equal(leaf_id("normal", "v"), 'mode.set {"mode":"caret"}');
  assert.equal(leaf_id("normal", "V"), 'mode.set {"mode":"visual"}');
  assert.equal(leaf_id("normal", ";", "v"), 'hint.run {"action":"caret","filter":"prose","text":"","rapid":false}');
  assert.equal(leaf_id("normal", ";", "b"), 'hint.run {"filter":"buttons","action":"here","text":"","rapid":false}');
  assert.equal(leaf_id("normal", ";", "V"), 'hint.run {"action":"visual","filter":"prose","text":"","rapid":false}');
  assert.equal(leaf_id("normal", ";", ";"), 'cmdline.open {"text":"hint "}');
  assert.equal(leaf_id("caret", "v"), 'mode.set {"mode":"visual"}');
  for (const mode of ["hint", "cmdline", "caret", "visual"] as const) {
    assert.equal(leaf_id(mode, "<Escape>"), "mode.escape {}", mode);
  }
  for (const key of ["<Tab>", "<C-n>", "<A-ArrowDown>"]) assert.equal(leaf_id("cmdline", key), "cmdline.next_completion {}", key);
  for (const key of ["<S-Tab>", "<C-p>", "<A-ArrowUp>"]) assert.equal(leaf_id("cmdline", key), "cmdline.prev_completion {}", key);
});

test("no default binds a command that does not exist", () => {
  assert.deepEqual(missing_ids, []);
});

test("every command has a one-line description that ends with a period", () => {
  for (const command of registry.list()) {
    assert.match(command.intent, /^[^\r\n]*\.$/, command.id);
  }
});

test("the default keymap names places and hint actions by the new words", () => {
  const old_words = ["current", "new_tab", "new_window"];
  const written = JSON.stringify(DEFAULT_KEYMAP);
  for (const word of old_words) assert.ok(!written.includes(`"${word}"`), word);
});

test("every default group name labels a real group, so a typo cannot go quiet", () => {
  const { compiled } = compile(DEFAULT_KEYMAP);
  const labeled: string[] = [];
  const walk = (node: TreeBranch, path: string) => {
    for (const [token, child] of Object.entries(node.children)) {
      if (child.kind !== "branch") continue;
      if (child.label) labeled.push(path + token);
      walk(child, path + token);
    }
  };
  for (const root of Object.values(compiled.modes)) walk(root, "");
  for (const prefix of Object.keys(DEFAULT_KEYMAP.group_names ?? {})) {
    if (!["s", "S", "c", "C"].includes(prefix)) assert.ok(labeled.includes(prefix), prefix);
  }
  assert.ok(!compiled.modes.normal?.children.g || (compiled.modes.normal.children.g as TreeBranch).label === "Go");
});

test("no default key searches: search keys come from the user's engines", () => {
  const normal = Object.keys(DEFAULT_KEYMAP.normal ?? {});
  assert.deepEqual(normal.filter((key) => key.startsWith("s") || key === "ri"), []);
  assert.equal(DEFAULT_KEYMAP.group_names?.sG, undefined);
});

test("a search binding on the selection opens the command line when nothing is selected", async () => {
  const { create_router } = await import("../../src/background/router.ts");
  const { no_repeat_memory } = await import("../../src/background/repeat_memory.ts");
  const log: string[] = [];
  const router = create_router({
    get_command: (id) => registry.get(id),
    get_enum_sources: async () => ({ search_engines: ["github.repo"] }),
    active_tab: async () => ({ tab_id: 3, window_id: 1, url: "https://github.com/a/b" }),
    has_content_script: async () => true,
    ask_selection: async () => "",
    runs_with_empty: async () => false,
    read_clipboard: async () => "",
    has_permission: async () => true,
    send_to_tab: async () => undefined,
    open_cmdline: async (_tab, _frame, text) => void log.push(text),
    show_refusal: async () => undefined,
    repeat_memory: no_repeat_memory,
  });
  const binding = { id: "open.search", args: { query: { from: "selection" } } };
  await router.run({ invocations: [binding], mode: "normal", may_prompt: true });
  assert.deepEqual(log, ["search "]);
});

test("a prompt binding with a bad fixed arg is skipped with a warning", () => {
  const { warnings } = compile({ normal: { "q1": { id: "open.url", args: { where: "bogus" }, prompt: { param: "url" } }, "q2": { id: "open.url", args: { where: "tab" }, prompt: { param: "url" } } } } as KeymapConfig);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /skipped "q1".*where/);
});


test("`.` repeats the last command", () => {
  assert.deepEqual((DEFAULT_KEYMAP.normal as Record<string, unknown>)["."], { id: "command.repeat" });
});
