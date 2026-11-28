import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { MAX_COUNT, MAX_SEQUENCE_KEYS, MAX_TREE_BYTES, validate_module_state, validate_scope_tree } from "../src/shared/browser_module_protocol.ts";
import type { ScopeNode, ScopeTree } from "../src/shared/browser_module_protocol.ts";
import { locked_page_command_ids, matcher_keymap_of, page_hint_action_of, resolve_run, runs_on_locked_pages, scope_tree_of } from "../src/shared/browser_module_scope.ts";
import type { MatcherLeaf } from "../src/shared/browser_module_scope.ts";
import { empty_config } from "../src/shared/config/config_load.ts";
import type { KeymapConfig } from "../src/shared/keymap.ts";
import { DEFAULT_KEYMAP } from "../src/shared/keys/default_keymap.ts";
import { create_matcher } from "../src/shared/keys/matcher.ts";
import type { CompiledKeymap, TreeLeaf } from "../src/shared/prefix_tree.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { check_args } from "../src/shared/registry/check_args.ts";

const allowed = locked_page_command_ids(registry.list());
const real_check = (id: string, args: Record<string, unknown> | undefined) => {
  const command = registry.get(id);
  const checked = command && check_args(command, args);
  return checked?.ok ? checked.args : undefined;
};
const compiled = (keymap: KeymapConfig = {}): CompiledKeymap => compile_config({ config: { ...empty_config(), keymap }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} }).compiled;
const DEFAULT_TREE = scope_tree_of(compiled(), allowed, real_check);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

const node_at = (tree: ScopeTree, keys: string[]): ScopeNode | undefined => {
  let node: ScopeNode | undefined = tree;
  for (const key of keys) node = typeof node === "object" && "children" in node ? node.children[key] : undefined;
  return node;
};

test("the locked-page set: background commands that need no page, minus the deny list", () => {
  // A new background command shows here in review. A command that needs a page must stay out.
  assert.deepEqual([...allowed].sort(), [
    "bookmark.add", "bookmark.edit_url", "bookmark.move", "bookmark.open", "bookmark.open_folder", "bookmark.remove", "bookmark.rename",
    "browser.close_all", "browser.focus_page", "browser.open_firefox_page", "command.repeat", "config.reload", "copy.tabs", "debug.perf", "debug.restart", "engine.show",
    "help.issue", "help.key", "help.open", "hint.browser", "history.open", "macro.play", "macro.stop", "mark.clear", "mark.delete", "mark.list",
    "native.install", "native.update", "open.anything", "open.clipboard", "open.search", "open.url",
    "page.back", "page.forward", "page.home", "page.print", "page.reader", "page.reload", "page.save_pdf",
    "pane.close_both", "pane.equalize", "pane.focus", "pane.focus_side", "pane.move", "pane.resize", "pane.split", "pane.unsplit", "permissions.grant",
    "quickmark.add", "quickmark.delete", "quickmark.list", "quickmark.open", "register.list",
    "session.delete", "session.open", "session.rename", "session.save", "settings.set", "settings.toggle", "settings.unset",
    "tab.alternate", "tab.alternate_any_window", "tab.attach", "tab.close", "tab.detach", "tab.duplicate", "tab.goto", "tab.goto_audible", "tab.load", "tab.move", "tab.mute", "tab.next", "tab.pin", "tab.prev", "tab.reopen_in_container", "tab.split_other", "tab.split_swap", "tab.switch", "tab.undo_close", "tab.unload",
    "tabgroup.add", "tabgroup.close", "tabgroup.collapse", "tabgroup.color", "tabgroup.expand", "tabgroup.name", "tabgroup.next", "tabgroup.prev", "tabgroup.remove", "tabgroup.toggle",
    "url.increment", "url.parent", "url.root", "window.close", "window.new", "window.undo_close", "zoom.by", "zoom.set",
  ]);
  for (const id of ["media.act", "frame.exit", "macro.record", "mode.insert", "hint.run", "scroll.lines", "page.stop", "sidebar.down", "sidebar.leave"]) assert.equal(allowed.has(id), false, id);
  assert.equal(runs_on_locked_pages({ id: "x.y", runs_in: "background", needs: ["content"] }), false);
});

