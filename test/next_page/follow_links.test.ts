import assert from "node:assert/strict";
import { test } from "node:test";
import { can_open_elsewhere, find_rel_link, texts_of } from "../../src/content/next_page/follow_links.ts";

test("the rel search takes the first match in document order and ignores the other direction", () => {
  const element = (name: string, selector_part: string) => ({ name, localName: "a", matches: (selector: string) => selector.includes(selector_part) });
  const root = { querySelectorAll: () => [element("prev_link", 'rel~="prev"'), element("first_next", 'rel~="next"'), element("second_next", 'rel~="next"')] };
  const found = find_rel_link(root as unknown as ParentNode, "next");
  assert.equal((found!.element as unknown as { name: string }).name, "first_next");
  assert.equal(find_rel_link({ querySelectorAll: () => [] } as unknown as ParentNode, "next"), undefined);
});

test("only an input offers its value as text, so a button's form value is no label", () => {
  const element = (localName: string) => ({ localName, innerText: "Go", getAttribute: () => null, querySelector: () => null, value: "next" }) as unknown as Element;
  assert.deepEqual(texts_of(element("button")), ["Go"]);
  assert.deepEqual(texts_of(element("input")), ["Go", "next"]);
});

test("a script or inline data link cannot open in another tab, so it never reaches the background as a search", () => {
  const element = (fields: object) => fields as unknown as HTMLElement;
  assert.equal(can_open_elsewhere(element({ href: "javascript:go()" })), false);
  assert.equal(can_open_elsewhere(element({ href: "data:text/html,next" })), false);
  assert.equal(can_open_elsewhere(element({ href: "https://a.test/page/2" })), true);
  assert.equal(can_open_elsewhere(element({ localName: "button" })), true);
});
