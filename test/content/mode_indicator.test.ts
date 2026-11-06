import assert from "node:assert/strict";
import { test } from "node:test";

// Just enough DOM for the badge: a root that holds the appended hosts, and a host that remembers its attribute.
type FakeNode = {
  style: { cssText: string; pointerEvents: string; setProperty: () => void; removeProperty: () => void };
  className: string;
  textContent: string;
  attributes: Map<string, string>;
  parent: FakeRoot | undefined;
  attachShadow: () => { append: () => void };
  setAttribute: (name: string, value: string) => void;
  remove: () => void;
};
type FakeRoot = {
  children: FakeNode[];
  append: (node: FakeNode) => void;
  querySelectorAll: (selector: string) => FakeNode[];
};

function fake_node(): FakeNode {
  const node: FakeNode = {
    style: { cssText: "", pointerEvents: "", setProperty: () => {}, removeProperty: () => {} },
    className: "",
    textContent: "",
    attributes: new Map(),
    parent: undefined,
    attachShadow: () => ({ append: () => {} }),
    setAttribute: (name: string, value: string) =>
      void node.attributes.set(name, value),
    remove: () =>
      void node.parent?.children.splice(node.parent.children.indexOf(node), 1),
  };
  return node;
}

function fake_root(): FakeRoot {
  const root: FakeRoot = {
    children: [],
    append: (node) => {
      node.remove();
      node.parent = root;
      root.children.push(node);
    },
    querySelectorAll: (selector: string) => {
      // The surface mount also looks up layered hosts to restack them, and the fake page has none.
      if (selector !== ":scope > [data-desertfox-badge]") return [];
      return root.children.filter((node) => node.attributes.has("data-desertfox-badge"));
    },
  };
  return root;
}

function page_with_orphan_badge() {
  const root = fake_root();
  const window_stub = {} as { top?: unknown };
  window_stub.top = window_stub;
  Object.assign(globalThis, { window: window_stub, document: { documentElement: root, createElement: fake_node } });
  const orphan = fake_node();
  orphan.setAttribute("data-desertfox-badge", "");
  orphan.setAttribute("data-desertfox-mode", "visual");
  root.append(orphan);
  return { root, orphan };
}

test("a badge left by an earlier instance is removed when a new instance shows its own", async () => {
  const { root, orphan } = page_with_orphan_badge();
  const { show_mode_label } = await import("../../src/content/mode_indicator.ts");
  show_mode_label("normal");
  show_mode_label("visual");

  assert.equal(root.children.length, 1);
  assert.notEqual(root.children[0], orphan);
});

test("a page element that carries the mode attribute survives the cleanup", async () => {
  const { root } = page_with_orphan_badge();
  const page_owned = fake_node();
  page_owned.setAttribute("data-desertfox-mode", "mine");
  root.append(page_owned);
  const { show_mode_label } = await import("../../src/content/mode_indicator.ts");
  show_mode_label("normal");

  assert.ok(root.children.includes(page_owned));
  assert.equal(root.children.length, 2);
});

test("a new instance with no label to show still removes the orphan, without loading the ui bundle", async () => {
  const { root } = page_with_orphan_badge();
  const { show_mode_label } = await import("../../src/content/ui_proxy.ts");
  show_mode_label(undefined);

  assert.equal(root.children.length, 0);
});
