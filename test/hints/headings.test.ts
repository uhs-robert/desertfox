import assert from "node:assert/strict";
import { load } from "cheerio";
import { test } from "node:test";
import { is_heading } from "../../src/content/hints/heading_match.ts";
import { NO_HEADING, covering_inset, scroll_room, heading_level, is_block, step_of, jump_in, keep_present, pick_heading, pick_heading_step, row_of, scroll_to_top, step_heading } from "../../src/content/hints/headings.ts";

type FakeHeading = { localName: string; text?: string; rendered?: string; role?: string; level?: string };
const heading = (fake: FakeHeading) => ({ localName: fake.localName, textContent: fake.text ?? "Title", innerText: fake.rendered ?? fake.text ?? "Title", getAttribute: (name: string) => (name === "role" ? (fake.role ?? null) : name === "aria-level" ? (fake.level ?? null) : null) }) as unknown as Element;

// `scroll_to_top` reads the page's own margin and padding. A plain page sets none.
const page_styles: Record<string, string> = {};
Object.defineProperty(globalThis, "getComputedStyle", { value: (element: { id?: string }) => ({ scrollMarginTop: page_styles[`margin ${element.id}`] ?? "0px", scrollPaddingTop: page_styles[`padding ${element.id}`] ?? "auto" }), configurable: true });

test("a heading with its text in a child counts, an empty one or one stripped of its role does not", () => {
  assert.equal(is_heading(heading({ localName: "h2" })), true);
  assert.equal(is_heading(heading({ localName: "div", role: "heading" })), true);
  assert.equal(is_heading(heading({ localName: "h2", text: " \n " })), false);
  assert.equal(is_heading(heading({ localName: "h2", role: "presentation" })), false);
  assert.equal(is_heading(heading({ localName: "h3", role: "none" })), false);
  assert.equal(is_heading(heading({ localName: "h3", role: "button" })), false);
});

test("the level comes from aria-level, else the tag, else 2", () => {
  assert.equal(heading_level(heading({ localName: "h4" })), 4);
  assert.equal(heading_level(heading({ localName: "h4", level: "1" })), 1);
  assert.equal(heading_level(heading({ localName: "div", role: "heading", level: "3" })), 3);
  assert.equal(heading_level(heading({ localName: "div", role: "heading" })), 2);
  assert.equal(heading_level(heading({ localName: "div", role: "heading", level: "99" })), 2);
});

test("a heading counts by its rendered text, not by hidden or script text in its content", () => {
  assert.equal(is_heading(heading({ localName: "h2", text: "x = 1", rendered: "" })), false);
  assert.equal(is_heading(heading({ localName: "h2", text: "Title", rendered: "Title" })), true);
});

test("a row holds the level and the rendered text on one line, whole however long", () => {
  assert.deepEqual(row_of(heading({ localName: "h3", text: "  Install\n   the   tool " })), { level: 3, text: "Install the tool" });
  assert.equal(row_of(heading({ localName: "h1", text: `${"x".repeat(150)} tail` })).text, `${"x".repeat(150)} tail`);
});

test("keep_present drops hidden, boxless, clipped and tiny headings and keeps off-screen ones", () => {
  const box = (top: number, height = 20) => [{ left: 0, top, right: 100, bottom: top + height }];
  const probe = (rects: Record<string, ReturnType<typeof box>>, hidden: string[] = [], clips: Record<string, ReturnType<typeof box>> = {}) => ({
    rects_of_: (name: string) => rects[name] ?? [],
    clips_of_: (name: string) => clips[name] ?? [],
    is_hidden_: (name: string) => hidden.includes(name),
  });
  const names_in = ["above", "below", "none", "hidden", "clipped", "tiny"];
  const kept = keep_present(
    names_in,
    probe({ above: box(-500), below: box(5000), hidden: box(0), clipped: box(0), tiny: box(0, 1) }, ["hidden"], { clipped: [{ left: 0, top: 100, right: 100, bottom: 200 }] }),
  );
  assert.deepEqual(kept, ["above", "below"]);
});

const rows = [
  { level: 1, text: "Guide" },
  { level: 2, text: "Install" },
  { level: 2, text: "2024 plan" },
  { level: 3, text: "Install from source" },
];

test("a leading number picks the heading at that place, whatever text follows", () => {
  assert.equal(pick_heading(rows, "2 Install"), 1);
  assert.equal(pick_heading(rows, "4"), 3);
  assert.equal(pick_heading(rows, "1 old title the page has changed since"), 0);
});

