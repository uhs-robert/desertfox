import assert from "node:assert/strict";
import { test } from "node:test";
import { find_items } from "../src/content/item/finder.ts";
import { saved_reader } from "./support/snapshot_page.ts";
import type { SavedNode, SavedPage } from "./support/snapshot_page.ts";

// A stand-in for a video site's front page, written by hand: a grid of thumbnail tiles, four to a row. Each tile holds the picture link (with its length and quality over it), the title link under the picture and a short channel link. Both links of a tile go to the same video.
function video_grid(tile_height = (_index: number) => 256): SavedPage {
  const tile = (index: number): SavedNode => {
    const [x, y] = [35 + (index % 4) * 330, 120 + Math.floor(index / 4) * 270];
    const video = `/video/${index}/a-video`;
    return {
      t: "div",
      a: { class: "tile" },
      r: [x, y, 321, tile_height(index)],
      c: [
        { t: "a", a: { class: "thumb", href: video }, r: [x, y, 321, 200], s: "10 min 720p", c: [{ t: "img", r: [x, y, 321, 200] }] },
        { t: "p", a: { class: "title" }, r: [x, y + 205, 321, 20], n: 40, c: [{ t: "a", a: { href: video }, r: [x, y + 205, 300, 20], s: `The video with the number ${index} in its title` }] },
        { t: "p", a: { class: "meta" }, r: [x, y + 230, 321, 18], n: 12, c: [{ t: "a", a: { href: `/channel/${index}` }, r: [x, y + 230, 90, 18], s: "Channel name" }] },
      ],
    };
  };
  const grid: SavedNode = { t: "div", a: { class: "grid" }, r: [35, 120, 1310, 1610], c: Array.from({ length: 24 }, (_, index) => tile(index)) };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 1800], c: [{ t: "body", r: [0, 0, 1366, 1800], c: [grid] }] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  return { view: { w: 1366, h: 682, doc_h: 1800 }, root };
}

test("a grid of video thumbnails is a grid, and the title under each picture is the link that takes the focus", () => {
  const found = find_items(saved_reader(video_grid()));
  assert.equal(found.kind, "grid");
  assert.equal(found.items.length, 24);
  assert.ok(found.items.every((item) => found.links.get(item)?.s?.startsWith("The video with the number")));
});

test("top-aligned cards of unequal height in a row are still a grid", () => {
  const found = find_items(saved_reader(video_grid((index) => 200 + (index % 4) * 20)));
  assert.equal(found.kind, "grid");
});

// Sections stacked down the page, each holding two cards that fill about 46% of it (the shape of a news front). The cards are the items, not the sections and not the pieces of a card.
test("cards that fill nearly half of every section stay the picked items", () => {
  const card = (x: number, y: number, index: number): SavedNode => ({
    t: "div",
    a: { class: "card" },
    r: [x, y, 300, 300],
    c: [
      { t: "a", a: { href: `/story/${index}` }, r: [x, y, 300, 20], s: `Story number ${index} headline`, c: [] },
      { t: "p", r: [x, y + 30, 300, 100], n: 200, c: [] },
    ],
  });
  const section = (index: number): SavedNode => {
    const y = 100 + index * 400;
    return { t: "section", a: { class: "block" }, r: [35, y, 1300, 300], c: [card(35, y, index * 2), card(400, y, index * 2 + 1)] };
  };
  const body: SavedNode = { t: "body", r: [0, 0, 1366, 2600], c: Array.from({ length: 6 }, (_, index) => section(index)) };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 2600], c: [body] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  const found = find_items(saved_reader({ view: { w: 1366, h: 682, doc_h: 2600 }, root }));
  assert.equal(found.items.length, 12);
  assert.ok(found.items.every((item) => item.a?.class === "card"));
});

