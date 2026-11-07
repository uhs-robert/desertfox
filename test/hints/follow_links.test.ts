import assert from "node:assert/strict";
import { test } from "node:test";
import { find_rel_link, pick_by_text } from "../../src/content/hints/follow_links.ts";

const link = (text: string, is_link = true) => ({ texts: [text], is_link });
const NEXT = ["next", "more", "newer", ">", "›", ">>"];

test("an earlier pattern beats a later one whatever the page order", () => {
  assert.equal(pick_by_text([link("More"), link("Next")], NEXT), 1);
});

test("a link beats a button, then the shorter text wins", () => {
  assert.equal(pick_by_text([link("next", false), link("next")], NEXT), 1);
  assert.equal(pick_by_text([link("next page"), link("next")], NEXT), 1);
});

test("the first of two equal items wins", () => {
  assert.equal(pick_by_text([link("next"), link("next")], NEXT), 0);
});

test("a one or two character pattern needs the whole text", () => {
  assert.equal(pick_by_text([link("a > b"), link("Back to top >>")], NEXT), -1);
  assert.equal(pick_by_text([link(" > ")], NEXT), 0);
  assert.equal(pick_by_text([link("›")], NEXT), 0);
});

test("a word matches inside a short text, ignoring case, and not inside a sentence", () => {
  assert.equal(pick_by_text([link("NEXT page")], NEXT), 0);
  assert.equal(pick_by_text([link("Read more about the next release")], NEXT), -1);
});

test("any of the texts of an item can match, and blank patterns are ignored", () => {
  assert.equal(pick_by_text([{ texts: ["", "Go on", "next"], is_link: true }], ["", "next"]), 0);
  assert.equal(pick_by_text([link("anything")], [""]), -1);
});

test("no match gives -1", () => {
  assert.equal(pick_by_text([link("home"), link("about")], NEXT), -1);
  assert.equal(pick_by_text([], NEXT), -1);
});

test("the rel search takes the first match in document order and ignores the other direction", () => {
  const element = (name: string, selector_part: string) => ({ name, localName: "a", matches: (selector: string) => selector.includes(selector_part) });
  const root = { querySelectorAll: () => [element("prev_link", 'rel~="prev"'), element("first_next", 'rel~="next"'), element("second_next", 'rel~="next"')] };
  const found = find_rel_link(root as unknown as ParentNode, "next");
  assert.equal((found!.element as unknown as { name: string }).name, "first_next");
  assert.equal(find_rel_link({ querySelectorAll: () => [] } as unknown as ParentNode, "next"), undefined);
});