test("a number with text after it, past the end of the list, is part of the text", () => {
  assert.equal(pick_heading(rows, "2024 plan"), 2);
});

test("a bare number past the list is text, so a heading titled with a number can be reached", () => {
  const numbered = [...rows, { level: 2, text: "2024" }];
  assert.equal(pick_heading(numbered, "2024"), 4);
  assert.throws(() => pick_heading(rows, "9"), /No heading matches 9/);
});

test("text matches the whole heading, also past what the list shows", () => {
  const long = [{ level: 2, text: `${"a".repeat(120)} needle` }, { level: 2, text: "Other" }];
  assert.equal(pick_heading(long, "needle"), 0);
});

test("text picks the best fuzzy match and an equal tie takes the first on the page", () => {
  assert.equal(pick_heading(rows, "guide"), 0);
  assert.equal(pick_heading(rows, "source"), 3);
  assert.equal(pick_heading(rows, "install"), 1);
  assert.throws(() => pick_heading(rows, "zzz"), /No heading matches zzz/);
  assert.equal(pick_heading([{ level: 2, text: "Same" }, { level: 2, text: "Same" }], "same"), 0);
});

test("scroll_to_top scrolls the heading first and then each frame, innermost first, with nothing else touched", () => {
  const scrolls: string[] = [];
  const options: unknown[] = [];
  const at = (name: string) => ({ style: {}, scrollIntoView: (option: unknown) => (scrolls.push(name), options.push(option)) }) as unknown as Element;
  scroll_to_top(at("heading"), [at("outer"), at("inner")]);
  assert.deepEqual(scrolls, ["heading", "inner", "outer"]);
  assert.deepEqual(options[0], { block: "start", behavior: "instant" });
});

test("a heading that left the page, or whose frame did, gives That heading is gone and scrolls nothing", () => {
  const scrolls: string[] = [];
  const element = (connected: boolean) => ({ isConnected: connected, style: {}, scrollIntoView: () => scrolls.push("scrolled") }) as unknown as Element;
  const snapshot = (heading_element: Element, frames: Element[] = []) => ({ found: [{ element: heading_element, frames }], rows: [{ level: 2, text: "Intro" }] });
  assert.throws(() => jump_in(snapshot(element(false)), "1 Intro"), /That heading is gone/);
  assert.throws(() => jump_in(snapshot(element(true), [element(false)]), "1 Intro"), /That heading is gone/);
  assert.deepEqual(scrolls, []);
  jump_in(snapshot(element(true), [element(true)]), "1 Intro");
  assert.deepEqual(scrolls, ["scrolled", "scrolled"]);
});

// Tops are counted from the view top, so a heading the last jump put there is at 0.
const tops = [-300, -40, 0, 120, 900];

test("next starts below the view top and passes the heading the jump left there", () => {
  assert.equal(pick_heading_step(tops, "next", 1), 3);
  assert.equal(pick_heading_step([-300, -40, 0.5, 120], "next", 1), 3);
});

test("prev starts above the view top and passes the heading at it", () => {
  assert.equal(pick_heading_step(tops, "prev", 1), 1);
  assert.equal(pick_heading_step(tops, "prev", 2), 0);
});

test("a count moves that many headings and stops on the last or first", () => {
  assert.equal(pick_heading_step(tops, "next", 2), 4);
  assert.equal(pick_heading_step(tops, "next", 9), 4);
  assert.equal(pick_heading_step(tops, "prev", 9), 0);
});

test("there is no wrap: past the last or before the first is undefined", () => {
  assert.equal(pick_heading_step([-5, 0, 1], "next", 1), undefined);
  assert.equal(pick_heading_step([-1, 0, 50], "prev", 1), undefined);
  assert.equal(pick_heading_step([], "next", 1), undefined);
});

test("from a remembered heading the move steps by index, so a heading that cannot reach the top is passed", () => {
  // The page ends: the heading at index 2 sits 300px down and cannot scroll to the top. The view-top rule alone picks it again.
  const near_end = [-900, -400, 300, 700];
  assert.equal(pick_heading_step(near_end, "next", 1), 2);
  assert.equal(pick_heading_step(near_end, "next", 1, 2), 3);
  assert.equal(pick_heading_step(near_end, "prev", 1, 2), 1);
});

test("a count from the remembered heading moves that many and clamps, and the ends have no wrap", () => {
  const five = [-500, -200, 0, 200, 500];
  assert.equal(pick_heading_step(five, "next", 2, 1), 3);
  assert.equal(pick_heading_step(five, "next", 9, 1), 4);
  assert.equal(pick_heading_step(five, "prev", 9, 3), 0);
  assert.equal(pick_heading_step(five, "next", 1, 4), undefined);
  assert.equal(pick_heading_step(five, "prev", 1, 0), undefined);
});

