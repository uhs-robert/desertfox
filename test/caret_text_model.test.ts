import assert from "node:assert/strict";
import { test } from "node:test";
import { build_text_model, documents_of, trees_alive } from "../src/content/caret/text_model.ts";

// A fake rendered tree: just the DOM members the walk reads.
type FakeNode = Record<string, unknown> & { nodeType: number; tree?: FakeTree };
type FakeTree = { nodeType: number; name: string; host?: FakeNode; ownerDocument?: FakeTree; defaultView: unknown };
type ElementOptions = { display?: string; shadow?: FakeNode[]; frame?: FakeNode | "cross_origin"; slot_gets?: FakeNode[] };

const window_view = { getComputedStyle: (element: FakeNode) => ({ display: element.display, visibility: "visible", whiteSpace: "normal" }) };

const text = (data: string): FakeNode => ({ nodeType: 3, data, getRootNode(this: FakeNode) { return this.tree; } });

function element(tag: string, children: FakeNode[] = [], options: ElementOptions = {}): FakeNode {
  const node: FakeNode = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    localName: tag,
    display: options.display ?? (["span", "a", "slot", "img", "iframe"].includes(tag) ? "inline" : "block"),
    childNodes: children,
    isContentEditable: false,
    shadowRoot: null,
    openOrClosedShadowRoot: null,
    assignedNodes: () => options.slot_gets ?? [],
    getRootNode(this: FakeNode) {
      return this.tree;
    },
    get contentDocument() {
      if (options.frame === "cross_origin") throw new Error("blocked");
      return options.frame ? { body: options.frame } : null;
    },
  };
  for (const child of children) child.parentNode = node;
  if (options.shadow) node.openOrClosedShadowRoot = { childNodes: options.shadow, host: node };
  return node;
}

// Gives each node its tree and owner document, going into shadow roots and frames.
function place(node: FakeNode, tree: FakeTree, owner: FakeTree): void {
  node.tree = tree;
  node.ownerDocument = owner;
  for (const child of (node.childNodes as FakeNode[] | undefined) ?? []) place(child, tree, owner);
  const shadow = node.openOrClosedShadowRoot as { childNodes: FakeNode[]; nodeType?: number; ownerDocument?: FakeTree; name?: string } | null;
  if (shadow) {
    Object.assign(shadow, { nodeType: 11, ownerDocument: owner, name: `shadow of ${String(node.localName)}` });
    for (const child of shadow.childNodes) place(child, shadow as unknown as FakeTree, owner);
  }
  try {
    const inner = (node as { contentDocument?: { body: FakeNode } | null }).contentDocument;
    if (inner) {
      const frame_tree: FakeTree = { nodeType: 9, name: "frame document", defaultView: window_view };
      place(inner.body, frame_tree, frame_tree);
    }
  } catch {
    // A cross-origin frame stays unread.
  }
}

function model_of(body: FakeNode, start_node?: FakeNode) {
  const top: FakeTree = { nodeType: 9, name: "top", defaultView: window_view };
  place(body, top, top);
  return build_text_model(body as unknown as Element, start_node as unknown as Node);
}

const tree_names = (model: ReturnType<typeof model_of>) => model.trees.map((tree) => (tree as unknown as FakeTree).name);

test("text in an open or closed shadow root sits where its host renders it", () => {
  const host = element("span", [], { shadow: [text("inside")] });
  const model = model_of(element("body", [element("p", [text("before "), host, text(" after")])]));
  assert.equal(model.text, "before inside after");
  assert.deepEqual(tree_names(model), ["top", "shadow of span"]);
});

test("a slot shows the host's children in its place, and its fallback when none are assigned", () => {
  const light = text("light");
  const filled = element("span", [light], { shadow: [text("a "), element("slot", [text("unused")], { slot_gets: [light] }), text(" b")] });
  const empty = element("span", [], { shadow: [element("slot", [text("fallback")])] });
  const model = model_of(element("body", [element("p", [filled]), element("p", [empty])]));
  assert.equal(model.text, "a light b\nfallback");
});

test("a shadow root inside a shadow root is read too", () => {
  const inner_host = element("span", [], { shadow: [text("deep")] });
  const model = model_of(element("body", [element("div", [], { shadow: [element("p", [text("outer "), inner_host])] })]));
  assert.equal(model.text, "outer deep");
  assert.equal(model.trees.length, 2);
});

test("a same-origin frame's text is a line of its own, and a cross-origin frame adds nothing", () => {
  const frame = element("iframe", [], { frame: element("body", [element("p", [text("framed")])]) });
  const blocked = element("iframe", [text("raw fallback")], { frame: "cross_origin" });
  const model = model_of(element("body", [element("p", [text("top "), frame, text(" tail"), blocked])]));
  assert.equal(model.text, "top\nframed\ntail");
  assert.deepEqual(tree_names(model), ["top", "frame document"]);
  assert.equal(documents_of(model).length, 2);
  // A removed frame's document loses its window.
  (model.trees[1] as unknown as FakeTree).defaultView = null;
  assert.equal(trees_alive(model), false);
});

test("tree_runs cuts a span where the text changes tree", () => {
  const host = element("span", [], { shadow: [text("in")] });
  const model = model_of(element("body", [element("p", [text("ab "), host, text(" cd")])]));
  assert.equal(model.text, "ab in cd");
  const runs = model.tree_runs(1, 7).map(({ from, to, tree }) => [from, to, (tree as unknown as FakeTree).name]);
  assert.deepEqual(runs, [
    [1, 3, "top"],
    [3, 5, "shadow of span"],
    [5, 7, "top"],
  ]);
});

test("point_at and index_of reach a text node in a shadow root", () => {
  const inside = text("xyz");
  const model = model_of(element("body", [element("p", [text("ab")]), element("div", [], { shadow: [element("p", [inside])] })]));
  assert.equal(model.point_at(4).node, inside as unknown as Node);
  assert.equal(model.point_at(4).offset, 1);
  assert.equal(model.index_of(inside as unknown as Node, 2), 5);
});

test("start_index is the start node's own first character, or the first after it", () => {
  const paragraph = element("p", [text("beta")]);
  const image = element("img");
  const field = element("input");
  const in_shadow = element("p", [text("gamma")]);
  const body = element("body", [element("p", [text("alpha")]), paragraph, image, field, element("div", [], { shadow: [in_shadow] })]);
  assert.equal(model_of(body, paragraph).start_index, 6);
  assert.equal(model_of(body, image).start_index, 11);
  assert.equal(model_of(body, field).start_index, 11);
  assert.equal(model_of(body, in_shadow).start_index, 11);
  const last = element("img");
  assert.equal(model_of(element("body", [element("p", [text("only")]), last]), last).start_index, undefined);
});

test("the model is stale once a shadow host leaves the page", () => {
  const host = element("div", [], { shadow: [element("p", [text("in")])] });
  const model = model_of(element("body", [element("p", [text("top")]), host]));
  host.isConnected = true;
  assert.equal(trees_alive(model), true);
  host.isConnected = false;
  assert.equal(trees_alive(model), false);
  assert.equal(documents_of(model).length, 1);
});

test("the text of a node is read once, because each read of a page node's data copies it", () => {
  let reads = 0;
  const long_text = text("word ".repeat(5000));
  const data = long_text.data as string;
  Object.defineProperty(long_text, "data", { get: () => (reads++, data) });
  const model = model_of(element("body", [element("p", [long_text])]));
  assert.ok(model.text.startsWith("word word word"));
  assert.ok(reads <= 2, `the text was read ${reads} times`);
});
