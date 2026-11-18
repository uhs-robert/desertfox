import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { ancestors, descendants, in_carousel, is_item_size, signature, stacked_items } from "../../src/content/next_page/detect.ts";
import type { PageReader } from "../../src/content/next_page/detect.ts";
import { FIXTURES, read_saved_page, saved_reader } from "../support/snapshot_page.ts";
import type { SavedNode } from "../support/snapshot_page.ts";

type Finder_label = { kind: "list" | "grid" | "article"; min: number };
type Coverage = { marks: number; covered: number; picked: number };

const BASELINE = new URL("coverage_baseline.json", FIXTURES);
const labels = JSON.parse(readFileSync(new URL("labels.json", FIXTURES), "utf8")) as Record<string, { finder?: Finder_label }>;

const CHROME_TAGS = new Set(["nav", "header", "footer", "aside", "dialog"]);
const CHROME_ROLES = new Set(["navigation", "banner", "contentinfo", "menu", "menubar", "tablist", "dialog"]);
const SHORT_LINK_TEXT = 30;

// The main-list pick of `find_load_more`, copied because that function keeps it inside. Phase 2 of the item finder moves the pick into the shared finder module that `load_more.ts` calls too, and deletes this copy. The baseline is the one to beat.
function main_list_items<N>(reader: PageReader<N>): N[] {
  const nodes = [reader.root_, ...descendants(reader, reader.root_)];
  const self_and_up = (node: N) => [node, ...ancestors(reader, node)];
  const in_chrome = (node: N) => self_and_up(node).some((at) => CHROME_TAGS.has(reader.tag_(at)) || CHROME_ROLES.has(reader.attr_(at, "role") ?? "") || reader.attr_(at, "aria-modal") === "true");
  const in_pinned = (node: N) => self_and_up(node).some(reader.pinned_);
  const is_actionable = (node: N) => {
    const tag = reader.tag_(node);
    if (tag === "a" || tag === "area") return reader.attr_(node, "href") !== null;
    if (tag === "input") return ["button", "submit"].includes(reader.attr_(node, "type") ?? "");
    return tag === "button" || tag === "summary" || ["button", "link"].includes(reader.attr_(node, "role") ?? "");
  };
  const is_short_link = (node: N) => is_actionable(node) && reader.text_(node).trim().length < SHORT_LINK_TEXT;
  const view = reader.view_();
  let best: { items: N[]; area: number } | undefined;
  for (const box of nodes) {
    const groups = new Map<string, N[]>();
    for (const child of reader.children_(box)) {
      if (!is_item_size(reader.box_(child))) continue;
      const kind = signature(reader, child);
      groups.set(kind, [...(groups.get(kind) ?? []), child]);
    }
    for (const items of groups.values()) {
      if (!stacked_items(reader, items)) continue;
      if (in_chrome(box) || in_carousel(reader, box) || reader.scrolls_sideways_(box) || in_pinned(box)) continue;
      if (items.every(is_short_link)) continue;
      const area = items.reduce((sum, item) => sum + Math.min(reader.box_(item)!.w, view.w) * Math.min(reader.box_(item)!.h, 3 * view.h), 0);
      if (!best || area > best.area) best = { items, area };
    }
  }
  return best?.items ?? [];
}

function* walk(node: SavedNode): Generator<SavedNode> {
  yield node;
  for (const child of node.c ?? []) yield* walk(child);
}

// A mark counts as covered when a picked item is that node, sits inside it, or holds it and no other mark. An item that holds several marks (a table around the rows) finds none of them. One ancestor walk per picked item and one per mark keeps this linear in the page.
function coverage(name: string): Coverage {
  const page = read_saved_page(name);
  const reader = saved_reader(page);
  const marks = new Set([...walk(page.root)].filter((node) => node.m === 1));
  if (marks.size === 0) return { marks: 0, covered: 0, picked: 0 };
  const picked = main_list_items(reader);
  const covered = new Set<SavedNode>();
  for (const item of picked) {
    const up = [item, ...ancestors(reader, item)];
    // The item sits inside a mark.
    const holder = up.find((node) => marks.has(node));
    if (holder) covered.add(holder);
    // The item holds exactly one mark.
    const inside = [...walk(item)].filter((node) => marks.has(node));
    if (inside.length === 1) covered.add(inside[0]!);
  }
  return { marks: marks.size, covered: covered.size, picked: picked.length };
}

const saved = readdirSync(FIXTURES).filter((file) => file.endsWith(".json.gz")).map((file) => file.replace(/\.json\.gz$/, "")).sort();
const mark_count = (name: string): number => [...walk(read_saved_page(name).root)].filter((node) => node.m === 1).length;

test("the row pages carry marks and the labels state their minimum", () => {
  const row_pages = Object.entries(labels).filter(([, label]) => label.finder).map(([name]) => name);
  assert.ok(row_pages.length >= 10);
  for (const name of row_pages) {
    const marks = mark_count(name);
    const label = labels[name]!.finder!;
    // An article or a grid with no row has no marks, so only the pages with marks are held to their count.
    if (marks > 0) assert.ok(marks >= label.min, `${name}: ${marks} marks, label says at least ${label.min}`);
  }
  for (const name of ["bing", "ddg", "hn", "lobsters", "tildes", "startpage", "arxiv", "stackoverflow_list", "wikipedia_search", "ddg_images", "ddg_news", "ddg_videos"]) assert.ok(mark_count(name) > 0, `${name} has no marks`);
});

test("coverage baseline of the main-list pick over the marked pages", (t) => {
  const now: Record<string, Coverage> = {};
  for (const name of saved) {
    const result = coverage(name);
    if (result.marks > 0) now[name] = result;
  }
  const before = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, Coverage>;
  for (const [name, result] of Object.entries(now)) {
    const was = before[name];
    const drift = was === undefined ? " (new)" : was.covered !== result.covered || was.marks !== result.marks ? ` (was ${was.covered}/${was.marks})` : "";
    t.diagnostic(`${name}: ${result.covered}/${result.marks} marks covered by ${result.picked} picked items${drift}`);
  }
  if (process.env.UPDATE_COVERAGE_BASELINE === "1") writeFileSync(BASELINE, `${JSON.stringify(now, null, 1)}\n`);
});