// Five sections in a holder, three of which hold two small blocks each, and four more such blocks in a lone section outside the holder. That section has the kind of the sections, so its blocks merge with theirs. Three of five is under the share that marks card parts, so the finder steps into the blocks. An item with no holder must not count as a fourth holder.
test("an inner group held by three of five sections, with items outside them, is not card parts", () => {
  const block = (x: number, y: number, index: number): SavedNode => ({
    t: "div",
    a: { class: "block" },
    r: [x, y, 300, 100],
    c: [{ t: "a", a: { href: `/story/${index}` }, r: [x, y, 300, 20], s: `Story number ${index} headline`, c: [] }],
  });
  const section = (index: number): SavedNode => {
    const y = 100 + index * 400;
    const blocks = index < 3 ? [block(35, y, index * 2), block(35, y + 120, index * 2 + 1)] : [];
    return { t: "section", a: { class: "block_group" }, r: [35, y, 1300, 300], c: blocks };
  };
  const outside: SavedNode = { t: "div", a: { class: "outer" }, r: [35, 2100, 1300, 480], c: [{ t: "section", a: { class: "block_group" }, r: [35, 2100, 1300, 480], c: [0, 1, 2, 3].map((index) => block(35, 2100 + index * 120, 10 + index)) }] };
  const holder: SavedNode = { t: "div", a: { class: "holder" }, r: [35, 100, 1300, 2000], c: Array.from({ length: 5 }, (_, index) => section(index)) };
  const body: SavedNode = { t: "body", r: [0, 0, 1366, 2600], c: [holder, outside] };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 2600], c: [body] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  const found = find_items(saved_reader({ view: { w: 1366, h: 682, doc_h: 2600 }, root }));
  assert.equal(found.items.length, 10);
  assert.equal(found.sections?.length, 5);
});

// Ten stacked comment panels. Each has a short link at the top and a long link low in the panel ("Show 12 more replies"), and both go to the same address. When that address is a placeholder the two links do not name one target, so the long link is no title and the panels are no list. A real shared address still names the item.
function reply_panels(href: string): SavedPage {
  const panel = (index: number): SavedNode => {
    const y = 100 + index * 220;
    return {
      t: "div",
      a: { class: "panel" },
      r: [35, y, 800, 200],
      c: [
        { t: "a", a: { href }, r: [35, y, 60, 20], s: "Reply", c: [] },
        { t: "a", a: { href }, r: [35, y + 150, 300, 20], s: "Show 12 more replies", c: [] },
      ],
    };
  };
  const list: SavedNode = { t: "div", a: { class: "thread" }, r: [35, 100, 800, 2200], c: Array.from({ length: 10 }, (_, index) => panel(index)) };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 2400], c: [{ t: "body", r: [0, 0, 1366, 2400], c: [list] }] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  return { view: { w: 1366, h: 682, doc_h: 2400 }, root };
}

test("links that share only a placeholder address do not name their panel", () => {
  for (const href of ["#", "", "javascript:void(0)", " JavaScript:;"]) {
    assert.equal(find_items(saved_reader(reply_panels(href))).items.length, 0, `href ${JSON.stringify(href)}`);
  }
});

test("links that share a real address or a fragment name their panel", () => {
  for (const href of ["/thread/7", "#item-3"]) {
    assert.equal(find_items(saved_reader(reply_panels(href))).items.length, 10, `href ${JSON.stringify(href)}`);
  }
});

// Cards whose picture is no link: the title link sits below it with a script address, and a short "Save" link follows. The title is the first link, so it names its card wherever it sits.
test("a first link with a placeholder address still names its card below an unlinked picture", () => {
  const tile = (index: number): SavedNode => {
    const [x, y] = [35 + (index % 4) * 330, 120 + Math.floor(index / 4) * 310];
    return {
      t: "div",
      a: { class: "tile" },
      r: [x, y, 321, 290],
      c: [
        { t: "img", r: [x, y, 321, 200] },
        { t: "a", a: { href: "javascript:void(0)" }, r: [x, y + 205, 300, 20], s: `The product with the number ${index} in its title`, c: [] },
        { t: "a", a: { href: `/save/${index}` }, r: [x, y + 250, 60, 20], s: "Save", c: [] },
      ],
    };
  };
  const grid: SavedNode = { t: "div", a: { class: "grid" }, r: [35, 120, 1310, 1860], c: Array.from({ length: 24 }, (_, index) => tile(index)) };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 2100], c: [{ t: "body", r: [0, 0, 1366, 2100], c: [grid] }] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  const found = find_items(saved_reader({ view: { w: 1366, h: 682, doc_h: 2100 }, root }));
  assert.equal(found.kind, "grid");
  assert.equal(found.items.length, 24);
});

