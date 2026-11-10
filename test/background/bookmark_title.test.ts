import assert from "node:assert/strict";
import { test } from "node:test";
import { title_for_address } from "../../src/background/bookmark_title.ts";

const URL_A = "https://a.test/";

test("a page with no bookmark has no title", () => {
  assert.equal(title_for_address([], URL_A), undefined);
  assert.equal(title_for_address([{ url: "https://A.test/", type: "bookmark", title: "Near miss" }, { type: "folder", title: "Folder" }], URL_A), undefined);
});

test("several bookmarks at one address give the first unmodifiable-free title", () => {
  const nodes = [
    { url: URL_A, type: "bookmark", title: "Managed", unmodifiable: "managed" },
    { url: URL_A, type: "bookmark", title: "First" },
    { url: URL_A, type: "bookmark", title: "Second" },
  ];
  assert.equal(title_for_address(nodes, URL_A), "First");
});

test("a managed-only address still gives its title", () => {
  assert.equal(title_for_address([{ url: URL_A, type: "bookmark", title: "Managed", unmodifiable: "managed" }], URL_A), "Managed");
});
