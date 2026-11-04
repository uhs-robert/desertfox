import assert from "node:assert/strict";
import { test } from "node:test";
import { link_address, perform, takes_typing } from "../../src/content/hints/actions.ts";
import type { HintAction } from "../../src/content/hints/actions.ts";

function fixture(local: string, extra: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const element = { localName: local, click: () => calls.push("click"), focus: () => calls.push("focus"), remove: () => calls.push("remove"), ...extra };
  const opened: [string, string][] = [];
  const copied: string[] = [];
  const started: string[] = [];
  const deps = { open_link: (url: string, place: string) => opened.push([url, place]), copy: (text: string) => copied.push(text), start_caret: (_target: unknown, mode: string) => started.push(mode) };
  const run = (action: HintAction) => perform(action, element as never, deps as never);
  return { calls, opened, copied, started, run };
}

test("here clicks a link", () => {
  const page = fixture("a", { href: "https://example.com/" });
  page.run("here");
  assert.deepEqual(page.calls, ["click"]);
  assert.deepEqual(page.opened, []);
});

test("tab, background and window open the address in that place", () => {
  for (const place of ["tab", "background", "window"] as const) {
    const page = fixture("a", { href: "https://example.com/x" });
    page.run(place);
    assert.deepEqual(page.opened, [["https://example.com/x", place]]);
    assert.deepEqual(page.calls, []);
  }
});

test("an element with no usable address is clicked instead of opened", () => {
  const page = fixture("button");
  page.run("tab");
  assert.deepEqual(page.calls, ["click"]);
  const script = fixture("a", { href: "javascript:void(0)" });
  script.run("background");
  assert.deepEqual(script.opened, []);
});

test("here focuses a text field and clicks a checkbox", () => {
  const text = fixture("input", { type: "text" });
  text.run("here");
  assert.deepEqual(text.calls, ["focus"]);
  const box = fixture("input", { type: "checkbox" });
  box.run("here");
  assert.deepEqual(box.calls, ["click"]);
});

test("focus focuses and delete removes", () => {
  const page = fixture("div");
  page.run("focus");
  page.run("delete");
  assert.deepEqual(page.calls, ["focus", "remove"]);
});

test("takes_typing knows fields from buttons", () => {
  assert.equal(takes_typing({ localName: "textarea" } as never), true);
  assert.equal(takes_typing({ localName: "select" } as never), true);
  assert.equal(takes_typing({ localName: "div", isContentEditable: true } as never), true);
  assert.equal(takes_typing({ localName: "input", type: "submit" } as never), false);
  assert.equal(takes_typing({ localName: "a" } as never), false);
});

test("link_address refuses script addresses", () => {
  assert.equal(link_address({ href: "JavaScript:alert(1)" } as never), undefined);
  assert.equal(link_address({ href: "" } as never), undefined);
  assert.equal(link_address({ href: "https://a.test/" } as never), "https://a.test/");
});

test("copy writes the link address and copy_text writes the text", () => {
  const link = fixture("a", { href: "https://a.test/x", textContent: "  A link " });
  link.run("copy");
  link.run("copy_text");
  assert.deepEqual(link.copied, ["https://a.test/x", "A link"]);
  assert.deepEqual(link.calls, []);
});

test("copy falls back to the text for an element with no address", () => {
  const heading = fixture("h1", { textContent: "Title" });
  heading.run("copy");
  assert.deepEqual(heading.copied, ["Title"]);
});

test("caret and visual hand the element to the caret start and do nothing else", () => {
  for (const mode of ["caret", "visual"] as const) {
    const page = fixture("p");
    page.run(mode);
    assert.deepEqual(page.started, [mode]);
    assert.deepEqual(page.calls, []);
  }
  for (const action of ["here", "tab", "copy", "copy_text", "delete", "focus"] as const) {
    const page = fixture("a", { href: "https://example.com/" });
    page.run(action);
    assert.deepEqual(page.started, []);
  }
});
