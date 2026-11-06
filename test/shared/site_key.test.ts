import assert from "node:assert/strict";
import { test } from "node:test";
import { site_key } from "../../src/shared/site_key.ts";

const UUID = "0e5a4c1e-8d3b-4b8a-9c57-2f6f4d1a7b10";

const CASES: [string, string, string][] = [
  ["https://docs.github.com/x", "docs.github.com", "host"],
  ["https://DOCS.GitHub.com./x", "docs.github.com", "host"],
  ["https://www.github.com", "github.com", "host"],
  ["https://www.www.github.com", "www.github.com", "host"],
  ["https://www.com", "www.com", "host"],
  ["https://www2.github.com", "www2.github.com", "host"],
  ["http://github.com:8080", "github.com", "host"],
  ["https://[::1]:3000", "[::1]", "ip"],
  ["http://192.168.1.4", "192.168.1.4", "ip"],
  ["http://localhost:5173", "localhost", "local"],
  ["http://app.localhost", "app.localhost", "local"],
  ["file:///a/b.html", "file:", "file"],
  ["about:preferences", "about:", "internal"],
  ["about:reader?url=https%3A%2F%2Fwww.example.org%2Fa", "example.org", "host"],
  ["about:reader", "about:", "internal"],
  ["view-source:https://docs.github.com/x", "docs.github.com", "host"],
  ["view-source:view-source:http://localhost:1", "localhost", "local"],
  [`moz-extension://${UUID}/p.html`, `moz-extension:${UUID}`, "extension"],
  ["blob:https://github.com/abc", "other:", "other"],
  ["data:text/plain,hi", "other:", "other"],
  ["javascript:void(0)", "other:", "other"],
  ["not a url", "other:", "other"],
  ["", "other:", "other"],
];

for (const [url, key, kind] of CASES) {
  test(`site_key of ${JSON.stringify(url)} is ${key}`, () => {
    const result = site_key(url);
    assert.equal(result.key, key);
    assert.equal(result.kind, kind);
  });
}

test("tabs of one site share a key and a subdomain is another site", () => {
  assert.equal(site_key("https://www.github.com/a").key, site_key("http://github.com:81/b").key);
  assert.notEqual(site_key("https://docs.github.com").key, site_key("https://github.com").key);
});

test("site_key unwraps deeply nested reader pages without exhausting the stack", () => {
  const nested = `${"about:reader?url=".repeat(12_000)}https://example.org/`;
  assert.equal(site_key(nested).key, "example.org");
});
