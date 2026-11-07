import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compile_keymap,
  create_matcher,
  event_to_token,
  is_chord,
  parse_sequence,
  to_firefox_shortcut,
} from "../src/shared/keys/index.ts";
import type { KeyEventLike } from "../src/shared/keys/index.ts";
import type { KeymapConfig } from "../src/shared/index.ts";
import { default_layer_of, merge_keymaps } from "../src/background/keymap_merge.ts";

const tokens_of = (sequence: string) => parse_sequence(sequence).tokens;

const press = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  code: "",
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

test("parse real key sequences", () => {
  assert.deepEqual(tokens_of("gx0"), ["g", "x", "0"]);
  assert.deepEqual(tokens_of("gx$"), ["g", "x", "$"]);
  assert.deepEqual(tokens_of("<<"), ["<", "<"]);
  assert.deepEqual(tokens_of(">>"), [">", ">"]);
  assert.deepEqual(tokens_of("<AC-Escape>"), ["<AC-Escape>"]);
  assert.deepEqual(tokens_of("<CA-Escape>"), ["<AC-Escape>"]);
  assert.deepEqual(tokens_of("<AC-`>"), ["<AC-`>"]);
  assert.deepEqual(tokens_of("<S-Insert>"), ["<S-Insert>"]);
  assert.deepEqual(tokens_of("<C-[>"), ["<C-[>"]);
  assert.deepEqual(tokens_of("<F1>"), ["<F1>"]);
  assert.deepEqual(tokens_of("<A-,>"), ["<A-,>"]);
  assert.deepEqual(tokens_of("sgth"), ["s", "g", "t", "h"]);
  assert.deepEqual(tokens_of("<C-x>g;,^"), ["<C-x>", "g", ";", ",", "^"]);
});

test("shift on a letter without other modifiers is the capital letter", () => {
  assert.deepEqual(tokens_of("<S-j>"), ["J"]);
  assert.deepEqual(tokens_of("J"), ["J"]);
  assert.deepEqual(tokens_of("<C-J>"), ["<C-j>"]);
  assert.deepEqual(tokens_of("<CS-j>"), ["<CS-j>"]);
});

test("notation errors", () => {
  assert.ok(parse_sequence("").error);
  assert.ok(parse_sequence("<S-1>").error);
  assert.ok(parse_sequence("g x").error);
});

test("event to token", () => {
  assert.equal(event_to_token(press("j")), "j");
  assert.equal(event_to_token(press("J", { shiftKey: true })), "J");
  assert.equal(event_to_token(press("$", { shiftKey: true })), "$");
  assert.equal(event_to_token(press("<", { shiftKey: true })), "<");
  assert.equal(event_to_token(press("j", { altKey: true })), "<A-j>");
  assert.equal(event_to_token(press("J", { altKey: true, shiftKey: true })), "<AS-j>");
  assert.equal(event_to_token(press("x", { ctrlKey: true })), "<C-x>");
  assert.equal(event_to_token(press("[", { ctrlKey: true })), "<C-[>");
  assert.equal(event_to_token(press("!", { ctrlKey: true, shiftKey: true })), "<C-!>");
  assert.equal(event_to_token(press("Escape")), "<Escape>");
  assert.equal(event_to_token(press("Escape", { shiftKey: true })), "<S-Escape>");
  assert.equal(event_to_token(press("Escape", { altKey: true, ctrlKey: true })), "<AC-Escape>");
  assert.equal(event_to_token(press("Insert", { shiftKey: true })), "<S-Insert>");
  assert.equal(event_to_token(press("F1")), "<F1>");
  assert.equal(event_to_token(press(" ")), "<Space>");
  assert.equal(event_to_token(press("Shift", { shiftKey: true })), null);
  assert.equal(event_to_token(press("Dead")), null);
});

test("chords on another script fall back to the physical letter", () => {
  assert.equal(event_to_token(press("в", { ctrlKey: true, code: "KeyD" })), "<C-d>");
  assert.equal(event_to_token(press("в", { code: "KeyD" })), "в");
});

