import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve_mode_parents, shown_steps } from "../src/shared/keys/mode_parents.ts";
import type { CompiledKeymap, CompiledModeParent, LeafStep, TreeBranch, TreeLeaf } from "../src/shared/prefix_tree.ts";

const step = (id: string, args?: Record<string, unknown>): LeafStep => ({ invocation: { id, ...(args && { args }) }, runs_in: "content", count_rule: "ignore" });
const leaf = (id: string, label = id, extra: Partial<TreeLeaf> = {}): TreeLeaf => ({ kind: "leaf", label, steps: [step(id)], ...extra });
const branch = (children: TreeBranch["children"], label?: string): TreeBranch => ({ kind: "branch", ...(label && { label }), children });
const LEAVE: LeafStep = { ...step("mode.set", { mode: "item" }), leave: true };

const parent_tree = branch({
  f: leaf("hint.run"),
  J: leaf("tab.next"),
  x: leaf("normal.only"),
  g: branch({ t: leaf("tab.next", "gt"), g: leaf("page.item", "gg item") }, "Go"),
  ";": branch({ y: leaf("hint.run", ";y"), o: leaf("hint.run", ";o") }, "Hints"),
  z: branch({ a: leaf("page.tree", "za", { when_present: ".tree", otherwise: leaf("page.item", "fallback") }) }),
});
const own_tree = branch({ g: branch({ g: leaf("page.item", "gg extend") }), v: leaf("mode.set", "end") });
const visual_link = (extra: Partial<CompiledModeParent> = {}): CompiledKeymap["mode_parents"] => ({
  item_visual: { parent: "item", leave: LEAVE, runs: ["hint.run", "tab.next", "page.item", "page.tree"], ...extra },
});

const resolved_visual = (link: CompiledKeymap["mode_parents"], own: TreeBranch | undefined = own_tree) => resolve_mode_parents({ item: parent_tree, ...(own && { item_visual: own }) }, link).item_visual!;

test("a child takes each parent key it does not bind, with the leave step first", () => {
  const visual = resolved_visual(visual_link());
  const f = visual.children["f"] as TreeLeaf;
  assert.deepEqual(f.steps, [LEAVE, step("hint.run")]);
  assert.equal(f.label, "hint.run");
  assert.deepEqual(shown_steps(f), [step("hint.run")]);
  assert.equal(visual.children["v"], own_tree.children["v"]);
});

test("the child's own keys win at a leaf and merge in a shared group", () => {
  const g = resolved_visual(visual_link()).children["g"] as TreeBranch;
  assert.equal((g.children["g"] as TreeLeaf).label, "gg extend");
  assert.deepEqual((g.children["t"] as TreeLeaf).steps, [LEAVE, step("tab.next")]);
  assert.equal(g.label, "Go", "the parent's group name stays");
  // An own leaf hides a parent group, and an own group hides a parent leaf.
  const over = resolved_visual(visual_link(), branch({ ";": leaf("own.semicolon"), J: branch({ J: leaf("own.JJ") }) }));
  assert.equal((over.children[";"] as TreeLeaf).label, "own.semicolon");
  assert.equal(over.children["J"]!.kind, "branch");
  assert.deepEqual(Object.keys((over.children["J"] as TreeBranch).children), ["J"]);
});

test("a key reaches the child only when every command of it runs in the mode it runs in", () => {
  const visual = resolved_visual(visual_link());
  assert.equal(visual.children["x"], undefined);
  const narrow = resolved_visual(visual_link({ runs: ["hint.run"] }));
  assert.deepEqual(Object.keys(narrow.children).sort(), [";", "f", "g", "v"]);
  assert.deepEqual(Object.keys((narrow.children["g"] as TreeBranch).children), ["g"], "the own gg stays, the parent gt goes");
  // Every choice of a guard chain counts.
  const without_fallback = resolved_visual(visual_link({ runs: ["hint.run", "tab.next", "page.tree"] }));
  assert.equal(without_fallback.children["z"], undefined, "a group left with no key goes");
});

test("every choice of a guard chain leaves first", () => {
  const za = (resolved_visual(visual_link()).children["z"] as TreeBranch).children["a"] as TreeLeaf;
  assert.equal(za.when_present, ".tree");
  assert.deepEqual(za.steps, [LEAVE, step("page.tree")]);
  assert.deepEqual(za.otherwise?.steps, [LEAVE, step("page.item")]);
});

test("a blocked key stays out, and a blocked prefix drops its whole group", () => {
  const visual = resolved_visual(visual_link({ blocked: [["f"], [";"], ["g", "t"]] }));
  assert.equal(visual.children["f"], undefined);
  assert.equal(visual.children[";"], undefined);
  assert.deepEqual(Object.keys((visual.children["g"] as TreeBranch).children), ["g"]);
  // A block under a parent leaf, or of a key the parent lacks, changes nothing.
  assert.deepEqual(resolved_visual(visual_link({ blocked: [["J", "J"], ["q"]] })), resolved_visual(visual_link()));
});

test("a child with no own keys gets the parent's, and a mode with no link keeps its tree", () => {
  const visual = resolved_visual(visual_link(), undefined);
  assert.deepEqual((visual.children["J"] as TreeLeaf).steps, [LEAVE, step("tab.next")]);
  const modes = { item: parent_tree, normal: own_tree };
  assert.equal(resolve_mode_parents(modes, undefined), modes);
  assert.equal(resolve_mode_parents(modes, visual_link()).normal, own_tree);
});

test("a chain resolves parent first, and a link without leave keeps the parent's steps", () => {
  const normal = branch({ K: leaf("tab.prev"), f: leaf("hint.run", "normal f") });
  const item = branch({ f: leaf("hint.run", "item f") });
  const links: CompiledKeymap["mode_parents"] = { item_visual: { parent: "item", leave: LEAVE, runs: ["hint.run", "tab.prev"] }, item: { parent: "normal", runs: ["hint.run", "tab.prev"] } };
  const resolved = resolve_mode_parents({ normal, item }, links);
  assert.deepEqual((resolved.item!.children["K"] as TreeLeaf).steps, [step("tab.prev")]);
  assert.equal((resolved.item!.children["f"] as TreeLeaf).label, "item f");
  assert.deepEqual((resolved.item_visual!.children["K"] as TreeLeaf).steps, [LEAVE, step("tab.prev")]);
  // A loop stops at the mode it started from.
  const loop: CompiledKeymap["mode_parents"] = { item: { parent: "normal", runs: ["tab.prev", "hint.run"] }, normal: { parent: "item", runs: ["tab.prev", "hint.run"] } };
  const looped = resolve_mode_parents({ normal, item }, loop);
  assert.ok(looped.item && looped.normal);
});

test("the stored trees stay as they were", () => {
  const before = JSON.stringify(parent_tree);
  resolved_visual(visual_link({ blocked: [["g", "t"]] }));
  assert.equal(JSON.stringify(parent_tree), before);
});