// A feed that loads more by replacing its trailing form with a frame inside the first frame, which holds the next batch. The second batch uses another tag for the same template. Both batches are one list, in document order.
test("a batch in a frame nested inside the first batch's frame joins the list, whatever its tag", () => {
  const item = (tag: string, y: number, index: number): SavedNode => ({
    t: tag,
    a: { class: "entry" },
    r: [35, y, 650, 140],
    c: [{ t: "a", a: { href: `/entry/${index}` }, r: [35, y, 600, 20], s: `Entry number ${index} headline`, c: [] }],
  });
  const batch = (tag: string, first: number, y: number, nested: SavedNode[] = []): SavedNode => ({
    t: "frame",
    r: [35, y, 650, 150 * (4 + nested.length)],
    c: [...[0, 1, 2, 3].map((at) => item(tag, y + at * 150, first + at)), ...nested],
  });
  const second = batch("div", 4, 700);
  const first = batch("article", 0, 100, [second]);
  const body: SavedNode = { t: "body", r: [0, 0, 1366, 1400], c: [first] };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 1400], c: [body] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  const found = find_items(saved_reader({ view: { w: 1366, h: 682, doc_h: 1400 }, root }));
  assert.deepEqual(found.items.map((entry) => found.links.get(entry)?.s), [0, 1, 2, 3, 4, 5, 6, 7].map((index) => `Entry number ${index} headline`));
});

// Hand-written pages for the nested-batch rule's negative cases: `entry` is a titled block of one class (or none), stacked from `y`.
const entry = (tag: string, cls: string | undefined, y: number, index: number, kids: SavedNode[] = []): SavedNode => ({
  t: tag,
  ...(cls && { a: { class: cls } }),
  r: [35, y, 650, 140],
  c: [{ t: "a", a: { href: `/entry/${index}` }, r: [35, y, 600, 20], s: `Entry number ${index} headline`, c: [] }, ...kids],
});
function page_with(children: SavedNode[], height = 1400): SavedPage {
  const root: SavedNode = { t: "html", r: [0, 0, 1366, height], c: [{ t: "body", r: [0, 0, 1366, height], c: children }] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  return { view: { w: 1366, h: 682, doc_h: height }, root };
}
const titles_of = (found: ReturnType<typeof find_items<SavedNode>>) => found.items.map((item) => found.links.get(item)?.s);

test("classless sections that hold classless cards keep the cards as the items", () => {
  const section = (at: number): SavedNode => {
    const y = 100 + at * 400;
    return { t: "div", r: [35, y, 650, 380], c: [0, 1, 2].map((card) => entry("div", undefined, y + card * 120, at * 3 + card)) };
  };
  const found = find_items(saved_reader(page_with([0, 1, 2].map(section), 1400)));
  assert.deepEqual(titles_of(found), [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => `Entry number ${index} headline`));
});

test("cards and the rows inside them that share a class do not join into one list", () => {
  const card = (at: number): SavedNode => {
    const y = 100 + at * 300;
    return { ...entry("div", "flex", y, at * 10, [0, 1].map((row) => entry("div", "flex", y + 30 + row * 100, at * 10 + row + 1))), r: [35, y, 650, 280] };
  };
  const found = find_items(saved_reader(page_with([0, 1, 2, 3].map(card), 1400)));
  // The rows are the items, as without the rule. The cards must not join them after the rows.
  assert.deepEqual(titles_of(found), [1, 2, 11, 12, 21, 22, 31, 32].map((index) => `Entry number ${index} headline`));
});

test("a block of the feed's own item class that sits before the feed's items is not a later batch", () => {
  const side: SavedNode = { t: "div", a: { class: "related" }, r: [35, 100, 650, 450], c: [0, 1, 2].map((at) => entry("article", "entry", 100 + at * 150, 90 + at)) };
  const feed = [0, 1, 2, 3, 4, 5].map((at) => entry("article", "entry", 600 + at * 150, at));
  const found = find_items(saved_reader(page_with([side, ...feed], 1600)));
  assert.deepEqual(titles_of(found), [0, 1, 2, 3, 4, 5].map((index) => `Entry number ${index} headline`));
});

// Two sibling parents, each with six stacked entries that hold a title link. When both parents are one kind the entries are one list of twelve. When the parents differ in tag or class (a video page's title rows and its comment section), the groups stay apart and neither passes the span test on its own.
function sibling_parents(second_class: string): SavedPage {
  const parent = (class_name: string, first: number): SavedNode => {
    const y = 100 + first * 100;
    const entry = (index: number): SavedNode => ({
      t: "div",
      a: { class: "entry" },
      r: [35, y + (index - first) * 100, 800, 80],
      c: [{ t: "a", a: { href: `/entry/${index}` }, r: [35, y + (index - first) * 100, 400, 20], s: `The entry with the number ${index}`, c: [] }],
    });
    return { t: "div", a: { class: class_name }, r: [35, y, 800, 600], c: Array.from({ length: 6 }, (_, at) => entry(first + at)) };
  };
  const holder: SavedNode = { t: "div", r: [35, 100, 800, 1200], c: [parent("batch", 0), parent(second_class, 6)] };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 1400], c: [{ t: "body", r: [0, 0, 1366, 1400], c: [holder] }] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  return { view: { w: 1366, h: 1000, doc_h: 1400 }, root };
}