test("event token equals the parsed notation token", () => {
  const cases: [string, KeyEventLike][] = [
    ["<A-j>", press("j", { altKey: true })],
    ["<AC-Escape>", press("Escape", { altKey: true, ctrlKey: true })],
    ["<AC-`>", press("`", { altKey: true, ctrlKey: true })],
    ["J", press("J", { shiftKey: true })],
    ["<C-[>", press("[", { ctrlKey: true })],
    ["<Space>", press(" ")],
  ];
  for (const [sequence, event] of cases) assert.deepEqual(tokens_of(sequence), [event_to_token(event)]);
});

const resolve = (id: string) =>
  id.startsWith("bad.") ? undefined : { runs_in: id.startsWith("scroll") ? ("content" as const) : ("background" as const), label: id.toUpperCase(), count: "ignore" as const };

const compile = (keymap: KeymapConfig, settings = {}) => compile_keymap(keymap, settings, resolve);

test("compiler builds the tree with steps, runs_in and label", () => {
  const { compiled, warnings } = compile({
    normal: { gg: { id: "scroll.to" }, "gx$": [{ id: "tab.a" }, { id: "scroll.b" }] },
    browser: { "<A-j>": { id: "tab.next" } },
  });
  assert.deepEqual(warnings, []);
  const g = compiled.modes.normal!.children["g"]!;
  assert.equal(g.kind, "branch");
  const gg = g.kind === "branch" ? g.children["g"] : undefined;
  assert.deepEqual(gg, { kind: "leaf", label: "SCROLL.TO", steps: [{ invocation: { id: "scroll.to" }, runs_in: "content", count_rule: "ignore" }] });
  assert.ok(compiled.modes.browser!.children["<A-j>"]);
  assert.equal(compiled.modes.insert, undefined);
  assert.equal(compiled.which_key_delay_ms, 300);
  assert.equal(compiled.mode_indicator, "always");
});

test("compiler skips the longer entry when a shorter binding is its prefix", () => {
  const { compiled, warnings } = compile({ normal: { gg: { id: "a.b" }, g: { id: "c.d" }, gz: { id: "e.f" } } });
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((warning) => warning.includes("already a complete binding")));
  assert.equal(compiled.modes.normal!.children["g"]!.kind, "leaf");
});

test("a user key that extends a default leaf drops the default and warns once", () => {
  const defaults: KeymapConfig = { normal: { sg: { id: "a.b" }, x: { id: "a.b" } } };
  const user: KeymapConfig = { normal: { sgg: { id: "c.d" }, sgd: { id: "c.d" } } };
  const { compiled, warnings } = compile_keymap(merge_keymaps(defaults, user), {}, resolve, undefined, default_layer_of(defaults, user));
  assert.deepEqual(warnings, ['normal: dropped default keys that your keys extend: "sg" by sgg, sgd']);
  const s = compiled.modes.normal!.children["s"] as { children: Record<string, { kind: string; children: Record<string, { kind: string }> }> };
  assert.equal(s.children["g"]!.kind, "branch");
  assert.equal(s.children["g"]!.children["g"]!.kind, "leaf");
  assert.equal(s.children["g"]!.children["d"]!.kind, "leaf");
  assert.equal(compiled.modes.normal!.children["x"]!.kind, "leaf");
});

test("generated search_keys that extend a default leaf drop it", () => {
  const defaults: KeymapConfig = { normal: { s: { id: "a.b" } } };
  const user: KeymapConfig = { search_keys: { g: "github" } };
  const { compiled, warnings } = compile_keymap(merge_keymaps(defaults, user), {}, resolve, undefined, default_layer_of(defaults, user));
  assert.deepEqual(warnings, ['normal: dropped default keys that your keys extend: "s" by sg']);
  assert.equal((compiled.modes.normal!.children["s"] as { children: Record<string, { kind: string }> }).children["g"]!.kind, "leaf");
});

test("a default generated key keeps a default leaf it extends", () => {
  const defaults: KeymapConfig = { normal: { s: { id: "a.b" } }, search_keys: { g: "github" } };
  const { compiled, warnings } = compile_keymap(merge_keymaps(defaults, {}), {}, resolve, undefined, default_layer_of(defaults, {}));
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0]!.includes("already a complete binding"));
  assert.equal(compiled.modes.normal!.children["s"]!.kind, "leaf");
});