test("the default tree keeps the background keys and leaves the page's keys to the page", () => {
  for (const keys of [["H"], ["L"], ["x", "x"], ["u"], ["g", "t"], ["<", "<"], ["r", "r"], ["w", "n"], ["z", "i"], ["o"], ["T"], ["w", "w"]]) assert.equal(node_at(DEFAULT_TREE, keys), "forward", keys.join(""));
  // The module's own commands run natively, sequences too.
  assert.deepEqual(node_at(DEFAULT_TREE, ["J"]), { native: "tab.next", args: {}, count_rule: "repeat" });
  assert.deepEqual(node_at(DEFAULT_TREE, ["g", "g"]), { native: "scroll.to", args: { percent: 0, axis: "y" } });
  assert.deepEqual(node_at(DEFAULT_TREE, ["<C-d>"]), { native: "scroll.pages", args: { fraction: 0.5, count: 1 }, count_rule: { param: "count" } });
  // A capture key keeps its any-key child.
  assert.equal(node_at(DEFAULT_TREE, ["@", ""]), "forward");
  // A page swaps the record key for macro.stop while a macro records, which the stored tree cannot follow, so `q` stays with the page.
  assert.equal(node_at(DEFAULT_TREE, ["q"]), undefined);
  // Hints, find, the command line, marks, insert mode and the copy keys need DesertFox's page code.
  for (const keys of [["f"], ["/"], ["i"], ["m"], ["y", "y"], [";"], ["<Esc>"]]) assert.equal(node_at(DEFAULT_TREE, keys), undefined, keys.join(""));
  // The bare command line key stays, so the background opens the line as a panel. A line with typed text (`A`, `tM`) does not.
  assert.equal(node_at(DEFAULT_TREE, [":"]), "forward");
  for (const keys of [["A"], ["t", "M"]]) assert.equal(node_at(DEFAULT_TREE, keys), undefined, keys.join(""));
  assert.ok(validate_scope_tree(DEFAULT_TREE).ok);
});

test("the tree names the hint keys of the user's keymap, which the module claims where hints cannot run now", () => {
  for (const keys of ["f", "F", "; l", "w h"]) assert.ok(DEFAULT_TREE.hint_keys?.includes(keys), keys);
  // `gB` hints Firefox itself in the module, and `;;` only opens the line with text.
  for (const keys of ["g B", "; ;", "x x"]) assert.equal(DEFAULT_TREE.hint_keys?.includes(keys), false, keys);
  const rebound = scope_tree_of(compiled({ normal: { f: null, e: { id: "hint.run", args: { action: "here" } } } } as KeymapConfig), allowed, real_check);
  assert.ok(rebound.hint_keys?.includes("e"), "a remapped hint key");
  assert.equal(rebound.hint_keys?.includes("f"), false, "an unbound default");
  for (const junk of ["", "a  b", 3]) assert.equal(validate_scope_tree({ children: {}, hint_keys: [junk] }).ok, false, JSON.stringify(junk));
  const refused = resolve_run(compiled(), "f", 0, allowed);
  assert.deepEqual(refused, { ok: false, problem: "f needs a page DesertFox runs on", shown: true, hint: true });
  assert.equal((resolve_run(compiled(), "i", 0, allowed) as { hint?: true }).hint, undefined, "a key that needs a page but starts no hints");
});

test("the tree names the forward keys that open the line, so the module holds the keys after them", () => {
  // `:` opens the line, and `o`, `T` and `ww` prompt for a value. The keys that run at once do not.
  for (const keys of [":", "o", "T", "w w"]) assert.ok(DEFAULT_TREE.line_keys?.includes(keys), keys);
  for (const keys of ["u", "x x", "g t"]) assert.equal(DEFAULT_TREE.line_keys?.includes(keys), false, keys);
  assert.equal(DEFAULT_TREE.line_keys?.some((keys) => keys.split(" ").includes("")), false, "a path through the capture key");
  for (const junk of ["", "a  b", 3]) assert.equal(validate_scope_tree({ children: {}, line_keys: [junk] }).ok, false, JSON.stringify(junk));
  assert.equal(validate_scope_tree({ children: {}, line_keys: ":" }).ok, false);
  // A module that predates the field reads the tree by `children` alone.
  assert.equal(validate_scope_tree({ children: {} }).ok, true);
});

