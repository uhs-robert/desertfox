import assert from "node:assert/strict";
import { test } from "node:test";
import { open_quick_start_on_install } from "../src/background/first_install.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import type { Block, Inline } from "../src/help/blocks.ts";
import "../src/background/command_modules.ts";
import { quick_start_blocks, quick_start_fallbacks } from "../src/help/quick_start.ts";
import { parse_route } from "../src/help/route.ts";
import { compile_keymap } from "../src/shared/keys/compiler.ts";
import { command_meta } from "../src/shared/registry/index.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { parse_command_line } from "../src/shared/registry/command_line.ts";

const all_commands = registry.list().map(command_meta);
const any_command = { runs_in: "content" as const, label: "x", count: "ignore" as const };
const compile = (keymap: typeof DEFAULT_KEYMAP) => compile_keymap(keymap, {}, () => any_command).compiled;

function codes_of(blocks: Block[]): string[] {
  const code_of = (inlines: Inline[]) => inlines.filter((inline) => (inline.kind === "code" || inline.kind === "keys")).map((inline) => inline.text);
  return blocks.flatMap((block) => (block.kind === "paragraph" ? code_of(block.inlines) : block.kind === "list" ? block.items.flatMap(code_of) : []));
}

test("quick start: the keys come from the keymap", () => {
  const codes = codes_of(quick_start_blocks(compile(DEFAULT_KEYMAP), all_commands));
  for (const key of ["j", "k", "gg", "G", "f", ":", "/", "?", "n", "N", "v", ";v", ";V", "g?", "y", "o", "<Escape>"]) assert.ok(codes.includes(key), key);
});

test("quick start: the host keys follow a rebind and fall back to the command line", () => {
  const rebound = codes_of(quick_start_blocks(compile({ ...DEFAULT_KEYMAP, insert: { "<A-e>": { id: "text.edit_external" } } } as never), all_commands));
  assert.ok(rebound.includes("<A-e>"));
  assert.ok(!rebound.includes("<C-o>"));
  const unbound = codes_of(quick_start_blocks(compile({ ...DEFAULT_KEYMAP, insert: {} } as never), all_commands));
  assert.ok(!unbound.includes("<C-o>"));
});

test("quick start: the copy example names a key that copies a link address", () => {
  assert.ok(codes_of(quick_start_blocks(compile(DEFAULT_KEYMAP), all_commands)).includes(";yl"));
});

test("quick start: a rebind changes the page and an unbound key falls back to the command line", () => {
  const { f: _hint, v: _caret, gV: _caret_too, ...rest } = DEFAULT_KEYMAP.normal!;
  const rebound = { ...DEFAULT_KEYMAP, normal: { ...rest, "<A-f>": { id: "hint.run", args: { action: "here" } } } };
  const codes = codes_of(quick_start_blocks(compile(rebound), all_commands));
  // `;b` clicks buttons only, so it does not stand in for `f`.
  assert.ok(codes.includes("<A-f>"));
  assert.ok(!codes.includes(";b"));
  assert.ok(!codes.includes("f"));
  assert.ok(codes.includes(":mode caret"));
  assert.ok(codes_of(quick_start_blocks(undefined, all_commands)).includes(":hint"));
});

function codes_with_normal(extra: Record<string, unknown>, drop: string[] = [], keymap = DEFAULT_KEYMAP): string[] {
  const normal = Object.fromEntries(Object.entries(keymap.normal!).filter(([key]) => !drop.includes(key)));
  return codes_of(quick_start_blocks(compile({ ...keymap, normal: { ...normal, ...extra } } as typeof DEFAULT_KEYMAP), all_commands));
}

test("quick start: a key that runs several steps is not picked", () => {
  const codes = codes_with_normal({ "<A-j>": [{ id: "scroll.lines", args: { count: -10 } }, { id: "scroll.lines", args: { count: 10 } }] }, ["j"]);
  assert.ok(!codes.includes("<A-j>"));
  assert.ok(codes.includes(":scroll 10"));
});

test("quick start: a copy hint bound to inputs only is not picked", () => {
  const { ";yl": _link, ...normal } = DEFAULT_KEYMAP.normal as Record<string, unknown>;
  const codes = codes_with_normal({ "<A-y>": { id: "hint.run", args: { action: "copy", filter: "inputs" } } }, [], { ...DEFAULT_KEYMAP, normal: normal as never });
  assert.ok(!codes.includes("<A-y>"));
  assert.ok(codes.includes(":hint --copy --links"));
});

