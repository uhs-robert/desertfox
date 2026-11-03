import assert from "node:assert/strict";
import { test } from "node:test";
import { collect, has_text, selector_for } from "../../src/content/hints/candidates.ts";

type Fake = { name: string; local: string; shadow?: Fake[]; frame?: Fake[] | "cross_origin"; href?: boolean };

// A page of fake elements. `matches` answers for the one selector the test passes in: "links" means a[href].
function root_of(elements: Fake[]): ParentNode {
  const wrap = (fake: Fake) => ({
    name: fake.name,
    localName: fake.local,
    openOrClosedShadowRoot: fake.shadow ? root_of(fake.shadow) : null,
    shadowRoot: null,
    get contentDocument() {
      if (fake.frame === "cross_origin") throw new Error("blocked");
      return fake.frame ? root_of(fake.frame) : null;
    },
    matches: (selector: string) => selector === "links" && fake.local === "a" && fake.href === true,
  });
  return { querySelectorAll: () => elements.map(wrap) } as unknown as ParentNode;
}

const names = (found: { element: Element }[]) => found.map((item) => (item.element as unknown as { name: string }).name);

test("a link in the top document, an open or closed shadow root and a same-origin frame is found", () => {
  const page = root_of([
    { name: "top", local: "a", href: true },
    { name: "plain div", local: "div" },
    { name: "host", local: "div", shadow: [{ name: "in shadow", local: "a", href: true }] },
    { name: "frame", local: "iframe", frame: [{ name: "in frame", local: "a", href: true }] },
  ]);
  assert.deepEqual(names(collect(page, "links")), ["top", "in shadow", "in frame"]);
});

test("an element in a frame knows which frames hold it", () => {
  const page = root_of([{ name: "outer", local: "iframe", frame: [{ name: "inner", local: "iframe", frame: [{ name: "deep", local: "a", href: true }] }] }]);
  const [found] = collect(page, "links");
  assert.equal(found!.frames.length, 2);
});

test("a cross-origin frame is skipped, not an error", () => {
  const page = root_of([{ name: "ad", local: "iframe", frame: "cross_origin" }, { name: "top", local: "a", href: true }]);
  assert.deepEqual(names(collect(page, "links")), ["top"]);
});

test("an empty custom selector finds nothing", () => {
  assert.deepEqual(collect(root_of([{ name: "top", local: "a", href: true }]), selector_for("custom", undefined)), []);
});

test("each filter has its own selector", () => {
  assert.equal(selector_for("links", undefined), "a[href]");
  assert.match(selector_for("inputs", undefined), /textarea/);
  assert.match(selector_for("clickable", undefined), /a\[href\]/);
  assert.match(selector_for("clickable", undefined), /textarea/);
  assert.match(selector_for("all", undefined), /h1/);
  assert.equal(selector_for("custom", ".post a"), ".post a");
});

test("has_text matches a lower-cased needle in the visible text, ignoring case", () => {
  assert.equal(has_text({ innerText: "Read More", textContent: "" } as never, "more"), true);
  assert.equal(has_text({ textContent: "Read More" } as never, "read"), true);
  assert.equal(has_text({ textContent: "Read" } as never, "more"), false);
});
