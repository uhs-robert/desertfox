import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import type { TreeBranch } from "../../src/shared/prefix_tree.ts";
import type { KeymapConfig } from "../../src/shared/keymap.ts";
import { check_args } from "../../src/shared/registry/index.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const bindings_of = (keymap: KeymapConfig) => Object.entries(keymap).filter(([name]) => name !== "group_names" && name !== "site_keys" && name !== "modifiers");

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
    enum_sources: { search_engines: ["site"], containers: [] },
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
  const partial = Object.fromEntries([...bindings_of(DEFAULT_KEYMAP).map(([mode, section]) => [mode, present(section)]), ["group_names", DEFAULT_KEYMAP.group_names], ["site_keys", DEFAULT_KEYMAP.site_keys], ["modifiers", DEFAULT_KEYMAP.modifiers]]) as KeymapConfig;
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

test("the q group holds the DesertFox commands", () => {
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
  const leaf_id = (mode: "normal" | "hint" | "cmdline" | "caret" | "visual" | "visual_line", ...tokens: string[]) => {
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
  assert.equal(leaf_id("normal", ";", "#"), 'cmdline.open {"text":"heading "}');
  assert.equal(leaf_id("normal", ";", ";"), 'cmdline.open {"text":"hint "}');
  assert.equal(leaf_id("normal", ";", "u"), 'cmdline.open {"text":"hint --custom "}');
  assert.equal(leaf_id("caret", "v"), 'mode.set {"mode":"visual"}');
  assert.equal(leaf_id("caret", "V"), 'mode.set {"mode":"visual_line"}');
  assert.equal(leaf_id("visual", "V"), 'mode.set {"mode":"visual_line"}');
  assert.equal(leaf_id("visual_line", "v"), 'mode.set {"mode":"visual"}');
  assert.equal(leaf_id("visual_line", "V"), 'mode.set {"mode":"caret"}');
  assert.equal(leaf_id("visual_line", "y"), 'visual.act {"action":"yank"}');
  assert.equal(leaf_id("visual_line", "o"), 'visual.act {"action":"swap"}');
  assert.equal(leaf_id("visual_line", "/"), leaf_id("visual", "/"));
  assert.equal(leaf_id("visual_line", "n"), "find.next {}");
  assert.equal(leaf_id("visual_line", "j"), leaf_id("visual", "j"));
  for (const mode of ["caret", "visual", "visual_line"] as const) {
    assert.equal(leaf_id(mode, "f"), 'caret.move {"unit":"char_find","direction":"forward","till":false,"big":false}', mode);
    assert.equal(leaf_id(mode, "T"), 'caret.move {"unit":"char_find","direction":"back","till":true,"big":false}', mode);
    assert.equal(leaf_id(mode, ","), 'caret.move {"unit":"find_repeat","direction":"back","till":false,"big":false}', mode);
  }
  for (const mode of ["hint", "cmdline", "caret", "visual", "visual_line"] as const) {
    assert.equal(leaf_id(mode, "<Escape>"), "mode.escape {}", mode);
  }
  for (const key of ["<Tab>", "<C-n>", "<A-ArrowDown>"]) assert.equal(leaf_id("cmdline", key), "cmdline.next_completion {}", key);
  for (const key of ["<S-Tab>", "<C-p>", "<A-ArrowUp>"]) assert.equal(leaf_id("cmdline", key), "cmdline.prev_completion {}", key);
  assert.equal(leaf_id("cmdline", "<C-Space>"), 'list.select {"action":"toggle"}');
  assert.equal(leaf_id("cmdline", "<A-u>"), 'list.act {"action":"unload"}');
  assert.equal(leaf_id("cmdline", "<A-x>"), 'list.act {"action":"close"}');
  assert.equal(leaf_id("cmdline", "<A-m>"), 'list.act {"action":"mute"}');
  assert.equal(leaf_id("cmdline", "<A-p>"), 'list.act {"action":"pin"}');
  assert.equal(leaf_id("cmdline", "<A-c>"), 'list.act {"action":"reopen"}');
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
    get_tab: async () => undefined,
    has_content_script: async () => true,
    ask_selection: async () => "",
    runs_with_empty: async () => false,
    read_clipboard: async () => "",
    has_permission: async () => true,
    send_to_tab: async () => undefined,
    open_cmdline: async (_tab, _frame, text) => void log.push(text),
    show_refusal: async () => undefined,
    is_disabled: async () => false,
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

test("the generated search and container keys compile against the full registry with no warnings", () => {
  const config = { ...empty_config(), keymap: { search_keys: { a: "arch" }, container_keys: { a: "Family" } } };
  const { warnings, compiled } = compile_config({
    config,
    default_keymap: DEFAULT_KEYMAP,
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: ["arch", "site"], containers: ["Family"] },
  });
  assert.deepEqual(warnings, []);
  for (const prefix of ["s", "S", "c", "C"]) assert.ok((compiled.modes.normal!.children[prefix] as TreeBranch).children.a, `${prefix}a is bound`);
});

test("the frames filter defaults to the focus action, and ;f and gF are bound", () => {
  const hint = registry.get("hint.run")!;
  const action_of = (args: Record<string, unknown>) => (check_args(hint, args) as { args: Record<string, unknown> }).args.action;
  assert.equal(action_of({ filter: "frames" }), "focus");
  assert.equal(action_of({ filter: "frames", action: "tab" }), "tab");
  assert.equal(action_of({ filter: "links" }), "here");
  const normal = DEFAULT_KEYMAP.normal as Record<string, { id: string; args?: unknown; label?: string }>;
  assert.deepEqual(normal[";f"], { id: "hint.run", args: { filter: "frames" }, label: "Focus frame", variant_label: "Frame" });
  assert.equal(normal.gF!.id, "frame.exit");
  assert.equal(registry.get("frame.exit")!.label, "Focus top page");
});

test("hint modifier variants whose action needs another filter are not bound", () => {
  const { compiled } = compile(DEFAULT_KEYMAP);
  const is_bound = (keys: string) => {
    let node: TreeBranch | undefined = compiled.modes.normal as unknown as TreeBranch;
    for (const key of keys) node = node?.children?.[key] as TreeBranch | undefined;
    return node !== undefined;
  };
  const hidden = [";Bb", ";Bp", ";Bi", ";Wb", ";Wp", ";Wi", ";yB", ";yp", ";YI", ";Yf", ";Ym", ";Yi", ";Yl", ";Yp", ";Ya"];
  const valid = [";Bl", ";BI", ";Bf", ";Bm", ";Wl", ";yl", ";yI", ";yi", ";yf", ";ym", ";yt", ";yc", ";yh", ";rb", ";hb", ";xi"];
  for (const keys of hidden) assert.equal(is_bound(keys), false, `${keys} is bound`);
  for (const keys of valid) assert.equal(is_bound(keys), true, `${keys} is missing`);
});

test("the cmdline keys are single tokens and the selection keys each have one binding, so none shadows another", () => {
  const cmdline = DEFAULT_KEYMAP.cmdline ?? {};
  for (const key of Object.keys(cmdline)) assert.match(key, /^<[^<>]+>$/, key);
  const selection_keys = ["<C-Space>", "<A-u>", "<A-x>", "<A-m>", "<A-p>", "<A-c>"];
  for (const key of selection_keys) assert.ok(!Array.isArray(cmdline[key]), key);
  assert.equal(new Set(selection_keys.map((key) => JSON.stringify(cmdline[key]))).size, selection_keys.length);
});

test("a user key that extends a real default leaf drops it with one warning", () => {
  const { warnings, compiled } = compile_config({
    config: { ...empty_config(), keymap: { normal: { gtx: { id: "tab.close" } } } },
    default_keymap: DEFAULT_KEYMAP,
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: ["site"], containers: [] },
  });
  assert.deepEqual(warnings, ['normal: dropped default keys that your keys extend: "gt" by gtx']);
  const t = (compiled.modes.normal!.children["g"] as TreeBranch).children["t"]!;
  assert.equal(t.kind, "branch");
});

const gt_prefix_config = (keymap: KeymapConfig) => ({
  config: { ...empty_config(), keymap, settings: { container_prefixes: { reopen: "gt", tab: "gT" }, search_prefixes: { here: "gt", tab: "gT" } } },
  default_keymap: DEFAULT_KEYMAP,
  get_command: (id: string) => registry.get(id),
  enum_sources: { search_engines: ["site"], containers: ["Work"] },
});

test("a container key that extends a real default leaf drops it", () => {
  const { compiled, warnings } = compile_config(gt_prefix_config({ container_keys: { x: "Work" } }));
  assert.equal(warnings.length, 1);
  assert.equal(((compiled.modes.normal!.children["g"] as TreeBranch).children["t"] as { kind: string }).kind, "branch");
});

test("a search key for an unknown engine leaves the default it would extend", () => {
  const { compiled } = compile_config(gt_prefix_config({ search_keys: { x: "nope" } }));
  assert.equal(((compiled.modes.normal!.children["g"] as TreeBranch).children["t"] as { kind: string }).kind, "leaf");
});