test("quick start: a hint on inputs only is not picked for clicking", () => {
  const codes = codes_with_normal({ "<A-i>": { id: "hint.run", args: { action: "here", filter: "inputs" } } }, ["f"]);
  assert.ok(!codes.includes("<A-i>"));
  assert.ok(codes.includes(":hint"));
});

test("quick start: the default keymap gives the keys it always gave", () => {
  const codes = codes_of(quick_start_blocks(compile(DEFAULT_KEYMAP), all_commands));
  assert.deepEqual(codes, ["f", "j", "k", "gg", "G", "<C-d>", "f", "<Escape>", ";yl", ":", "open", "<Escape>", ",,", "g", "<Escape>", "/", "?", "n", "N", "v", "h", "j", "k", "l", "w", "v", "V", "y", "o", "<Escape>", ";v", ";V", "g?", ",s", "<C-o>", ",fs", "~/.config/desertfox/", "config.reload", ":native.install"]);
});

test("quick start: a binding that spells out a default still matches", () => {
  const { "/": _find, ...rest } = DEFAULT_KEYMAP.normal!;
  const spelled = { ...DEFAULT_KEYMAP, normal: { ...rest, "<A-/>": { id: "find.open", args: { direction: "forward" } } } };
  assert.ok(codes_of(quick_start_blocks(compile(spelled), all_commands)).includes("<A-/>"));
});

test("quick start: a command with no command line form says it has no key, and a keymap with no group names none", () => {
  const texts = (blocks: Block[]) => blocks.flatMap((block) => (block.kind === "paragraph" ? block.inlines.map((inline) => inline.text) : []));
  const bare = compile({ ...DEFAULT_KEYMAP, site_keys: {}, normal: { j: { id: "scroll.lines", args: { count: 10 } } } });
  const shown = texts(quick_start_blocks(bare, all_commands));
  assert.ok(shown.includes("(no key bound)"));
  assert.ok(shown.some((text) => text.includes("No key opens it by itself")));
});

const compile_with = (settings: Record<string, unknown>) => compile_keymap(DEFAULT_KEYMAP, settings as never, () => any_command).compiled;
const inline_texts = (blocks: Block[]) => blocks.flatMap((block) => (block.kind === "paragraph" ? block.inlines.map((inline) => inline.text) : []));
const which_key_paragraph = (compiled: ReturnType<typeof compile>) => inline_texts(quick_start_blocks(compiled, all_commands)).join("");

test("quick start: the which-key example skips a prefix in which_key_skip", () => {
  const text = which_key_paragraph(compile_with({ which_key_skip: ["g"] }));
  assert.ok(!text.includes("Press g and wait"));
  assert.match(text, /Press . and wait/);
});

test("quick start: with no wait or every prefix skipped, it promises no panel after a wait", () => {
  for (const settings of [{ which_key_delay_ms: 0 }, { which_key_delay_ms: 0, which_key_skip: ["g"] }]) {
    const text = which_key_paragraph(compile_with(settings));
    assert.ok(!text.includes(" and wait."), JSON.stringify(settings));
    assert.match(text, /opens it on request/);
  }
});

test("practice: a note that promises the panel after a wait is dropped when the panel cannot open", async () => {
  const { practice_lessons } = await import("../src/help/practice_lessons.ts");
  const notes = (settings: Record<string, unknown>, slug: string) => practice_lessons(compile_with(settings), all_commands).find((lesson) => lesson.slug === slug)!.notes.map((note) => note.map((inline) => inline.text).join(""));
  assert.ok(notes({}, "inputs").some((note) => note.includes("and wait")));
  assert.ok(notes({}, "which-key").some((note) => note.includes("and wait")));
  assert.deepEqual(notes({ which_key_skip: [";"] }, "inputs"), []);
  assert.ok(notes({ which_key_skip: ["g"] }, "which-key").every((note) => !note.includes("Press g and wait")));
  for (const slug of ["inputs", "which-key"]) assert.ok(notes({ which_key_delay_ms: 0 }, slug).every((note) => !note.includes("and wait")));
});

test("practice: a hint key bound to one key promises no panel after a wait", async () => {
  const { practice_lessons } = await import("../src/help/practice_lessons.ts");
  const normal = Object.fromEntries(Object.entries(DEFAULT_KEYMAP.normal ?? {}).filter(([, bound]) => (bound as { args?: { filter?: string; rapid?: boolean } }).args?.filter !== "inputs"));
  const single = compile({ ...DEFAULT_KEYMAP, normal: { ...normal, x: { id: "hint.run", args: { filter: "inputs" } } } } as never);
  assert.deepEqual(practice_lessons(single, all_commands).find((lesson) => lesson.slug === "inputs")!.notes, []);
});

