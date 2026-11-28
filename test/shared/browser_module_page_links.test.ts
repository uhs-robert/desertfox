import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PAGE_LINK_ADDRESS_CHARS, MAX_PAGE_LINK_TEXT_CHARS, MAX_PAGE_LINKS, MAX_PAGE_LINKS_BYTES, parse_page_links } from "../../src/shared/browser_module_page_links.ts";
import { source_of } from "../browser_module/fake_firefox.ts";

const text_of = (pairs: unknown): string => JSON.stringify(pairs);

test("a good list gives its pairs in order, with the address normalized and the text cleaned", () => {
  assert.deepEqual(parse_page_links(text_of([["https://a.com", "A  \n page​"], ["http://b.com/x", ""]])), [
    { address: "https://a.com/", text: "A page" },
    { address: "http://b.com/x", text: "" },
  ]);
});

test("only http, https, ftp and file addresses stay", () => {
  const addresses = ["ftp://h/f", "file:///tmp/x", "about:preferences", "moz-extension://id/page.html", "javascript:alert(1)", "data:text/html,x", "mailto:a@b.c", "view-source:https://a.com", "blob:https://a.com/1", "/relative", "not an address"];
  const kept = parse_page_links(text_of(addresses.map((address) => [address, "t"]))) ?? [];
  assert.deepEqual(kept.map(({ address }) => address), ["ftp://h/f", "file:///tmp/x"]);
});

test("an address with a blank, control or format character is dropped, never repaired", () => {
  const bad = ["https://a.com/a b", "https://a.com/\n", "https://a.com/\u0000", "https://a.com/‮"];
  assert.deepEqual(parse_page_links(text_of(bad.map((address) => [address, "t"]))), []);
});

test("an address over 2048 characters is dropped and one of exactly 2048 stays", () => {
  const at_cap = `https://a.com/${"x".repeat(MAX_PAGE_LINK_ADDRESS_CHARS - "https://a.com/".length)}`;
  assert.equal(at_cap.length, MAX_PAGE_LINK_ADDRESS_CHARS);
  assert.deepEqual(parse_page_links(text_of([[at_cap, "t"], [`${at_cap}x`, "t"]]))?.map(({ address }) => address), [at_cap]);
});

test("text is cut at 512 characters by code point", () => {
  const [link] = parse_page_links(text_of([["https://a.com/", "\u{1F600}".repeat(MAX_PAGE_LINK_TEXT_CHARS + 5)]]))!;
  assert.equal([...link!.text].length, MAX_PAGE_LINK_TEXT_CHARS);
});

test("only the first 500 entries are read", () => {
  const many = Array.from({ length: MAX_PAGE_LINKS + 50 }, (_, index) => [`https://a.com/${index}`, "t"]);
  const links = parse_page_links(text_of(many))!;
  assert.equal(links.length, MAX_PAGE_LINKS);
  assert.equal(links.at(-1)!.address, `https://a.com/${MAX_PAGE_LINKS - 1}`);
});

test("a reply over 60 KB is refused whole", () => {
  const fits = text_of([["https://a.com/", "x".repeat(MAX_PAGE_LINKS_BYTES - 40)]]);
  assert.ok(new TextEncoder().encode(fits).length < MAX_PAGE_LINKS_BYTES);
  assert.ok(parse_page_links(fits));
  assert.equal(parse_page_links(text_of([["https://a.com/", "x".repeat(MAX_PAGE_LINKS_BYTES)]])), undefined);
  // The cap counts bytes, not characters.
  assert.equal(parse_page_links(text_of([["https://a.com/", "é".repeat(MAX_PAGE_LINKS_BYTES / 2)]])), undefined);
});

test("a malformed reply is refused whole or loses only the bad entry", () => {
  for (const value of [undefined, "", "not json", "{}", "null", "3", "\"https://a.com\"", "{\"0\":[\"https://a.com\",\"t\"]}"]) assert.equal(parse_page_links(value), undefined, String(value));
  const entries = [null, 3, "https://a.com/", ["https://a.com/"], ["https://a.com/", "t", "extra"], [3, "t"], ["https://a.com/", 3], { 0: "https://a.com/", 1: "t" }, ["https://ok.com/", "fine"]];
  assert.deepEqual(parse_page_links(text_of(entries)), [{ address: "https://ok.com/", text: "fine" }]);
  assert.deepEqual(parse_page_links("[]"), []);
});

test("the module's caps equal the extension's", () => {
  const source = source_of("desertfox-page-links.js");
  const number_of = (name: string) => Number(new RegExp(`const ${name} = ([\\d_]+);`).exec(source)?.[1]);
  assert.equal(number_of("MAX_LINKS"), MAX_PAGE_LINKS);
  assert.equal(number_of("MAX_VALUE_BYTES"), MAX_PAGE_LINKS_BYTES);
  assert.equal(number_of("MAX_ADDRESS_CHARS"), MAX_PAGE_LINK_ADDRESS_CHARS);
  assert.equal(number_of("MAX_TEXT_CHARS"), MAX_PAGE_LINK_TEXT_CHARS);
  const hints = source_of("desertfox-content-hints.js");
  for (const [name, expected] of [["MAX_LINKS", MAX_PAGE_LINKS], ["MAX_LINK_BYTES", MAX_PAGE_LINKS_BYTES], ["MAX_LINK_ADDRESS_CHARS", MAX_PAGE_LINK_ADDRESS_CHARS], ["MAX_LINK_TEXT_CHARS", MAX_PAGE_LINK_TEXT_CHARS]] as const) {
    assert.equal(Number(new RegExp(`const ${name} = (\\d+);`).exec(hints)?.[1]), expected, name);
  }
});
