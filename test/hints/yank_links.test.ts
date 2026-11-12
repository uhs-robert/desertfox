import assert from "node:assert/strict";
import { test } from "node:test";
import type { YankDeps } from "../../src/content/hints/yank_links.ts";
import type { Found } from "../../src/content/hints/candidates.ts";
import { format_links, label_of, links_of, MAX_YANKED_LINKS, web_address, yank_links } from "../../src/content/hints/yank_links.ts";

const PAGE = "https://a.com/post";

type FakeLink = { document_url?: string; href?: string; text?: string; aria?: string; title?: string; alt?: string };
const link = (fake: FakeLink): Found => {
  const attributes: Record<string, string | undefined> = { href: fake.href, "aria-label": fake.aria, title: fake.title };
  const element = {
    baseURI: fake.document_url ?? PAGE,
    ownerDocument: { URL: fake.document_url ?? PAGE },
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
  assert.equal(web_address("#", PAGE, PAGE), undefined);
  assert.equal(web_address("/post#", PAGE, PAGE), undefined);
  assert.equal(web_address("/other#top", PAGE, PAGE), "https://a.com/other#top");
});

test("a fragment link in a frame is compared with the frame, not the top page", () => {
  const frame = "https://b.com/frame";
  const links = links_of([link({ document_url: frame, href: "#section", text: "In frame" }), link({ document_url: frame, href: "/post#top", text: "Top page" }), link({ document_url: frame, href: "/frame#x", text: "Self" })]);
  assert.deepEqual(links, [{ url: "https://b.com/post#top", text: "Top page" }]);
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
  const links = links_of([link({ href: "/a", text: "One" }), link({ href: "mailto:x@y.z", text: "Mail" }), link({ href: "/b", text: "Two" }), link({ href: "/a", text: "Again" })]);
  assert.deepEqual(links, [{ url: "https://a.com/a", text: "One" }, { url: "https://a.com/b", text: "Two" }]);
});

test("the list stops at the cap", () => {
  const many = Array.from({ length: MAX_YANKED_LINKS + 20 }, (_, index) => link({ href: `/p${index}`, text: "x" }));
  assert.equal(links_of(many).length, MAX_YANKED_LINKS);
});

test("an empty list formats to nothing", () => {
  assert.equal(links_of([]).length, 0);
  assert.equal(format_links([], "markdown"), "");
});

test("each format builds one line per link and escapes brackets", () => {
  const links = [{ url: "https://a.com/p?x=(1)", text: "A [draft]" }, { url: "https://a.com/q?x=[1]", text: "Two" }];
  assert.equal(format_links(links, "plain"), "https://a.com/p?x=(1)\nhttps://a.com/q?x=[1]");
  assert.equal(format_links(links, "markdown"), "- [A (draft)](https://a.com/p?x=(1%29)\n- [Two](https://a.com/q?x=[1])");
  assert.equal(format_links(links, "org"), "- [[https://a.com/p?x=(1)][A (draft)]]\n- [[https://a.com/q?x=[1%5D][Two]]");
});

function deps_with(overrides: Partial<YankDeps>, copied: string[] = [], messages: string[] = []): YankDeps {
  const everything = [link({ href: "/in-view", text: "Seen" }), link({ href: "/hidden", text: "Hidden" }), link({ href: "/below", text: "Below" })];
  return {
    find: () => everything,
    strip_patterns: async () => [],
    keep_present_: (found) => found.filter((item) => item.element.getAttribute("href") !== "/hidden"),
    keep_in_view_: async (found) => found.filter((item) => item.element.getAttribute("href") === "/in-view"),
    copy: async (text) => {
      copied.push(text);
      return { ok: true };
    },
    show_message_: (message) => void messages.push(message),
    ...overrides,
  };
}

test("the page scope copies the present links and skips hidden ones", async () => {
  const copied: string[] = [];
  const messages: string[] = [];
  const outcome = await yank_links("page", "plain", deps_with({}, copied, messages));
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(copied, ["https://a.com/in-view\nhttps://a.com/below"]);
  assert.deepEqual(messages, ["Copied 2 links"]);
});

test("the viewport scope copies only the links in view, and one link is singular", async () => {
  const copied: string[] = [];
  const messages: string[] = [];
  await yank_links("viewport", "markdown", deps_with({}, copied, messages));
  assert.deepEqual(copied, ["- [Seen](https://a.com/in-view)"]);
  assert.deepEqual(messages, ["Copied 1 link"]);
});

test("no links refuses and copies nothing", async () => {
  const copied: string[] = [];
  const outcome = await yank_links("page", "plain", deps_with({ find: () => [] }, copied));
  assert.deepEqual(outcome, { ok: false, message: "No links on this page" });
  assert.deepEqual(copied, []);
});

test("a refused clipboard fails with the copy message and shows no toast", async () => {
  const messages: string[] = [];
  const outcome = await yank_links("page", "plain", deps_with({ copy: async () => ({ ok: false, message: "Could not copy to the clipboard" }) }, [], messages));
  assert.deepEqual(outcome, { ok: false, message: "Could not copy to the clipboard" });
  assert.deepEqual(messages, []);
});

test("a copy that drops the text into the black hole shows no message", async () => {
  const messages: string[] = [];
  const outcome = await yank_links("page", "plain", deps_with({ copy: async () => ({ ok: true, dropped: true }) }, [], messages));
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(messages, []);
});

test("links that differ only by tracking parameters make one entry, without them", () => {
  const links = links_of([link({ href: "/a?utm_source=x&id=5", text: "One" }), link({ href: "/a?id=5&fbclid=z", text: "Again" })], ["utm_*", "fbclid"]);
  assert.deepEqual(links.map((item) => item.url), ["https://a.com/a?id=5"]);
});

test("the list setting reaches the copied text", async () => {
  const copied: string[] = [];
  await yank_links("page", "plain", deps_with({ find: () => [link({ href: "/p?utm_medium=m&k=1", text: "P" })], strip_patterns: async () => ["utm_*"] }, copied));
  // The setting off for the page's site gives an empty list: the address keeps its parameters.
  const kept: string[] = [];
  await yank_links("page", "plain", deps_with({ find: () => [link({ href: "/p?utm_medium=m&k=1", text: "P" })], strip_patterns: async () => [] }, kept));
  assert.ok(kept[0]!.includes("utm_medium=m"));
  assert.deepEqual(copied, ["https://a.com/p?k=1"]);
});
