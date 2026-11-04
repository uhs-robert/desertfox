import assert from "node:assert/strict";
import { test } from "node:test";
import { create_list, MAX_ROWS, window_top } from "../../src/cmdline/list.ts";
import type { Row } from "../../src/cmdline/completion/sources.ts";

type Node = { tag: string; className: string; textContent: string; children: Node[]; hidden: boolean; style: { setProperty: (name: string, value: string) => void; vars: Record<string, string> }; append: (...nodes: Node[]) => void; replaceChildren: (...nodes: Node[]) => void };

function fake_node(tag = "span"): Node {
  const vars: Record<string, string> = {};
  const node: Node = {
    tag,
    className: "",
    textContent: "",
    children: [],
    hidden: false,
    style: { vars, setProperty: (name, value) => void (vars[name] = value) },
    append: (...nodes) => void node.children.push(...nodes),
    replaceChildren: (...nodes) => void (node.children = nodes),
  };
  return node;
}

const rows = (count: number) => Array.from({ length: count }, (_, index): Row & { positions: number[] } => ({ name: `cmd${index}`, insert: "", description: `Do ${index}.`, args: index === 0 ? "" : "--x", also_named: [], keywords: [], usage: "", positions: index === 1 ? [0, 1] : [] }));

function setup() {
  Object.assign(globalThis, { document: { createElement: fake_node } });
  const element = fake_node("div");
  return { element, list: create_list(element as unknown as HTMLElement) };
}

test("the window shows at most ten rows and hides itself when there are none", () => {
  const { element, list } = setup();
  list.render(rows(25), -1);
  assert.equal(element.children.length, MAX_ROWS);
  list.render([], -1);
  assert.equal(element.hidden, true);
});

test("the window follows the selection down and up by the least that keeps it in view", () => {
  assert.equal(window_top(0, 9, 25), 0);
  assert.equal(window_top(0, 10, 25), 1);
  assert.equal(window_top(5, 4, 25), 4);
  assert.equal(window_top(5, -1, 25), 5);
  assert.equal(window_top(0, 24, 25), 15);
  assert.equal(window_top(3, 2, 5), 0);
});

test("a row has a name, a description and args with the collapsed form beside them", () => {
  const { element, list } = setup();
  list.render(rows(3), 1);
  const [first, second] = element.children as [Node, Node];
  assert.deepEqual(first.children.map((cell) => cell.className), ["oasisfox-cmdline-name", "oasisfox-cmdline-description", "oasisfox-cmdline-args"]);
  const args = second.children[2]!;
  assert.deepEqual(args.children.map((cell) => [cell.className, cell.textContent]), [["oasisfox-cmdline-args-full", "--x"], ["oasisfox-cmdline-args-short", "…"]]);
  // A row with no args collapses to nothing, not to an ellipsis.
  assert.equal(first.children[2]!.children[1]!.textContent, "");
});

test("only the selected row is marked, and only the matched letters of the name are bold", () => {
  const { element, list } = setup();
  list.render(rows(3), 1);
  assert.deepEqual((element.children as Node[]).map((row) => row.className.includes("selected")), [false, true, false]);
  const name = (element.children[1] as Node).children[0]!;
  assert.deepEqual(name.children.map((part) => [part.tag, part.textContent]), [["b", "cm"], ["span", "d1"]]);
});

test("the name column is as wide as the longest visible name, within a cap", () => {
  const { element, list } = setup();
  list.render(rows(3), -1);
  assert.equal(element.style.vars["--oasisfox-name-width"], "4ch");
  list.render([{ ...rows(1)[0]!, name: "x".repeat(60) }], -1);
  assert.equal(element.style.vars["--oasisfox-name-width"], "28ch");
});

test("a new ranking starts at the top, and the same ranking keeps its window while previewed", () => {
  const { element, list } = setup();
  const ranked = rows(25);
  list.render(ranked, 20);
  list.render(ranked, 20);
  const first_name = (element.children[0] as Node).children[0]!.children.map((part) => part.textContent).join("");
  assert.equal(first_name, "cmd11");
  list.render(rows(25), -1);
  assert.equal((element.children[0] as Node).children[0]!.children.map((part) => part.textContent).join(""), "cmd0");
});

test("a row marked unavailable carries the dim class and the others do not", () => {
  const { element, list } = setup();
  const [plain, dim] = rows(2);
  list.render([plain!, { ...dim!, unavailable: true, args: "unavailable" }], 0);
  const [first, second] = element.children;
  assert.equal(first!.className, "oasisfox-cmdline-item oasisfox-cmdline-selected");
  assert.equal(second!.className, "oasisfox-cmdline-item oasisfox-cmdline-unavailable");
  assert.equal(second!.children[2]!.children[0]!.textContent, "unavailable");
});
