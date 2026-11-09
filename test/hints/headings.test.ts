import assert from "node:assert/strict";
import { test } from "node:test";
import { heading_level, is_heading, jump_in, keep_present, pick_heading, row_of, scroll_to_top } from "../../src/content/hints/headings.ts";

type FakeHeading = { localName: string; text?: string; rendered?: string; role?: string; level?: string };
const heading = (fake: FakeHeading) => ({ localName: fake.localName, textContent: fake.text ?? "Title", innerText: fake.rendered ?? fake.text ?? "Title", getAttribute: (name: string) => (name === "role" ? (fake.role ?? null) : name === "aria-level" ? (fake.level ?? null) : null) }) as unknown as Element;

test("a heading with its text in a child counts, an empty one or one stripped of its role does not", () => {
  assert.equal(is_heading(heading({ localName: "h2" })), true);
  assert.equal(is_heading(heading({ localName: "div", role: "heading" })), true);
  assert.equal(is_heading(heading({ localName: "h2", text: " \n " })), false);
  assert.equal(is_heading(heading({ localName: "h2", role: "presentation" })), false);
  assert.equal(is_heading(heading({ localName: "h3", role: "none" })), false);
  assert.equal(is_heading(heading({ localName: "h3", role: "button" })), false);
});

test("the level comes from aria-level, else the tag, else 2", () => {
  assert.equal(heading_level(heading({ localName: "h4" })), 4);
  assert.equal(heading_level(heading({ localName: "h4", level: "1" })), 1);
  assert.equal(heading_level(heading({ localName: "div", role: "heading", level: "3" })), 3);
  assert.equal(heading_level(heading({ localName: "div", role: "heading" })), 2);
  assert.equal(heading_level(heading({ localName: "div", role: "heading", level: "99" })), 2);
});

test("a heading counts by its rendered text, not by hidden or script text in its content", () => {
  assert.equal(is_heading(heading({ localName: "h2", text: "x = 1", rendered: "" })), false);
  assert.equal(is_heading(heading({ localName: "h2", text: "Title", rendered: "Title" })), true);
});

test("a row holds the level and the rendered text on one line, whole however long", () => {
  assert.deepEqual(row_of(heading({ localName: "h3", text: "  Install\n   the   tool " })), { level: 3, text: "Install the tool" });
  assert.equal(row_of(heading({ localName: "h1", text: `${"x".repeat(150)} tail` })).text, `${"x".repeat(150)} tail`);
});

test("keep_present drops hidden, boxless, clipped and tiny headings and keeps off-screen ones", () => {
  const box = (top: number, height = 20) => [{ left: 0, top, right: 100, bottom: top + height }];
  const probe = (rects: Record<string, ReturnType<typeof box>>, hidden: string[] = [], clips: Record<string, ReturnType<typeof box>> = {}) => ({
    rects_of_: (name: string) => rects[name] ?? [],
    clips_of_: (name: string) => clips[name] ?? [],
    is_hidden_: (name: string) => hidden.includes(name),
  });
  const names_in = ["above", "below", "none", "hidden", "clipped", "tiny"];
  const kept = keep_present(
    names_in,
    probe({ above: box(-500), below: box(5000), hidden: box(0), clipped: box(0), tiny: box(0, 1) }, ["hidden"], { clipped: [{ left: 0, top: 100, right: 100, bottom: 200 }] }),
  );
  assert.deepEqual(kept, ["above", "below"]);
});

const rows = [
  { level: 1, text: "Guide" },
  { level: 2, text: "Install" },
  { level: 2, text: "2024 plan" },
  { level: 3, text: "Install from source" },
];

test("a leading number picks the heading at that place, whatever text follows", () => {
  assert.equal(pick_heading(rows, "2 Install"), 1);
  assert.equal(pick_heading(rows, "4"), 3);
  assert.equal(pick_heading(rows, "1 old title the page has changed since"), 0);
});

test("a number with text after it, past the end of the list, is part of the text", () => {
  assert.equal(pick_heading(rows, "2024 plan"), 2);
});

test("a bare number past the list is text, so a heading titled with a number can be reached", () => {
  const numbered = [...rows, { level: 2, text: "2024" }];
  assert.equal(pick_heading(numbered, "2024"), 4);
  assert.throws(() => pick_heading(rows, "9"), /No heading matches 9/);
});

test("text matches the whole heading, also past what the list shows", () => {
  const long = [{ level: 2, text: `${"a".repeat(120)} needle` }, { level: 2, text: "Other" }];
  assert.equal(pick_heading(long, "needle"), 0);
});

test("text picks the best fuzzy match and an equal tie takes the first on the page", () => {
  assert.equal(pick_heading(rows, "guide"), 0);
  assert.equal(pick_heading(rows, "source"), 3);
  assert.equal(pick_heading(rows, "install"), 1);
  assert.throws(() => pick_heading(rows, "zzz"), /No heading matches zzz/);
  assert.equal(pick_heading([{ level: 2, text: "Same" }, { level: 2, text: "Same" }], "same"), 0);
});

test("scroll_to_top scrolls the heading first and then each frame, innermost first, with nothing else touched", () => {
  const scrolls: string[] = [];
  const options: unknown[] = [];
  const at = (name: string) => ({ scrollIntoView: (option: unknown) => (scrolls.push(name), options.push(option)) }) as unknown as Element;
  scroll_to_top(at("heading"), [at("outer"), at("inner")]);
  assert.deepEqual(scrolls, ["heading", "inner", "outer"]);
  assert.deepEqual(options[0], { block: "start", behavior: "instant" });
});

test("a heading that left the page, or whose frame did, gives That heading is gone and scrolls nothing", () => {
  const scrolls: string[] = [];
  const element = (connected: boolean) => ({ isConnected: connected, scrollIntoView: () => scrolls.push("scrolled") }) as unknown as Element;
  const snapshot = (heading_element: Element, frames: Element[] = []) => ({ found: [{ element: heading_element, frames }], rows: [{ level: 2, text: "Intro" }] });
  assert.throws(() => jump_in(snapshot(element(false)), "1 Intro"), /That heading is gone/);
  assert.throws(() => jump_in(snapshot(element(true), [element(false)]), "1 Intro"), /That heading is gone/);
  assert.deepEqual(scrolls, []);
  jump_in(snapshot(element(true), [element(true)]), "1 Intro");
  assert.deepEqual(scrolls, ["scrolled", "scrolled"]);
});
