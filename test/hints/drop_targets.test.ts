import assert from "node:assert/strict";
import { test } from "node:test";
import { drop_targets_of } from "../../src/content/hints/drop_targets.ts";
import { query_for } from "../../src/content/hints/candidates.ts";

type Spec = { name: string; tag?: string; classes?: string[]; attrs?: Record<string, string>; marked?: boolean; slider?: boolean; hidden?: boolean; children?: Spec[] };
type Node = { name: string; localName: string; parentElement: Node | null; children: Node[]; classList: { contains: (name: string) => boolean; [Symbol.iterator]: () => Iterator<string> }; spec: Spec };

const MARKER_SELECTOR_START = "[ondrop]";
const SLIDER_SELECTOR_START = "input[type=range]";

// A fake page: a body of nodes with a flat `querySelectorAll` by tag or by the marker selector, as the real functions call it.
function page_of(specs: Spec[]): { nodes: Map<string, Node>; body: Node } {
  const all: Node[] = [];
  const nodes = new Map<string, Node>();
  const body: Node = { name: "body", localName: "body", parentElement: null, children: [], classList: { contains: () => false, *[Symbol.iterator]() {} }, spec: { name: "body" } };
  const root = {
    querySelectorAll: (selector: string) => (selector.startsWith(MARKER_SELECTOR_START) ? all.filter((node) => node.spec.marked) : all.filter((node) => node.localName === selector)),
  };
  const doc = { documentElement: { name: "html" }, body };
  const make = (spec: Spec, parent: Node): Node => {
    const classes = spec.classes ?? [];
    const attrs = spec.attrs ?? {};
    const node = {
      name: spec.name,
      localName: spec.tag ?? "div",
      parentElement: parent,
      children: [] as Node[],
      classList: { contains: (name: string) => classes.includes(name), [Symbol.iterator]: () => classes[Symbol.iterator]() },
      spec,
      hasAttribute: (name: string) => name in attrs,
      getAttribute: (name: string) => attrs[name] ?? null,
      matches: (selector: string) => selector.startsWith(SLIDER_SELECTOR_START) && spec.slider === true,
      getBoundingClientRect: () => ({ width: spec.hidden ? 0 : 100, height: spec.hidden ? 0 : 50 }),
      getRootNode: () => root,
      ownerDocument: doc,
    } as unknown as Node;
    all.push(node);
    nodes.set(spec.name, node);
    parent.children.push(node);
    for (const child of spec.children ?? []) make(child, node);
    return node;
  };
  for (const spec of specs) make(spec, body);
  body.children.forEach((child) => ((child as unknown as { parentElement: Node }).parentElement = body));
  Object.assign(body, { getBoundingClientRect: () => ({ width: 100, height: 100 }) });
  return { nodes, body };
}

const names = (targets: Set<Element> | undefined) => [...(targets ?? [])].map((element) => (element as unknown as Node).name).sort();

const card = (name: string, extra: Partial<Spec> = {}): Spec => ({ name, classes: ["card"], ...extra });
const board = (columns: Spec[]): Spec => ({ name: "board", children: columns });

test("cards of other columns, the columns and an empty column are targets", () => {
  const { nodes } = page_of([board([{ name: "todo", children: [card("a"), card("b")] }, { name: "doing", children: [card("c")] }, { name: "empty" }])]);
  const targets = drop_targets_of(nodes.get("a") as unknown as Element);
  assert.deepEqual(names(targets), ["b", "c", "doing", "empty", "todo"]);
});

test("an empty column nested under a wrapper still shows through the peers of an ancestor", () => {
  const { nodes } = page_of([board([{ name: "todo", children: [{ name: "list", children: [card("a"), card("b")] }] }, { name: "empty", children: [{ name: "only_child_wrapper" }] }])]);
  assert.ok(names(drop_targets_of(nodes.get("a") as unknown as Element)).includes("empty"));
});

test("a drop marker far from the source is a target, an unmarked far box is not", () => {
  const { nodes } = page_of([board([{ name: "todo", children: [card("a"), card("b")] }]), { name: "side", children: [{ name: "far_zone", marked: true }, { name: "far_plain" }] }]);
  const found = names(drop_targets_of(nodes.get("a") as unknown as Element));
  assert.ok(found.includes("far_zone"));
  assert.ok(!found.includes("far_plain"));
});

test("a source with no kin gives no narrowing", () => {
  const { nodes } = page_of([{ name: "src", classes: ["lonely"] }, { name: "dst" }]);
  assert.equal(drop_targets_of(nodes.get("src") as unknown as Element), undefined);
});

test("a pointer widget keeps every element", () => {
  const { nodes } = page_of([card("a", { slider: true }), card("b")]);
  assert.equal(drop_targets_of(nodes.get("a") as unknown as Element), undefined);
});

test("kin share a test id or the draggable mark when the classes differ", () => {
  const { nodes } = page_of([board([{ name: "col", children: [{ name: "a", attrs: { "data-testid": "card" } }, { name: "b", attrs: { "data-testid": "card" } }, { name: "x", attrs: { "data-testid": "other" } }] }])]);
  const found = names(drop_targets_of(nodes.get("a") as unknown as Element));
  assert.ok(found.includes("b"));
});

test("the source itself and a box with no size are not targets", () => {
  const { nodes } = page_of([board([{ name: "todo", children: [card("a"), card("b")] }, { name: "hidden_col", hidden: true }])]);
  const found = names(drop_targets_of(nodes.get("a") as unknown as Element));
  assert.ok(!found.includes("a"));
  assert.ok(!found.includes("hidden_col"));
});

test("the drop filter acts as every when the source has no structure, or no source", () => {
  const { nodes } = page_of([{ name: "src", classes: ["lonely"] }]);
  assert.equal(query_for("drop", undefined, nodes.get("src") as unknown as Element).selector, "*");
  assert.equal(query_for("drop", undefined, nodes.get("src") as unknown as Element), query_for("every", undefined));
  assert.equal(query_for("drop", undefined), query_for("every", undefined));
});

test("the drop filter keeps only the found targets", () => {
  const { nodes } = page_of([board([{ name: "todo", children: [card("a"), card("b")] }, { name: "empty" }])]);
  const query = query_for("drop", undefined, nodes.get("a") as unknown as Element);
  assert.equal(query.test?.(nodes.get("empty") as unknown as Element), true);
  assert.equal(query.test?.(nodes.get("board") as unknown as Element), false);
});
