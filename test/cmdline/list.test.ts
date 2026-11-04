import assert from "node:assert/strict";
import { test } from "node:test";
import { create_list, MAX_ROWS, window_top } from "../../src/cmdline/list.ts";
import type { Row } from "../../src/cmdline/completion/sources.ts";

type Node = { tag: string; className: string; textContent: string; dataset: Record<string, string>; children: Node[]; hidden: boolean; offsetHeight: number; style: { minHeight: string; setProperty: (name: string, value: string) => void; vars: Record<string, string> }; append: (...nodes: Node[]) => void; replaceChildren: (...nodes: Node[]) => void };

function fake_node(tag = "span"): Node {
  const vars: Record<string, string> = {};
  const node: Node = {
    tag,
    className: "",
    textContent: "",
    dataset: {},
    children: [],
    hidden: false,
    offsetHeight: 0,
    style: { minHeight: "", vars, setProperty: (name, value) => void (vars[name] = value) },
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

test("while loading with no rows the list is empty and holds its height, and an empty result after loading hides it", () => {
  const { element, list } = setup();
  list.render(rows(5), 2);
  (element as unknown as { offsetHeight: number }).offsetHeight = 100;
  list.render([], -1, true);
  assert.equal(element.hidden, false);
  assert.equal(element.children.length, 0);
  assert.equal(element.style.minHeight, "100px");
  list.render(rows(3), -1);
  assert.equal(element.style.minHeight, "");
  list.render([], -1, false);
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
  assert.deepEqual(first.children.map((cell) => cell.className), ["oasisfox-cmdline-name", "oasisfox-cmdline-description", "oasisfox-cmdline-args", "oasisfox-cmdline-keys"]);
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

test("a row with a tag gets a dim tag cell after the args and before the keys, and a row without one gets none", () => {
  const { element, list } = setup();
  const [plain, tagged] = rows(2);
  list.render([plain!, { ...tagged!, tag: "hist" }], 0);
  const [first, second] = element.children as [Node, Node];
  assert.deepEqual(first.children.map((cell) => cell.className).slice(3), ["oasisfox-cmdline-keys"]);
  assert.deepEqual(second.children.map((cell) => cell.className).slice(3), ["oasisfox-cmdline-tag", "oasisfox-cmdline-keys"]);
  assert.equal(second.children[3]!.textContent, "hist");
});

test("a command row shows its keys in the last cell and a row with no id shows none", () => {
  Object.assign(globalThis, { document: { createElement: fake_node } });
  const element = fake_node("div");
  const list = create_list(element as unknown as HTMLElement, (id) => (id === "tab.close" ? "d dH +1" : ""));
  const [command, flag, bare] = rows(3);
  list.render([{ ...command!, id: "tab.close" }, flag!, { ...bare!, id: "tab.next" }], -1);
  const texts = (element.children as Node[]).map((row) => row.children[3]!.textContent);
  assert.deepEqual(texts, ["d dH +1", "", ""]);
  assert.equal(element.style.vars["--oasisfox-keys-width"], "7ch");
});

test("a tab row leads with the status, container and favicon cells, and a row without tab marks has none", () => {
  const { element, list } = setup();
  const [plain] = rows(1);
  const tab = { ...plain!, tab: { status: "%", flags: ["pinned", "muted"] as ("pinned" | "muted")[], favicon: "https://a.test/i.png", container: { color: "#37adff", icon: "resource://usercontext-content/fingerprint.svg" } } };
  list.render([plain!, tab], -1);
  const [first, second] = element.children as [Node, Node];
  assert.equal(first.children[0]!.className, "oasisfox-cmdline-name");
  assert.deepEqual(second.children.map((cell) => cell.className), ["oasisfox-cmdline-tab-status", "oasisfox-cmdline-container", "oasisfox-cmdline-favicon", "oasisfox-cmdline-name", "oasisfox-cmdline-description", "oasisfox-cmdline-args", "oasisfox-cmdline-keys"]);
  const [status, container, favicon] = second.children as [Node, Node, Node];
  assert.deepEqual(status.children.map((cell) => [cell.className, cell.textContent]), [["oasisfox-cmdline-tab-mark", "%"], ["oasisfox-cmdline-flag oasisfox-cmdline-flag-pinned", ""], ["oasisfox-cmdline-flag oasisfox-cmdline-flag-muted", ""]]);
  assert.equal(container.style.vars["--oasisfox-container-color"], "#37adff");
  assert.equal((favicon.children[0] as unknown as { src: string }).src, "https://a.test/i.png");
  assert.equal(element.style.vars["--oasisfox-flags-width"], "28px");
});

test("a tab with no container or favicon draws empty cells, and no flags take no width", () => {
  const { element, list } = setup();
  list.render([{ ...rows(1)[0]!, tab: { status: "", flags: [] } }], -1);
  const [container, favicon] = (element.children[0] as Node).children.slice(1, 3) as [Node, Node];
  assert.deepEqual([container.children.length, favicon.children.length], [0, 0]);
  assert.equal(element.style.vars["--oasisfox-flags-width"], "0px");
});

test("an image that fails to load is hidden, and a container icon that fails becomes a dot", () => {
  const { element, list } = setup();
  list.render([{ ...rows(1)[0]!, tab: { status: "#", flags: [], favicon: "https://a.test/i.png", container: { color: "red", icon: "resource://x/y.svg" } } }], -1);
  const [container, favicon] = (element.children[0] as Node).children.slice(1, 3) as [Node, Node];
  for (const holder of [container, favicon]) {
    const image = holder.children[0] as unknown as { hidden: boolean; onerror: () => void };
    image.onerror();
    assert.equal(image.hidden, true);
  }
  assert.ok(container.className.includes("oasisfox-cmdline-container-dot"));
  assert.equal(favicon.className, "oasisfox-cmdline-favicon");
});

test("a redraw reuses the image node of a favicon, so a keystroke fetches nothing again", () => {
  const { element, list } = setup();
  const tab = { ...rows(1)[0]!, tab: { status: "", flags: [], favicon: "https://a.test/i.png" } };
  list.render([tab], -1);
  const first = (element.children[0] as Node).children[2]!.children[0];
  list.render([{ ...tab }], 0);
  assert.equal((element.children[0] as Node).children[2]!.children[0], first);
});

test("a container icon that failed once is a dot again after a redraw", () => {
  const { element, list } = setup();
  const tab = { ...rows(1)[0]!, tab: { status: "", flags: [], container: { color: "red", icon: "resource://x/y.svg" } } };
  list.render([tab], -1);
  ((element.children[0] as Node).children[1]!.children[0] as unknown as { onerror: () => void }).onerror();
  list.render([{ ...tab }], 0);
  assert.ok((element.children[0] as Node).children[1]!.className.includes("oasisfox-cmdline-container-dot"));
});

test("rows with the same favicon each keep their own image node across a redraw", () => {
  const { element, list } = setup();
  const [one, two] = rows(2).map((row) => ({ ...row, tab: { status: "", flags: [], favicon: "https://a.test/i.png" } }));
  list.render([one!, two!], -1);
  const images = () => (element.children as Node[]).map((row) => row.children[2]!.children[0]);
  const first = images();
  assert.notEqual(first[0], first[1]);
  list.render([one!, two!], 0);
  assert.deepEqual(images(), first);
});

const first_name = (element: Node) => element.children[0]!.children.find((child) => child.className.includes("name"))!.children.map((part) => part.textContent).join("");

test("scroll moves the window by rows, keeps the selection, and stops at both ends", () => {
  const { element, list } = setup();
  list.render(rows(25), 0);
  list.scroll(3);
  assert.equal(first_name(element), "cmd3");
  list.scroll(100);
  assert.equal(first_name(element), "cmd15");
  list.scroll(-100);
  assert.equal(first_name(element), "cmd0");
});

test("render keeps a scrolled view for the same rows and selection, and follows a moved selection", () => {
  const { element, list } = setup();
  const ranked = rows(25);
  list.render(ranked, 0);
  list.scroll(6);
  list.render(ranked, 0);
  assert.equal(first_name(element), "cmd6");
  list.render(ranked, 2);
  assert.equal(first_name(element), "cmd2");
  list.render(rows(25), 0);
  assert.equal(first_name(element), "cmd0");
});

test("only command rows get the help link, and each item carries its absolute index after a scroll", () => {
  const { element, list } = setup();
  const all = rows(25).map((row, index) => (index % 2 === 0 ? { ...row, id: `cmd.${index}` } : row));
  list.render(all, -1);
  list.scroll(5);
  const items = element.children;
  assert.deepEqual(items.map((item) => item.dataset.index), Array.from({ length: MAX_ROWS }, (_, offset) => String(5 + offset)));
  const name_of = (item: Node) => item.children.find((child) => child.className.startsWith("oasisfox-cmdline-name"))!;
  assert.deepEqual(items.map((item) => name_of(item).dataset.help), items.map((_, offset) => ((5 + offset) % 2 === 0 ? `cmd.${5 + offset}` : undefined)));
  assert.ok(name_of(items[1]!).className.includes("oasisfox-cmdline-link"));
  assert.ok(!name_of(items[0]!).className.includes("oasisfox-cmdline-link"));
});

test("a command row without a help card gets no link", () => {
  Object.assign(globalThis, { document: { createElement: fake_node } });
  const element = fake_node("div");
  const list = create_list(element as unknown as HTMLElement, () => "", (id) => id !== "snippet.one");
  list.render([{ ...rows(2)[0]!, id: "snippet.one" }, { ...rows(2)[1]!, id: "tab.next" }], -1);
  const name_of = (item: Node) => item.children.find((child) => child.className.startsWith("oasisfox-cmdline-name"))!;
  assert.deepEqual(element.children.map((item) => name_of(item).dataset.help), [undefined, "tab.next"]);
});