test("a null on the default leaf lets the user keys compile with no drop warning", () => {
  const defaults: KeymapConfig = { normal: { sg: { id: "a.b" } } };
  const user: KeymapConfig = { normal: { sg: null, sgg: { id: "c.d" } } };
  const { compiled, warnings } = compile_keymap(merge_keymaps(defaults, user), {}, resolve, undefined, default_layer_of(defaults, user));
  assert.deepEqual(warnings, []);
  assert.equal((compiled.modes.normal!.children["s"] as { children: Record<string, { children: Record<string, { kind: string }> }> }).children["g"]!.children["g"]!.kind, "leaf");
});

test("one warning per mode lists every dropped default", () => {
  const defaults: KeymapConfig = { normal: { sg: { id: "a.b" }, gt: { id: "a.b" } }, visual: { s: { id: "a.b" } } };
  const user: KeymapConfig = { normal: { sgg: { id: "c.d" }, gtx: { id: "c.d" } }, visual: { sx: { id: "c.d" } } };
  const { warnings } = compile_keymap(merge_keymaps(defaults, user), {}, resolve, undefined, default_layer_of(defaults, user));
  assert.deepEqual(warnings, ['normal: dropped default keys that your keys extend: "sg" by sgg; "gt" by gtx', 'visual: dropped default keys that your keys extend: "s" by sx']);
});

test("a default is kept when no user extender can compile", () => {
  const defaults: KeymapConfig = { normal: { sg: { id: "a.b" } } };
  const user: KeymapConfig = { normal: { sgg: { id: "bad.cmd" } } };
  const { compiled } = compile_keymap(merge_keymaps(defaults, user), {}, resolve, undefined, default_layer_of(defaults, user));
  assert.equal(compiled.modes.normal!.children["s"]!.kind, "branch");
  const s = compiled.modes.normal!.children["s"] as { children: Record<string, { kind: string }> };
  assert.equal(s.children["g"]!.kind, "leaf");
});

test("a user key extending a generated default variant replaces it", () => {
  const defaults: KeymapConfig = { normal: { ";l": { id: "a.b" } }, modifiers: { ";r": { rapid: true } } };
  const user: KeymapConfig = { normal: { ";rlx": { id: "c.d" } } };
  const { compiled, warnings } = compile_keymap(merge_keymaps(defaults, user), {}, resolve, undefined, default_layer_of(defaults, user));
  assert.deepEqual(warnings, ['normal: dropped default keys that your keys extend: ";rl" by ;rlx']);
  const rl = (compiled.modes.normal!.children[";"] as { children: Record<string, { kind: string; children: Record<string, { kind: string }> }> }).children["r"]!.children["l"]!;
  assert.equal(rl.kind, "branch");
});

test("a dropped default slot is not refilled by a modifier variant", () => {
  const defaults: KeymapConfig = { normal: { ";I": { id: "a.b" }, ";yI": { id: "a.b" } }, modifiers: { ";y": { copy: true } } };
  const user: KeymapConfig = { normal: { ";yIx": { id: "c.d" } } };
  const { compiled, warnings } = compile_keymap(merge_keymaps(defaults, user), {}, resolve, undefined, default_layer_of(defaults, user));
  assert.deepEqual(warnings, ['normal: dropped default keys that your keys extend: ";yI" by ;yIx']);
  const y = (compiled.modes.normal!.children[";"] as { children: Record<string, { children: Record<string, { kind: string }> }> }).children["y"]!;
  assert.equal(y.children["I"]!.kind, "branch");
});

test("a user leaf shorter than a default group keeps the user key and skips the default ones", () => {
  const defaults: KeymapConfig = { normal: { gg: { id: "a.b" }, gt: { id: "a.b" } } };
  const user: KeymapConfig = { normal: { g: { id: "c.d" } } };
  const { compiled, warnings } = compile_keymap(merge_keymaps(defaults, user), {}, resolve, undefined, default_layer_of(defaults, user));
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((warning) => warning.includes("already a complete binding")));
  assert.equal(compiled.modes.normal!.children["g"]!.kind, "leaf");
});

