import assert from "node:assert/strict";
import { test } from "node:test";
import { selector_of } from "../../src/content/hints/selector_of.ts";

type Fake = { localName: string; id: string; classList: string[]; parentElement: Fake | null; children: Fake[] };

function node(localName: string, options: { id?: string; classes?: string[] } = {}, children: Fake[] = []): Fake {
  const made: Fake = { localName, id: options.id ?? "", classList: options.classes ?? [], parentElement: null, children };
  for (const child of children) child.parentElement = made;
  return made;
}

const every = (root: Fake): Fake[] => [root, ...root.children.flatMap(every)];

// Matches the three step shapes selector_of writes, joined by " > ", anchored anywhere.
function matches_step(item: Fake, step: string): boolean {
  if (step.startsWith("#")) return item.id === step.slice(1);
  const nth = step.match(/^(\w+):nth-of-type\((\d+)\)$/);
  if (nth) return item.localName === nth[1] && item.parentElement!.children.filter((s) => s.localName === nth[1]).indexOf(item) === Number(nth[2]) - 1;
  const [tag, ...classes] = step.split(".");
  return item.localName === tag && classes.every((name) => item.classList.includes(name));
}

function count_in(root: Fake) {
  return (selector: string): number => {
    const steps = selector.split(" > ");
    return every(root).filter((item) => {
      let at: Fake | null = item;
      for (const step of [...steps].reverse()) {
        if (!at || !matches_step(at, step)) return false;
        at = at.parentElement;
      }
      return true;
    }).length;
  };
}

test("a unique id is the whole selector", () => {
  const target = node("button", { id: "save" });
  const root = node("html", {}, [node("body", {}, [target, node("button")])]);
  assert.equal(selector_of(target, count_in(root)), "#save");
});

test("a tag that is unique in the root is the whole selector", () => {
  const target = node("main");
  const root = node("html", {}, [node("body", {}, [target, node("div")])]);
  assert.equal(selector_of(target, count_in(root)), "main");
});

test("a class tells apart same-tag siblings", () => {
  const target = node("li", { classes: ["on"] });
  const root = node("html", {}, [node("body", {}, [node("ul", {}, [node("li"), target])])]);
  assert.equal(selector_of(target, count_in(root)), "li.on");
});

test("position tells apart same-tag siblings with no usable class", () => {
  const target = node("li", { classes: ["css-1x9f3a2", "a1b2c3d4e5"] });
  const root = node("html", {}, [node("body", {}, [node("ul", {}, [node("li"), target])])]);
  assert.equal(selector_of(target, count_in(root)), "li:nth-of-type(2)");
});

test("the path climbs only until it is unique, through an id that looks generated", () => {
  const target = node("span");
  const first = node("p", {}, [node("span"), node("span")]);
  const second = node("p", {}, [target, node("em")]);
  const root = node("html", {}, [node("body", {}, [node("section", { id: "intro" }, [first]), node("section", { id: "item-12345" }, [second])])]);
  assert.equal(selector_of(target, count_in(root)), "section:nth-of-type(2) > p > span");
});

test("a generated id is skipped and the path goes through it", () => {
  const target = node("div", { id: "root-8f3a9c21d4" });
  const root = node("html", {}, [node("body", {}, [target, node("div")])]);
  assert.equal(selector_of(target, count_in(root)), "div:nth-of-type(1)");
});

test("ids that look generated or need escaping are skipped", () => {
  for (const id of ["react-12345", "css-1abcd", "sc-bdVaJa", "jsx-123", "a:b", "1st", "deadbeef01"]) {
    const target = node("div", { id });
    const root = node("html", {}, [node("body", {}, [target, node("div")])]);
    assert.ok(!selector_of(target, count_in(root)).includes("#"), id);
  }
});
