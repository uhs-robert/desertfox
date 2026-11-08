import assert from "node:assert/strict";
import { test } from "node:test";
import type { Found } from "../../src/content/hints/candidates.ts";
import { format_links, label_of, links_of, MAX_YANKED_LINKS, web_address } from "../../src/content/hints/yank_links.ts";

const PAGE = "https://a.com/post";

type FakeLink = { href?: string; text?: string; aria?: string; title?: string; alt?: string };
const link = (fake: FakeLink): Found => {
  const attributes: Record<string, string | undefined> = { href: fake.href, "aria-label": fake.aria, title: fake.title };
  const element = {
    baseURI: PAGE,
    innerText: fake.text ?? "",
    textContent: fake.text ?? "",
    getAttribute: (name: string) => attributes[name] ?? null,
    querySelector: () => (fake.alt === undefined ? null : { getAttribute: () => fake.alt }),
  };
  return { element: element as unknown as Element, frames: [] };
};

test("only web addresses count", () => {
  assert.equal(web_address("/x", PAGE, PAGE), "https://a.com/x");
  assert.equal(web_address("ftp://h/f", PAGE, PAGE), "ftp://h/f");
  assert.equal(web_address("file:///tmp/a", PAGE, PAGE), "file:///tmp/a");
  for (const raw of ["mailto:a@b.c", "tel:123", "javascript:void(0)", "data:text/plain,hi"]) assert.equal(web_address(raw, PAGE, PAGE), undefined);
});

test("a fragment of the same page is dropped, a fragment of another page is kept", () => {
  assert.equal(web_address("#top", PAGE, PAGE), undefined);
  assert.equal(web_address("/post#top", PAGE, PAGE), undefined);
  assert.equal(web_address("/other#top", PAGE, PAGE), "https://a.com/other#top");
});

test("the label falls back from text to aria-label, title, image alt and the address", () => {
  const url = "https://a.com/x";
  assert.equal(label_of(link({ text: " Hello \n world ", aria: "A" }).element, url), "Hello world");
  assert.equal(label_of(link({ aria: "Aria", title: "T" }).element, url), "Aria");
  assert.equal(label_of(link({ title: "Title", alt: "Alt" }).element, url), "Title");
  assert.equal(label_of(link({ alt: "Alt" }).element, url), "Alt");
  assert.equal(label_of(link({}).element, url), url);
});

test("the first link to an address wins, in document order", () => {
  const links = links_of([link({ href: "/a", text: "One" }), link({ href: "mailto:x@y.z", text: "Mail" }), link({ href: "/b", text: "Two" }), link({ href: "/a", text: "Again" })], PAGE);
  assert.deepEqual(links, [{ url: "https://a.com/a", text: "One" }, { url: "https://a.com/b", text: "Two" }]);
});

test("the list stops at the cap", () => {
  const many = Array.from({ length: MAX_YANKED_LINKS + 20 }, (_, index) => link({ href: `/p${index}`, text: "x" }));
  assert.equal(links_of(many, PAGE).length, MAX_YANKED_LINKS);
});

test("an empty list formats to nothing", () => {
  assert.equal(links_of([], PAGE).length, 0);
  assert.equal(format_links([], "markdown"), "");
});

test("each format builds one line per link and escapes brackets", () => {
  const links = [{ url: "https://a.com/p?x=(1)", text: "A [draft]" }, { url: "https://a.com/q?x=[1]", text: "Two" }];
  assert.equal(format_links(links, "plain"), "https://a.com/p?x=(1)\nhttps://a.com/q?x=[1]");
  assert.equal(format_links(links, "markdown"), "- [A (draft)](https://a.com/p?x=(1%29)\n- [Two](https://a.com/q?x=[1])");
  assert.equal(format_links(links, "org"), "- [[https://a.com/p?x=(1)][A (draft)]]\n- [[https://a.com/q?x=[1%5D][Two]]");
});