test("first and last pick the ends of the list whatever the view top is, and an empty list is undefined", () => {
  assert.equal(pick_heading_step(tops, "first", 1), 0);
  assert.equal(pick_heading_step(tops, "last", 1), 4);
  assert.equal(pick_heading_step(tops, "first", 1, 2), 0);
  assert.equal(pick_heading_step(tops, "last", 1, 2), 4);
  assert.equal(pick_heading_step([], "first", 1), undefined);
  assert.equal(pick_heading_step([], "last", 1), undefined);
});

test("a count before first or last passes the check and is ignored", async () => {
  const { check_args } = await import("../../src/shared/registry/check_args.ts");
  const { registry } = await import("../../src/shared/registry/builtin.ts");
  await import("../../src/background/command_modules.ts");
  const command = registry.get("page.heading")!;
  for (const direction of ["first", "last"]) assert.equal(check_args(command, { direction, steps: 3 }).ok, true, direction);
});

// A real parsed fragment, so `closest` and the CHROME selector run as the browser runs them.
function block_in(html: string, id: string): Element {
  const $ = load(`<body>${html}</body>`);
  const wrap = (node: ReturnType<typeof $>): Element => {
    const element = node[0]!;
    const text = node.text();
    return {
      localName: (element as unknown as { name: string }).name,
      textContent: text,
      innerText: text,
      getAttribute: (name: string) => node.attr(name) ?? null,
      closest: (selector: string) => {
        const found = node.closest(selector);
        return found.length === 0 ? null : wrap(found);
      },
      get parentElement() {
        const parent = node.parent();
        return parent.length === 0 || parent[0]!.type !== "tag" || (parent[0] as unknown as { name: string }).name === "body" ? null : wrap(parent);
      },
    } as unknown as Element;
  };
  return wrap($(`#${id}`));
}
const LONG = "Enough running text to pass the forty character rule.";

test("a text block needs 40 characters of rendered text, a heading needs none", () => {
  const text = (tag: string, chars: number) => block_in(`<${tag} id="t">${"x".repeat(chars)}</${tag}>`, "t");
  assert.equal(is_block(text("p", 40)), true);
  assert.equal(is_block(text("p", 39)), false);
  assert.equal(is_block(text("pre", 40)), true);
  assert.equal(is_block(text("blockquote", 39)), false);
  assert.equal(is_block(text("h2", 3)), true);
  assert.equal(is_block(text("h2", 0)), false);
});

test("a block in each kind of page chrome is no stop, a heading included", () => {
  const chrome = [
    "<nav>%</nav>",
    "<footer>%</footer>",
    "<aside>%</aside>",
    "<form>%</form>",
    "<dialog>%</dialog>",
    "<header>%</header>",
    '<div role="navigation">%</div>',
    '<div role="banner">%</div>',
    '<div role="contentinfo">%</div>',
    '<div role="complementary">%</div>',
    '<div role="search">%</div>',
  ];
  for (const wrapper of chrome) {
    assert.equal(is_block(block_in(wrapper.replace("%", `<p id="t">${LONG}</p>`), "t")), false, wrapper);
    assert.equal(is_block(block_in(wrapper.replace("%", '<h2 id="t">Title</h2>'), "t")), false, wrapper);
  }
  assert.equal(is_block(block_in(`<main><p id="t">${LONG}</p></main>`, "t")), true);
});

test("a header is the page banner only where no article, aside, main, nav or section holds it", () => {
  assert.equal(is_block(block_in(`<header><p id="t">${LONG}</p></header>`, "t")), false);
  for (const holder of ["article", "main", "section"]) {
    assert.equal(is_block(block_in(`<${holder}><header><h1 id="t">Title</h1></header></${holder}>`, "t")), true, holder);
  }
});

test("a paragraph inside a blockquote is no stop, so the blockquote counts once", () => {
  const quote = `<blockquote id="q"><p id="p">${LONG}</p></blockquote><h3 id="h">Title</h3>`;
  assert.equal(is_block(block_in(quote, "p")), false);
  assert.equal(is_block(block_in(quote, "q")), true);
  assert.equal(is_block(block_in(`<blockquote><h3 id="h">Title</h3></blockquote>`, "h")), true);
});

