import assert from "node:assert/strict";
import { test } from "node:test";
import { format_page_link } from "../../src/content/handlers/copy.ts";
import type { PageLinkFacts } from "../../src/content/handlers/copy.ts";

const facts: PageLinkFacts = {
  url: "https://a.com/p?x=(1)",
  title: "A [draft] page",
  canonical_url_: "https://a.com/p",
  short_url_: "https://a.co/1",
};

test("each format builds its string", () => {
  assert.equal(format_page_link("plain", facts), "https://a.com/p?x=(1)");
  assert.equal(format_page_link("canonical", facts), "https://a.com/p");
  assert.equal(format_page_link("short", facts), "https://a.co/1");
  assert.equal(format_page_link("title", facts), "A [draft] page");
  assert.equal(format_page_link("markdown", facts), "[A (draft) page](https://a.com/p?x=(1%29)");
  assert.equal(format_page_link("org", facts), "[[https://a.com/p?x=(1)][A (draft) page]]");
});

test("a missing link falls back to the plain URL", () => {
  const bare = { ...facts, canonical_url_: undefined, short_url_: undefined };
  assert.equal(format_page_link("canonical", bare), facts.url);
  assert.equal(format_page_link("short", bare), facts.url);
});

test("org format percent-encodes a closing bracket in the URL", () => {
  assert.equal(format_page_link("org", { ...facts, url: "https://a.com/p?x=[1]" }), "[[https://a.com/p?x=[1%5D][A (draft) page]]");
});

test("copy.url answers done after the write and failed, without its own toast, when the clipboard refuses", async () => {
  const globals = globalThis as Record<string, unknown>;
  const toasts: string[] = [];
  Object.assign(globals, {
    location: { href: "https://a.com/" },
    document: { title: "A", querySelector: () => null },
  });
  const { copy_page_url } = await import("../../src/content/handlers/copy.ts");
  Object.defineProperty(globalThis, "browser", { value: { runtime: { sendMessage: async () => ({ ok: true }) }, storage: { local: { get: async () => ({}) } } }, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} } }, configurable: true });
  assert.deepEqual(await copy_page_url("plain", undefined, (message) => void toasts.push(message)), undefined);
  assert.deepEqual(toasts, ["Copied https://a.com/"]);
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: () => Promise.reject(new Error("denied")) } }, configurable: true });
  assert.deepEqual(await copy_page_url("plain", undefined, (message) => void toasts.push(message)), { ok: false, message: "Could not copy to the clipboard" });
  assert.deepEqual(toasts, ["Copied https://a.com/"]);
});

test("copy.url into the black hole shows no toast", async () => {
  const toasts: string[] = [];
  const { copy_page_url } = await import("../../src/content/handlers/copy.ts");
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} } }, configurable: true });
  assert.deepEqual(await copy_page_url("plain", "_", (message) => void toasts.push(message)), undefined);
  assert.deepEqual(toasts, []);
});

test("copy.url drops the tracking parameters of the shipped list, and an empty list keeps them", async () => {
  const globals = globalThis as Record<string, unknown>;
  const written: string[] = [];
  Object.assign(globals, {
    location: { href: "https://a.com/p?utm_source=x&id=5#frag" },
    document: { title: "A", querySelector: () => null },
  });
  const { copy_page_url } = await import("../../src/content/handlers/copy.ts");
  const { CONFIG_STATUS_STORAGE_KEY } = await import("../../src/background/storage_keys.ts");
  const { strip_patterns_for } = await import("../../src/background/strip_patterns.ts");
  // The background answers the ask: the page address goes in, the names to drop come out.
  const stored = (settings: object) => ({ runtime: { sendMessage: async (message: { type: string; address: string }) => (message.type === "read_strip_patterns" ? strip_patterns_for({ get: async () => ({ [CONFIG_STATUS_STORAGE_KEY]: { settings } }) } as never, message.address) : { ok: true }) } });
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (text: string) => void written.push(text) } }, configurable: true });
  Object.defineProperty(globalThis, "browser", { value: stored({}), configurable: true });
  await copy_page_url("plain", undefined, () => {});
  Object.defineProperty(globalThis, "browser", { value: stored({ strip_tracking_params: [] }), configurable: true });
  await copy_page_url("plain", undefined, () => {});
  // A site that turned the stripping off in its row gets the page's own answer: the background is asked with the page address.
  Object.defineProperty(globalThis, "browser", { value: { runtime: { sendMessage: async (message: { address: string }) => (message.address.startsWith("https://a.com/") ? [] : ["utm_*"]) } }, configurable: true });
  await copy_page_url("plain", undefined, () => {});
  assert.deepEqual(written, ["https://a.com/p?id=5#frag", "https://a.com/p?utm_source=x&id=5#frag", "https://a.com/p?utm_source=x&id=5#frag"]);
});