test("compiler warns on duplicates, unknown commands and bad notation, and honours null", () => {
  const { compiled, warnings } = compile({
    normal: { J: { id: "a.b" }, "<S-j>": { id: "c.d" }, x: { id: "bad.cmd" }, "<S-1>": { id: "a.b" }, k: null },
  });
  assert.equal(warnings.length, 3);
  assert.ok(warnings.some((warning) => warning.includes('unknown command "bad.cmd"')));
  assert.ok(warnings.some((warning) => warning.includes("<S-1>")));
  assert.equal((compiled.modes.normal!.children["J"] as { steps: { invocation: { id: string } }[] }).steps[0]!.invocation.id, "c.d");
});

test("search_keys and container_keys generate bindings, explicit ones win", () => {
  const { compiled, warnings } = compile({
    search_keys: { a: "arch" },
    container_keys: { a: "Family" },
    normal: { sa: { id: "custom.one" } },
  });
  assert.deepEqual(warnings, []);
  const children = compiled.modes.normal!.children;
  const s = children["s"];
  assert.equal(s?.kind === "branch" && (s.children["a"] as { steps: { invocation: { id: string } }[] }).steps[0]!.invocation.id, "custom.one");
  assert.ok(children["S"] && children["c"] && children["C"]);
});

test("a generated C key asks for the url, prefilled with the current page", () => {
  const { compiled, warnings } = compile({ container_keys: { a: "Family", b: "Work" } });
  assert.deepEqual(warnings, []);
  const c = compiled.modes.normal!.children["C"] as unknown as { children: Record<string, { steps: { invocation: { id: string; args: unknown; prompt: unknown } }[] }> };
  for (const [key, container] of [["a", "Family"], ["b", "Work"]]) {
    const invocation = c.children[key!]!.steps[0]!.invocation;
    assert.equal(invocation.id, "open.url");
    assert.deepEqual(invocation.args, { where: "tab", container });
    assert.deepEqual(invocation.prompt, { param: "url", prefill: { from: "current_url" } });
  }
});

const walk = (matcher: ReturnType<typeof create_matcher>, mode: string, keys: string[]) =>
  keys.map((key) => matcher.feed(mode, key));

const matcher_for = (keymap: KeymapConfig) => create_matcher(compile(keymap).compiled);
const leaf_id = (result: ReturnType<ReturnType<typeof create_matcher>["feed"]>) =>
  result.kind === "match" ? result.leaf.steps[0]!.invocation.id : result.kind;

test("matcher: single key, sequence, pending and mismatch reset", () => {
  const matcher = matcher_for({ normal: { J: { id: "tab.next" }, gg: { id: "scroll.top" }, "g0": { id: "tab.first" } } });
  assert.equal(leaf_id(matcher.feed("normal", "J")), "tab.next");
  assert.equal(matcher.feed("normal", "g").kind, "pending");
  assert.equal(leaf_id(matcher.feed("normal", "g")), "scroll.top");
  assert.equal(matcher.feed("normal", "g").kind, "pending");
  assert.equal(matcher.feed("normal", "z").kind, "no_match");
  assert.equal(leaf_id(matcher.feed("normal", "J")), "tab.next");
  assert.equal(matcher.feed("normal", "g").kind, "pending");
  assert.equal(leaf_id(matcher.feed("normal", "0")), "tab.first");
  assert.equal(matcher.feed("normal", "q").kind, "no_match");
});

test("matcher: counts", () => {
  const matcher = matcher_for({ normal: { J: { id: "tab.next" }, "0": { id: "scroll.left" }, "g0": { id: "tab.first" } } });
  const first = matcher.feed("normal", "3");
  assert.deepEqual([first.kind, first.kind === "pending" && first.count], ["pending", 3]);
  matcher.feed("normal", "1");
  const thirty_one = matcher.feed("normal", "J");
  assert.equal(thirty_one.kind === "match" && thirty_one.count, 31);
  assert.equal(leaf_id(matcher.feed("normal", "0")), "scroll.left");
  const ten = walk(matcher, "normal", ["1", "0", "J"]).at(-1)!;
  assert.equal(ten.kind === "match" && ten.count, 10);
  const after_g = walk(matcher, "normal", ["2", "g", "0"]).at(-1)!;
  assert.equal(after_g.kind === "match" && after_g.count, 2);
  assert.equal(leaf_id(after_g), "tab.first");
});