test("the default tree is about 4 KB and a large keymap's stays under the cap", () => {
  const size = bytes(DEFAULT_TREE);
  assert.ok(size > 2000 && size < 6000, `default tree ${size} bytes`);
  // 400 more three-key sequences, far more than a large user keymap binds.
  const letters = "abcdefghijklmnopqrst";
  const extra: KeymapConfig["normal"] = {};
  for (const first of letters) for (const second of letters) extra[`<A-${first}>${second}x`] = { id: "tab.close" };
  const large = scope_tree_of(compiled({ normal: extra }), allowed, real_check);
  const large_size = bytes(large);
  assert.ok(large_size > 15000 && large_size < MAX_TREE_BYTES, `large tree ${large_size} bytes`);
  assert.ok(validate_scope_tree(large).ok);
});

test("a remapped key follows, and an unbound key leaves the tree", () => {
  const remapped = scope_tree_of(compiled({ normal: { J: { id: "tab.close" }, H: null } }), allowed, real_check);
  assert.equal(node_at(remapped, ["J"]), "forward");
  assert.equal(node_at(remapped, ["H"]), undefined);
  // A key bound to a page command leaves too.
  const to_page = scope_tree_of(compiled({ normal: { u: { id: "hint.run" } } }), allowed, real_check);
  assert.equal(node_at(to_page, ["u"]), undefined);
  assert.deepEqual(scope_tree_of(undefined, allowed, real_check), { children: {} });
  assert.deepEqual(scope_tree_of({ ...compiled(), format_version: 1 as never }, allowed, real_check), { children: {} });
});

test("a guarded leaf, a step of another mode and a multi-step leaf with a page step stay out", () => {
  const step = (id: string, runs_in: "background" | "content") => ({ invocation: { id }, runs_in, count_rule: "ignore" as const });
  const tree = (leaf: TreeLeaf) => scope_tree_of({ ...compiled(), modes: { normal: { kind: "branch", children: { a: leaf } } } }, allowed, real_check);
  assert.equal(node_at(tree({ kind: "leaf", steps: [step("tab.close", "background")], when_focus: "input" }), ["a"]), undefined);
  assert.equal(node_at(tree({ kind: "leaf", steps: [step("tab.close", "background"), step("hint.run", "content")] }), ["a"]), undefined);
  assert.equal(node_at(tree({ kind: "leaf", steps: [{ ...step("tab.close", "background"), leave: true }] }), ["a"]), undefined);
  assert.equal(node_at(tree({ kind: "leaf", steps: [step("tab.close", "background"), step("page.back", "background")] }), ["a"]), "forward");
});

test("the module's matcher walks the tree: sequences, counts and the any-key child", () => {
  const matcher = create_matcher(matcher_keymap_of(DEFAULT_TREE));
  const scope_of = (result: ReturnType<typeof matcher.feed>) => (result.kind_ === "match" ? (result.leaf as MatcherLeaf).scope : undefined);
  assert.equal(matcher.feed("normal", "g").kind_, "pending");
  assert.deepEqual(scope_of(matcher.feed("normal", "g")), { native: "scroll.to", args: { percent: 0, axis: "y" } });
  matcher.feed("normal", "5");
  const counted = matcher.feed("normal", "x");
  assert.equal(counted.kind_, "pending");
  const closed = matcher.feed("normal", "x");
  assert.equal(scope_of(closed), "forward");
  assert.equal(closed.kind_ === "match" && closed.count, 5);
  matcher.feed("normal", "@");
  assert.equal(scope_of(matcher.feed("normal", "a")), "forward");
  assert.equal(matcher.feed("normal", "f").kind_, "no_match");
});

test("the tree check refuses junk, depth, size and a native leaf the module does not run", () => {
  for (const junk of [undefined, null, 3, "forward", [], { children: [] }, { children: { a: "run" } }, { children: { "a b": "forward" } }, { children: { a: { native: "tab.close", args: {} } } }, { children: { a: { native: "scroll.lines", args: { count: "x" } } } }, { children: { a: { native: "tab.next", args: {}, count_rule: { param: "evil" } } } }]) {
    assert.equal(validate_scope_tree(junk).ok, false, JSON.stringify(junk));
  }
  let deep: ScopeTree = { children: { a: "forward" } };
  for (let depth = 0; depth < MAX_SEQUENCE_KEYS; depth++) deep = { children: { a: deep } };
  assert.equal(validate_scope_tree(deep).ok, false);
  const wide: ScopeTree = { children: Object.fromEntries(Array.from({ length: 3000 }, (_, index) => [`<F${index}>`, "forward" as const])) };
  assert.equal(validate_scope_tree(wide).ok, false);
  // The state carries a good tree and fails with a bad one. An older state without one still passes.
  const state = { v: 1, enabled: true, keys: [], tabs: {} };
  const carried = validate_module_state({ ...state, tree: DEFAULT_TREE });
  assert.deepEqual(carried.ok && carried.value.tree, DEFAULT_TREE);
  assert.equal(validate_module_state({ ...state, tree: { children: { a: 1 } } }).ok, false);
  assert.ok(validate_module_state(state).ok);
});

