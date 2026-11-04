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
      assert.equal(selector, "[data-oasisfox-mode]");
      return root.children.filter((node) =>
        node.attributes.has("data-oasisfox-mode"),
      );
    },
  };
  return root;
}

test("a badge left by an earlier instance is removed when a new instance shows its own", async () => {
  const root = fake_root();
  const window_stub = {} as { top?: unknown };
  window_stub.top = window_stub;
  Object.assign(globalThis, {
    window: window_stub,
    document: { documentElement: root, createElement: fake_node },
  });
  const orphan = fake_node();
  orphan.setAttribute("data-oasisfox-mode", "normal");
  root.append(orphan);

  const { show_mode_label } =
    await import("../../src/content/mode_indicator.ts");
  show_mode_label("normal");
  show_mode_label("visual");

  assert.equal(root.querySelectorAll("[data-oasisfox-mode]").length, 1);
  assert.notEqual(root.children[0], orphan);
});
