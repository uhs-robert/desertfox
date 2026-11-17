import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { detect_next_page, rank_by_text } from "../../src/content/next_page/detect.ts";
import { find_load_more } from "../../src/content/next_page/load_more.ts";
import { DEFAULT_NEXT_PATTERNS } from "../../src/shared/default_settings.ts";
import { FIXTURES, read_saved_page, saved_input, saved_reader } from "../support/snapshot_page.ts";
import type { SavedNode } from "../support/snapshot_page.ts";

type Answer = { action: "follow" | "click" | "scroll" | "none"; text?: string; label?: string; href?: string };
type Label = { url: string; ok: Answer[]; why: string; soft?: true; covers?: string; known_miss?: string; no_next_word?: true };

const labels = JSON.parse(readFileSync(new URL("labels.json", FIXTURES), "utf8")) as Record<string, Label>;

const NEXT_WORDS = DEFAULT_NEXT_PATTERNS;

const fits = (answer: Answer, action: string, target: SavedNode | undefined): boolean =>
  answer.action === action &&
  (["text", "label", "href"] as const).every((field) => {
    const pattern = answer[field];
    const value = { text: target?.s, label: target?.a?.["aria-label"], href: target?.a?.href }[field] ?? "";
    return pattern === undefined || new RegExp(pattern, "i").test(value);
  });

test("every saved page has a label and every label a saved page", () => {
  const saved = readdirSync(FIXTURES).filter((file) => file.endsWith(".json.gz")).map((file) => file.replace(/\.json\.gz$/, ""));
  assert.deepEqual(saved.sort(), Object.keys(labels).sort());
});

test("the corpus covers each next-pass fix and the soft pages", () => {
  const covered = new Set(Object.values(labels).map((label) => label.covers));
  for (const fix of ["whole word", "media player", "list item", "word cap", "japanese", "pointer div", "ad carousel"]) assert.ok(covered.has(fix), fix);
  assert.equal(Object.values(labels).filter((label) => label.soft).length, 7);
});

for (const [name, label] of Object.entries(labels)) {
  test(`${name}: ${label.why}`, () => {
    const page = read_saved_page(name);
    const input = saved_input(page, NEXT_WORDS);
    // The structure skips would hide a bad word match on this page, so the words alone must match nothing.
    if (label.no_next_word) assert.deepEqual(rank_by_text(input.controls, NEXT_WORDS), []);
    const outcome = detect_next_page(saved_reader(page), input, find_load_more);
    const target = outcome.action === "none" ? undefined : outcome.target;
    if (label.ok.some((answer) => fits(answer, outcome.action, target))) return;
    const shown = target ? `${outcome.action} <${target.t}> "${target.s ?? ""}" ${JSON.stringify(target.a ?? {})}` : outcome.action;
    // A known miss may do nothing, or scroll a list that does reach the page end. It must never click or follow the wrong thing.
    assert.ok(label.known_miss !== undefined && (outcome.action === "none" || (outcome.action === "scroll" && !label.soft)), `got ${shown}`);
  });
}