test("a run request's keys are matched again against the full tree", () => {
  const keymap = compiled();
  const ran = (keys: string, count = 0) => resolve_run(keymap, keys, count, allowed);
  const xx = ran("x x");
  assert.ok(xx.ok && xx.leaf.steps[0]!.invocation.id === "tab.close" && xx.count === undefined);
  const counted = ran("x x", 3);
  assert.ok(counted.ok && counted.count === 3);
  // A capture key fills its param from the last key.
  const play = ran("@ a");
  assert.ok(play.ok && Object.values(play.leaf.steps[0]!.invocation.args ?? {}).includes("a"), JSON.stringify(play));
  // A prompt key resolves with its prompt, and the router opens the line.
  const open = ran("o");
  assert.ok(open.ok && open.leaf.steps[0]!.invocation.prompt !== undefined);
});

test("a forged, stale or page key, a typed count or register and junk are refused", () => {
  const keymap = compiled();
  const refused = (keys: string, count = 0, at: CompiledKeymap | undefined = keymap) => {
    const result = resolve_run(at, keys, count, allowed);
    assert.equal(result.ok, false, `${keys} ran`);
    return result.ok ? undefined : result;
  };
  // Not bound, a prefix only, a sequence broken and retried as a first key, past the leaf.
  for (const keys of ["Q Q Q", "g", "g J", "x x x", "<C-S-F12>"]) assert.equal(refused(keys)?.shown, true, keys);
  // Bound, but to page code: hints, find, the command line, a mark.
  for (const keys of ["f", "/", "A", "m a"]) assert.match(refused(keys)!.problem, /needs a page/, keys);
  // A count, a register or a hold belong in `count`, never in the keys.
  for (const keys of ["5 x x", "\" a x x", "t <Space> n"]) refused(keys);
  // Junk keys text is no sequence and is not shown.
  for (const keys of ["", "x  x", "x\tx", "a".repeat(30), Array(MAX_SEQUENCE_KEYS + 1).fill("x").join(" "), "\u0000"]) assert.equal(refused(keys)?.shown, undefined, JSON.stringify(keys));
  for (const count of [-1, 1.5, MAX_COUNT + 1]) assert.equal(refused("x x", count)?.shown, undefined, String(count));
  // A tree the module still holds from before a remap: the keymap now unbinds xx.
  refused("x x", 0, compiled({ normal: { xx: null } }));
  assert.equal(resolve_run(undefined, "x x", 0, allowed).ok, false);
});

test("a hint key on one of Firefox's own pages maps to the page action of its binding, and any other hint is refused", () => {
  const keymap = compiled({ normal: { gF: { id: "hint.run", args: { action: "tab" } }, gY: { id: "hint.run", args: { action: "copy", filter: "links", rapid: true } }, gX: [{ id: "hint.run", args: {} }, { id: "page.item", args: { direction: "current" } }] } });
  const action = (keys: string) => page_hint_action_of(keymap, keys);
  assert.deepEqual(action("f"), { ok: true, action: "follow" });
  assert.deepEqual(action("F"), { ok: true, action: "background" });
  assert.deepEqual(action("g F"), { ok: true, action: "tab" });
  assert.deepEqual(action("; y l"), { ok: true, action: "yank" });
  const refused = { ok: false, problem: "This hint does not run on this page" };
  // A window, a filter that needs page code, a rapid copy, a second step, a caret start and a key that is no hint.
  for (const keys of ["w h", "; b", "; l", "g Y", "g X", "; v", "j"]) assert.deepEqual(action(keys), refused, keys);
  // Half a sequence or more keys than the binding reach no leaf.
  for (const keys of [";", "f f"]) assert.deepEqual(action(keys), refused, keys);
  assert.equal(page_hint_action_of(keymap, "a b".repeat(9)).ok, false);
  assert.equal(page_hint_action_of(undefined, "f").ok, false);
});