test("sibling parents of one kind merge their entries, and parents of another kind stay apart", () => {
  assert.equal(find_items(saved_reader(sibling_parents("batch"))).items.length, 12);
  assert.equal(find_items(saved_reader(sibling_parents("comments"))).items.length, 0);
});

// Ten stacked entries, each with a short link in a heading: a comment's author handle (a page of its own) or a manual's section name (a fragment of the same page).
function short_heading_entries(heading: string, href: (index: number) => string): SavedPage {
  const entry = (index: number): SavedNode => {
    const y = 100 + index * 220;
    return {
      t: "div",
      a: { class: "entry" },
      r: [35, y, 800, 200],
      c: [
        { t: heading, r: [35, y, 200, 24], c: [{ t: "a", a: { href: href(index) }, r: [35, y, 120, 24], s: "@someone", c: [] }] },
        { t: "p", r: [35, y + 40, 800, 100], n: 200, c: [] },
      ],
    };
  };
  const list: SavedNode = { t: "div", a: { class: "thread" }, r: [35, 100, 800, 2200], c: Array.from({ length: 10 }, (_, index) => entry(index)) };
  const root: SavedNode = { t: "html", r: [0, 0, 1366, 2400], c: [{ t: "body", r: [0, 0, 1366, 2400], c: [list] }] };
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(root, null);
  return { view: { w: 1366, h: 682, doc_h: 2400 }, root };
}

test("a short h3 link to another page names its entry, also with a fragment", () => {
  assert.equal(find_items(saved_reader(short_heading_entries("h3", (index) => `/user/${index}`))).items.length, 10);
  assert.equal(find_items(saved_reader(short_heading_entries("h3", (index) => `/user/${index}#activity`))).items.length, 10);
});

test("a short heading link to a fragment of this page or with an empty address is a section name, so its entry is no card", () => {
  assert.equal(find_items(saved_reader(short_heading_entries("h3", (index) => `#section-${index}`))).items.length, 0);
  assert.equal(find_items(saved_reader(short_heading_entries("h3", () => ""))).items.length, 0);
});

test("a short h3 link with a malformed address goes to another page and does not throw", () => {
  assert.equal(find_items(saved_reader(short_heading_entries("h3", () => "http://"))).items.length, 10);
});

test("a short h3 link that leaves the web, or sits on a page saved with no trailing slash, is no title", () => {
  assert.equal(find_items(saved_reader(short_heading_entries("h3", () => "javascript:void(0)"))).items.length, 0);
  assert.equal(find_items(saved_reader(short_heading_entries("h3", () => "mailto:a@b.test"))).items.length, 0);
  const bare = { ...short_heading_entries("h3", (index) => `https://page.test/#part-${index}`), url: "https://page.test" };
  assert.equal(find_items(saved_reader(bare)).items.length, 0);
});

test("a short h3 link to this page with a fragment, absolute or path-relative, is a section name", () => {
  assert.equal(find_items(saved_reader(short_heading_entries("h3", (index) => `https://page.test/#part-${index}`))).items.length, 0);
  assert.equal(find_items(saved_reader(short_heading_entries("h3", (index) => `/#part-${index}`))).items.length, 0);
  assert.equal(find_items(saved_reader(short_heading_entries("h3", (index) => `./#part-${index}`))).items.length, 0);
});

test("a short h2 link to another page is still a section name", () => {
  assert.equal(find_items(saved_reader(short_heading_entries("h2", (index) => `/user/${index}`))).items.length, 0);
});