test("practice: the hint-key note claims only what holds for any prefix", async () => {
  const { practice_lessons } = await import("../src/help/practice_lessons.ts");
  const normal = Object.fromEntries(Object.entries(DEFAULT_KEYMAP.normal ?? {}).filter(([, bound]) => (bound as { args?: { filter?: string; rapid?: boolean } }).args?.filter !== "inputs"));
  const under_q = compile({ ...DEFAULT_KEYMAP, normal: { ...normal, Qi: { id: "hint.run", args: { filter: "inputs" } } } } as never);
  const notes = practice_lessons(under_q, all_commands).find((lesson) => lesson.slug === "inputs")!.notes.map((note) => note.map((inline) => inline.text).join(""));
  assert.deepEqual(notes, ["Press Q and wait. The panel lists the keys that can come next."]);
});

test("practice: the grab lesson names no key letter apart from the bound keys", async () => {
  const { practice_lessons } = await import("../src/help/practice_lessons.ts");
  const normal = Object.fromEntries(Object.entries(DEFAULT_KEYMAP.normal ?? {}).filter(([, bound]) => (bound as { args?: { action?: string } }).args?.action !== "grab_move"));
  const rebound = compile({ ...DEFAULT_KEYMAP, normal: { ...normal, "<A-g>": { id: "hint.run", args: { action: "grab_move", filter: "draggable" } } } } as never);
  const codes = practice_lessons(rebound, all_commands).find((lesson) => lesson.slug === "slider")!.steps.flat().filter((inline) => inline.kind === "code");
  assert.ok(!codes.some((inline) => /^[;Gg]$/.test(inline.text)), JSON.stringify(codes));
});

test("quick start: every command line it can show resolves in the registry", () => {
  const lookup = { find: (word: string) => registry.list().find((command) => (command.name ?? command.id) === word) };
  const fallbacks = quick_start_fallbacks(all_commands);
  assert.ok(fallbacks.length > 0);
  for (const { id, text } of fallbacks) {
    const parsed = parse_command_line(lookup, text.slice(1));
    assert.equal(parsed.kind, "invocation", text);
    if (parsed.kind === "invocation") assert.equal(parsed.invocation.id, id, text);
  }
});

test("the Quick Start route and the install URL agree", async () => {
  assert.equal(parse_route("#/quick-start").page, "quick-start");
  const opened: string[] = [];
  const deps = (reason: string) => ({ reason, open_tab: async (url: string) => void opened.push(url) });
  const url_of = (file: string) => `moz-extension://x/${file}`;
  assert.equal(await open_quick_start_on_install(deps("install"), url_of), true);
  assert.deepEqual(opened, ["moz-extension://x/home.html#/quick-start"]);
});

test("the Quick Start page opens on a first install only", async () => {
  const opened: string[] = [];
  const url_of = (file: string) => file;
  for (const reason of ["update", "browser_update"]) {
    assert.equal(await open_quick_start_on_install({ reason, open_tab: async (url) => void opened.push(url) }, url_of), false, reason);
  }
  assert.deepEqual(opened, []);
});

test("quick start: a bound key is a keys inline and a command line or name is a code inline", () => {
  const inlines = quick_start_blocks(compile(DEFAULT_KEYMAP), all_commands).flatMap((block) => (block.kind === "paragraph" ? block.inlines : block.kind === "list" ? block.items.flat() : []));
  assert.ok(inlines.some((inline) => inline.kind === "keys" && inline.text === "gg"));
  assert.ok(inlines.some((inline) => inline.kind === "code" && inline.text === ":native.install"));
  assert.ok(!inlines.some((inline) => inline.kind === "code" && inline.text === "gg"));
});