test("matcher: a bound digit wins at the start, a mismatch drops the count, other modes have no counts", () => {
  const matcher = matcher_for({ normal: { "1": { id: "bound.one" }, J: { id: "tab.next" } }, ignore: { "<S-Escape>": { id: "mode.set" }, "5": { id: "five" } } });
  assert.equal(leaf_id(matcher.feed("normal", "1")), "bound.one");
  matcher.feed("normal", "4");
  assert.equal(matcher.feed("normal", "z").kind, "no_match");
  const plain = matcher.feed("normal", "J");
  assert.equal(plain.kind === "match" && plain.count, undefined);
  assert.equal(leaf_id(matcher.feed("ignore", "5")), "five");
  assert.equal(matcher.feed("hint", "a").kind, "no_match");
});

test("matcher: caret and visual modes take counts, hint and cmdline modes do not", () => {
  const matcher = matcher_for({ caret: { w: { id: "caret.word" }, "0": { id: "caret.line_start" } }, visual: { w: { id: "visual.word" } }, hint: { w: { id: "hint.w" }, "3": { id: "hint.three" } } });
  const counted = matcher.feed("caret", "3");
  assert.equal(counted.kind, "pending");
  const word = matcher.feed("caret", "w");
  assert.equal(word.kind === "match" && word.count, 3);
  assert.equal(leaf_id(matcher.feed("caret", "0")), "caret.line_start");
  matcher.feed("visual", "1");
  matcher.feed("visual", "2");
  const visual_word = matcher.feed("visual", "w");
  assert.equal(visual_word.kind === "match" && visual_word.count, 12);
  assert.equal(leaf_id(matcher.feed("hint", "3")), "hint.three");
});

test("matcher: a mode change resets the walk", () => {
  const matcher = matcher_for({ normal: { gg: { id: "a.b" } }, ignore: { g: { id: "c.d" } } });
  matcher.feed("normal", "g");
  assert.equal(leaf_id(matcher.feed("ignore", "g")), "c.d");
  assert.equal(matcher.feed("normal", "g").kind, "pending");
});

test("firefox shortcut strings", () => {
  assert.equal(to_firefox_shortcut("<A-j>").shortcut, "Alt+J");
  assert.equal(to_firefox_shortcut("<A-,>").shortcut, "Alt+Comma");
  assert.ok(to_firefox_shortcut("<AC-Escape>").error);
  assert.equal(to_firefox_shortcut("<CS-k>").shortcut, "Ctrl+Shift+K");
  assert.equal(to_firefox_shortcut("<AC-5>").shortcut, "Ctrl+Alt+5");
  assert.equal(to_firefox_shortcut("<A-ArrowDown>").shortcut, "Alt+Down");
  assert.equal(to_firefox_shortcut("<F1>").shortcut, "F1");
  assert.ok(to_firefox_shortcut("j").error);
  assert.ok(to_firefox_shortcut("J").error);
  assert.ok(to_firefox_shortcut("<S-Insert>").error);
  assert.ok(to_firefox_shortcut("<M-j>").error);
  assert.ok(to_firefox_shortcut("<A-j>x").error);
  assert.ok(to_firefox_shortcut("<A-[>").error);
});

test("two notations for the same keys warn and the last one wins", () => {
  const { compiled, warnings } = compile({ normal: { J: { id: "a.b" }, "<S-j>": { id: "c.d" } } });
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0]!.includes('"<S-j>"') && warnings[0]!.includes('"J"'));
  assert.equal((compiled.modes.normal!.children["J"] as { steps: { invocation: { id: string } }[] }).steps[0]!.invocation.id, "c.d");
});

test("a chord is any token with Ctrl, Alt or Meta, alone or with other modifiers", () => {
  for (const token of ["<C-c>", "<A-j>", "<M-v>", "<CS-c>", "<AC-x>", "<ACMS-F5>"]) assert.equal(is_chord(token), true, token);
  for (const token of ["j", "J", "<S-Escape>", "<S-Tab>", "<Escape>", "<ArrowUp>", "<Space>"]) assert.equal(is_chord(token), false, token);
});
