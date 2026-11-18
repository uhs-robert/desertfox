import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { ancestors, descendants } from "../../src/content/next_page/detect.ts";
import type { PageReader } from "../../src/content/next_page/detect.ts";
import { find_items } from "../../src/content/item/finder.ts";
import type { FinderKind, Found } from "../../src/content/item/finder.ts";
import { FIXTURES, read_saved_page, saved_reader } from "../support/snapshot_page.ts";
import type { SavedNode, SavedPage } from "../support/snapshot_page.ts";

// `article` is the phase 3 kind: until then the finder answers `none` on an article, and the label keeps the kind it will have.
type Finder_label = { kind: FinderKind | "article"; min?: number; known_miss?: string };
type Result = { marks: number; covered: number; picked: number };

const labels = JSON.parse(readFileSync(new URL("labels.json", FIXTURES), "utf8")) as Record<string, { finder?: Finder_label }>;

function* walk(node: SavedNode): Generator<SavedNode> {
  yield node;
  for (const child of node.c ?? []) yield* walk(child);
}

// A mark counts as covered when a picked item is that node, sits inside it, or holds it and no other mark. An item that holds several marks (a table around the rows) finds none of them. One ancestor walk per picked item and one per mark keeps this linear in the page.
// Precision is the marks covered per picked item: a finder that picks every link covers every mark and scores a precision near zero, because most of its items cover nothing new.
function score(reader: PageReader<SavedNode>, marks: Set<SavedNode>, picked: readonly SavedNode[]): Result {
  const covered = new Set<SavedNode>();
  for (const item of picked) {
    const holder = [item, ...ancestors(reader, item)].find((node) => marks.has(node));
    const inside = descendants(reader, item).filter((node) => marks.has(node));
    if (holder) covered.add(holder);
    if (inside.length === 1) covered.add(inside[0]!);
  }
  return { marks: marks.size, covered: covered.size, picked: picked.length };
}

const saved = readdirSync(FIXTURES).filter((file) => file.endsWith(".json.gz")).map((file) => file.replace(/\.json\.gz$/, "")).sort();
// One parsed page per name, so the nodes the finder returns are the nodes the marks are.
const pages = new Map<string, SavedPage>();
const page_of = (name: string): SavedPage => pages.get(name) ?? pages.set(name, read_saved_page(name)).get(name)!;
const marks_of = (name: string): Set<SavedNode> => new Set([...walk(page_of(name).root)].filter((node) => node.m === 1));

// Every link of the page as an item: the finder the precision check must catch.
const every_link = (reader: PageReader<SavedNode>): SavedNode[] => descendants(reader, reader.root_).filter((node) => node.t === "a" && node.a?.href !== undefined && node.r !== undefined);

const PRECISION_MIN = 0.9;

test("the row pages carry marks and the labels state their minimum", () => {
  const row_pages = Object.entries(labels).filter(([, label]) => label.finder && label.finder.kind !== "none").map(([name]) => name);
  assert.ok(row_pages.length >= 10);
  for (const name of ["bing", "ddg", "hn", "lobsters", "tildes", "startpage", "arxiv", "stackoverflow_list", "wikipedia_search", "ddg_images", "ddg_news", "ddg_videos"]) assert.ok(marks_of(name).size > 0, `${name} has no marks`);
  for (const name of row_pages) {
    const marks = marks_of(name).size;
    if (marks > 0) assert.ok(marks >= labels[name]!.finder!.min!, `${name}: ${marks} marks, label says at least ${labels[name]!.finder!.min}`);
  }
});

// The finder reads each saved page once.
const found_on = new Map<string, Found<SavedNode>>();
const finder_on = (name: string): Found<SavedNode> => found_on.get(name) ?? found_on.set(name, find_items(saved_reader(page_of(name)))).get(name)!;

for (const [name, label] of Object.entries(labels).filter(([, entry]) => entry.finder)) {
  const finder = label.finder!;
  test(`${name}: the finder answers ${finder.kind === "article" ? "none (article, phase 3)" : finder.kind}${finder.known_miss ? " (known miss)" : ""}`, () => {
    const found = finder_on(name);
    const marks = marks_of(name);
    const failures: string[] = [];
    const expected = finder.kind === "article" ? "none" : finder.kind;
    if (found.kind !== expected) failures.push(`kind ${found.kind}, label ${expected}`);
    if (finder.min !== undefined && finder.kind !== "article" && found.items.length < finder.min) failures.push(`${found.items.length} items, label says at least ${finder.min}`);
    if (marks.size > 0) {
      const result = score(saved_reader(page_of(name)), marks, found.items);
      if (result.covered !== result.marks) failures.push(`covered ${result.covered} of ${result.marks} marks`);
      if (result.covered / Math.max(result.picked, 1) < PRECISION_MIN) failures.push(`precision ${result.covered}/${result.picked}`);
    }
    // A known miss is the only exemption, and it must still miss: a fixed page asks for its note to go.
    if (finder.known_miss !== undefined) return assert.ok(failures.length > 0, `${name} no longer misses, drop its known_miss`);
    assert.deepEqual(failures, []);
  });
}

test("a finder that picks every link covers the marks but fails the precision check", () => {
  const fooled = saved.filter((name) => {
    if (marks_of(name).size === 0) return false;
    const reader = saved_reader(page_of(name));
    const result = score(reader, marks_of(name), every_link(reader));
    return result.covered / result.picked >= PRECISION_MIN;
  });
  // A grid of picture tiles holds one link per tile, so picking every link is picking every tile there.
  assert.deepEqual(fooled, ["ddg_images"]);
});

test("the finder keeps the sections of a front page and walks the cards in them", () => {
  const found = finder_on("apnews");
  assert.ok(found.sections && found.sections.length >= 3);
  assert.ok(found.items.length >= 30);
  assert.ok(found.items.every((item) => found.links.get(item) !== undefined));
});

test("the finder keeps the story row of Hacker News as the item and its title link as the link", () => {
  const found = finder_on("hn");
  assert.equal(found.items.length, 30);
  assert.ok(found.items.every((item) => item.a?.class?.split(" ").includes("athing")));
  assert.ok(found.items.every((item) => found.links.get(item)?.t === "a"));
});

test("the finder stops at its time budget and answers none", () => {
  let ticks = 0;
  const found = find_items(saved_reader(page_of("ddg")), { now_: () => ticks++ * 10, budget_ms_: 40 });
  assert.equal(found.kind, "none");
  assert.deepEqual(found.items, []);
});