test("practice: every lesson key comes from the keymap, and each lesson names its fastest key", async () => {
  const { practice_lessons, practice_intro, practice_outro } = await import("../src/help/practice_lessons.ts");
  const compiled = compile(DEFAULT_KEYMAP);
  const lessons = practice_lessons(compiled, all_commands);
  assert.equal(lessons.length, 15);
  const inlines_of = (slug: string) => { const lesson = lessons.find((each) => each.slug === slug)!; return [...lesson.goal, ...lesson.steps.flat(), ...lesson.notes.flat()]; };
  const keys = (slug: string) => inlines_of(slug).filter((inline) => inline.kind === "keys").map((inline) => inline.text);
  // A default key that went missing would show as a command line or as "(no key bound)".
  for (const inline of [...lessons.flatMap((lesson) => inlines_of(lesson.slug)), ...practice_intro(compiled, all_commands), ...practice_outro(compiled, all_commands)]) {
    assert.ok(!(inline.kind === "code" && inline.text.startsWith(":")) && inline.text !== "(no key bound)", JSON.stringify(inline));
  }
  const expected: Record<string, string[]> = {
    scroll: ["j", "k", "<C-d>", "<C-u>", "G", "gg", "l", "h"],
    "which-key": ["<A-?>"],
    headings: ["]h", "[h", "sh"],
    form: ["gi", "]i", "[i"],
    inputs: [";i", ";ri", ";b"],
    slider: [";Gg", ";gg", "l", "h", "<Enter>", "?"],
    list: ["I", "j", "k", "<Enter>", "<Escape>", "gg", "G"],
    copy: [";yt", ";V", "as", "y"],
    "command-line": [":", "H"],
    tabs: ["F", "T", "dd", "<A-x>", "gl"],
    video: ["aa", "<Space>", "H"],
    marks: ["m", "'", "<C-o>"],
    ignore: ["<C-v>", "<S-Escape>"],
  };
  for (const [slug, wanted] of Object.entries(expected)) for (const key of wanted) assert.ok(keys(slug).includes(key), `${slug} lacks ${key}: ${keys(slug).join(" ")}`);
  // The tab lesson teaches the tab list, and names Find anything only as the wider search.
  assert.ok(keys("tabs").indexOf("T") < keys("tabs").indexOf(",,"));
  const rebound = practice_lessons(compile({ ...DEFAULT_KEYMAP, normal: { ...Object.fromEntries(Object.entries(DEFAULT_KEYMAP.normal ?? {}).filter(([key]) => key !== "gi" && key !== ";fe")), "<A-i>": { id: "page.focus_input" } } } as never), all_commands);
  assert.ok(rebound.find((lesson) => lesson.slug === "form")!.steps.flat().some((inline) => inline.kind === "keys" && inline.text === "<A-i>"));
  // Only the exact two-step picker is the lesson key: a lone pick and a longer macro do something else.
  const pick_key = (normal: Record<string, unknown>) => practice_lessons(compile({ ...DEFAULT_KEYMAP, normal } as never), all_commands).find((lesson) => lesson.slug === "list")!.steps[0]!.find((inline) => inline.kind === "keys" || inline.kind === "code");
  const without_i = Object.fromEntries(Object.entries(DEFAULT_KEYMAP.normal ?? {}).filter(([key]) => key !== "I"));
  const pick = { id: "hint.run", args: { filter: "lists" } };
  assert.deepEqual(pick_key({ ...without_i, "<A-p>": [pick, { id: "page.item", args: { direction: "current" } }] }), { kind: "keys", text: "<A-p>" });
  assert.notDeepEqual(pick_key({ ...without_i, "<A-p>": pick }), { kind: "keys", text: "<A-p>" });
  assert.notDeepEqual(pick_key({ ...without_i, "<A-p>": [pick, { id: "page.item", args: { direction: "current" } }, { id: "scroll.to", args: { percent: 0 } }] }), { kind: "keys", text: "<A-p>" });
  // The which-key step names the first key of the zoom keys in use, not a fixed z.
  const zoom_step = (keymap: unknown) => practice_lessons(compile(keymap as never), all_commands).find((lesson) => lesson.slug === "which-key")!.steps[1]![1];
  assert.deepEqual(zoom_step(DEFAULT_KEYMAP), { kind: "keys", text: "z" });
  const zoom_on_q = { ...DEFAULT_KEYMAP, normal: { ...Object.fromEntries(Object.entries(DEFAULT_KEYMAP.normal ?? {}).filter(([, bound]) => (bound as { id?: string }).id !== "zoom.by")), Qi: { id: "zoom.by", args: { delta: 0.1 } } } };
  assert.deepEqual(zoom_step(zoom_on_q), { kind: "keys", text: "Q" });
  const links = quick_start_blocks(compiled, all_commands).flatMap((block) => (block.kind === "paragraph" ? block.inlines : [])).filter((inline) => inline.kind === "link");
  assert.deepEqual(links, [{ kind: "link", text: "Practice page", href: "#/practice" }]);
});