test("the block directions step as next and prev, the heading directions as themselves", () => {
  assert.equal(step_of("next_block"), "next");
  assert.equal(step_of("prev_block"), "prev");
  for (const direction of ["next", "prev", "first", "last"] as const) assert.equal(step_of(direction), direction);
});

test("the notices name the section at the ends and on a page with none", () => {
  assert.equal(NO_HEADING.next_block, "No next section");
  assert.equal(NO_HEADING.prev_block, "No previous section");
  const real = globalThis.document;
  Object.defineProperty(globalThis, "document", { value: { querySelectorAll: () => [] }, configurable: true });
  try {
    assert.equal(step_heading("next_block", 1), "No sections");
    assert.equal(step_heading("prev_block", 2), "No sections");
    assert.equal(step_heading("next", 1), "No next heading");
  } finally {
    Object.defineProperty(globalThis, "document", { value: real, configurable: true });
  }
});

// A chain from the element under the probe point up to the root: each link has a position and, for the bar, the bottom edge.
const chain = (...links: { position: string; bottom?: number }[]): Element | null => {
  let parent: Element | null = null;
  for (const link of [...links].reverse()) parent = { parentElement: parent, position: link.position, getBoundingClientRect: () => ({ bottom: link.bottom ?? 0 }) } as unknown as Element;
  return parent;
};
const position_of = (element: Element) => (element as unknown as { position: string }).position;

test("a sticky or fixed element at the top edge gives the height of the view it covers", () => {
  assert.equal(covering_inset(chain({ position: "static" }, { position: "sticky", bottom: 97.2 }, { position: "static" }), position_of, 1000), 98);
  assert.equal(covering_inset(chain({ position: "fixed", bottom: 75 }), position_of, 1000), 75);
});

test("with no fixed or sticky element at the top edge, or a hit on nothing, there is no inset", () => {
  assert.equal(covering_inset(chain({ position: "static" }, { position: "relative", bottom: 50 }), position_of, 1000), 0);
  assert.equal(covering_inset(null, position_of, 1000), 0);
});

test("a bar over a third of the view or with no height below the top is not a header", () => {
  assert.equal(covering_inset(chain({ position: "fixed", bottom: 400 }), position_of, 1000), 0);
  assert.equal(covering_inset(chain({ position: "fixed", bottom: 0 }), position_of, 1000), 0);
});

test("scroll_to_top leaves the inset as scroll margin for the jump and restores the margin", () => {
  const margins: string[] = [];
  const style = { scrollMarginTop: "" };
  const target = { style, scrollIntoView: () => margins.push(style.scrollMarginTop) } as unknown as Element;
  scroll_to_top(target, []);
  scroll_to_top(target, [], 98);
  assert.deepEqual(margins, ["", "98px"]);
  assert.equal(style.scrollMarginTop, "");
});

test("scroll_to_top jumps again with the taller bar the second read finds, and not for the same or a smaller one", () => {
  const margins: string[] = [];
  const style = { scrollMarginTop: "" };
  const target = { style, scrollIntoView: () => margins.push(style.scrollMarginTop) } as unknown as Element;
  scroll_to_top(target, [], 0, () => 98);
  assert.deepEqual(margins, ["", "98px"]);
  margins.length = 0;
  scroll_to_top(target, [], 98, () => 98);
  scroll_to_top(target, [], 98, () => 50);
  assert.deepEqual(margins, ["98px", "98px"]);
});

test("the room is the bar less the scroll padding, and never below the page's own margin", () => {
  assert.equal(scroll_room(70, 0, 0), 70);
  assert.equal(scroll_room(70, 0, 70), 0);
  assert.equal(scroll_room(70, 0, 30), 40);
  assert.equal(scroll_room(0, 50, 0), 50);
  assert.equal(scroll_room(30, 50, 0), 50);
  assert.equal(scroll_room(98, 50, 0), 98);
});

test("scroll_to_top counts the scroller padding in the margin and keeps the page margin", () => {
  const margins: string[] = [];
  const style = { scrollMarginTop: "" };
  const holder = { id: "holder", parentElement: null };
  const target = { id: "target", parentElement: holder, style, scrollIntoView: () => margins.push(style.scrollMarginTop) } as unknown as Element;
  page_styles["padding holder"] = "70px";
  scroll_to_top(target, [], 70);
  assert.deepEqual(margins, [""]);
  delete page_styles["padding holder"];
  page_styles["margin target"] = "50px";
  margins.length = 0;
  scroll_to_top(target, [], 0);
  scroll_to_top(target, [], 98);
  assert.deepEqual(margins, ["", "98px"]);
  delete page_styles["margin target"];
});
