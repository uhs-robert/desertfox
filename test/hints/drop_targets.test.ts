import assert from "node:assert/strict";
import { test } from "node:test";
import { drop_targets_of, keeps_narrowing, MARKERS } from "../../src/content/lib/drop_targets.ts";
import { query_for } from "../../src/content/lib/candidates.ts";

type Spec = { name: string; tag?: string; classes?: string[]; attrs?: Record<string, string>; marked?: string; shadow?: boolean; slider?: boolean; hidden?: boolean; children?: Spec[] };
type Node = { name: string; localName: string; parentElement: Node | null; parentNode: unknown; children: Node[]; classList: { contains: (name: string) => boolean; [Symbol.iterator]: () => Iterator<string> }; spec: Spec };

const MARKERS_LISTED = MARKERS.split(", ");
const SLIDER_SELECTOR_START = "input[type=range]";

// A fake page: a body of nodes with a flat `querySelectorAll` by tag or by the marker selector, as the real functions call it.
function page_of(specs: Spec[]): { nodes: Map<string, Node>; body: Node } {
  const all: Node[] = [];
  const nodes = new Map<string, Node>();
  const body: Node = { name: "body", localName: "body", parentElement: null, parentNode: null, children: [], classList: { contains: () => false, *[Symbol.iterator]() {} }, spec: { name: "body" } };
  const root = {
    // A tag name with a colon is no type selector until it is escaped, as in a browser.
    querySelectorAll: (selector: string) => {
      if (selector === MARKERS) return all.filter((node) => node.spec.marked !== undefined && MARKERS_LISTED.includes(node.spec.marked));
      if (/(^|[^\\]):/.test(selector)) throw new SyntaxError("invalid selector");
      return all.filter((node) => node.localName === selector.replace(/\\/g, ""));
    },
  };
  const doc = { documentElement: { name: "html" }, body };
  const make = (spec: Spec, parent: Node): Node => {
    const classes = spec.classes ?? [];
    const attrs = spec.attrs ?? {};
    const node = {
      name: spec.name,
      localName: spec.tag ?? "div",
      parentElement: parent.spec.shadow ? null : parent,
      parentNode: parent.spec.shadow ? { children: parent.children, host: parent } : parent,
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
  Object.assign(body, { parentNode: { children: [body] } });
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
  const { nodes } = page_of([board([{ name: "todo", children: [card("a"), card("b")] }]), { name: "side", children: [{ name: "far_zone", marked: "[ondrop]" }, { name: "far_plain" }] }]);
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

test("every listed marker marks a drop place", () => {
  const markers = MARKERS.split(", ").map((marker, index) => ({ name: `zone${index}`, marked: marker }));
  const { nodes } = page_of([board([{ name: "todo", children: [card("a"), card("b")] }]), { name: "side", children: markers }]);
  const found = names(drop_targets_of(nodes.get("a") as unknown as Element));
  for (const { name } of markers) assert.ok(found.includes(name), name);
});

test("an element that matches no listed marker is not a drop place", () => {
  const { nodes } = page_of([board([{ name: "todo", children: [card("a"), card("b")] }]), { name: "side", children: [{ name: "odd", marked: "[data-other]" }] }]);
  assert.ok(!names(drop_targets_of(nodes.get("a") as unknown as Element)).includes("odd"));
});

test("columns in a shadow root still give the empty column beside the source's column", () => {
  const { nodes } = page_of([{ name: "host", shadow: true, children: [{ name: "todo", children: [card("a"), card("b")] }, { name: "empty" }] }]);
  const found = names(drop_targets_of(nodes.get("a") as unknown as Element));
  assert.ok(found.includes("empty"));
  assert.ok(found.includes("todo"));
});

test("the narrowing is kept from two places and dropped below", () => {
  assert.equal(keeps_narrowing(0), false);
  assert.equal(keeps_narrowing(1), false);
  assert.equal(keeps_narrowing(2), true);
});

test("two cards directly under the body give one place, which is too few, so the pass falls back", () => {
  const { nodes } = page_of([card("a"), card("b")]);
  const targets = drop_targets_of(nodes.get("a") as unknown as Element)!;
  assert.deepEqual(names(targets), ["b"]);
  assert.equal(keeps_narrowing(targets.size), false);
});

test("a source whose tag is not a plain CSS name still finds its kin", () => {
  const { nodes } = page_of([board([{ name: "col", children: [card("a", { tag: "o:p" }), card("b", { tag: "o:p" })] }])]);
  assert.deepEqual(names(drop_targets_of(nodes.get("a") as unknown as Element)), ["b", "col"]);
});

test("a selector error gives no narrowing, so the pass labels every element", () => {
  const { nodes } = page_of([card("a"), card("b")]);
  const source = nodes.get("a") as unknown as Element;
  (source as unknown as { getRootNode: () => unknown }).getRootNode = () => ({ querySelectorAll: () => { throw new SyntaxError("bad"); } });
  assert.equal(drop_targets_of(source), undefined);
});
