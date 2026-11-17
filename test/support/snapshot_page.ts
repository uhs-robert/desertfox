// Reads a saved page of test/fixtures/next_page/ as a `PageReader`, and picks its controls the way the live page does: rel links, then links and buttons that have a box.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Box, Control, NextPageInput, PageReader } from "../../src/content/next_page/detect.ts";

// One saved element: tag, kept attributes, box [x, y, w, h], hidden, sideways scroller, fixed or sticky, pointer cursor starts here, text (controls and pointer nodes), children. Shadow roots are folded into their host's children.
export type SavedNode = { t: string; a?: Record<string, string>; r?: [number, number, number, number]; h?: 1; x?: 1; p?: 1; k?: 1; s?: string; c?: SavedNode[]; up?: SavedNode | null };

export type SavedPage = { view: { w: number; h: number; doc_h: number }; root: SavedNode };

export const FIXTURES = new URL("../fixtures/next_page/", import.meta.url);

export function read_saved_page(name: string): SavedPage {
  const page = JSON.parse(gunzipSync(readFileSync(new URL(`${name}.json.gz`, FIXTURES))).toString("utf8")) as SavedPage;
  const link_up = (node: SavedNode, up: SavedNode | null) => {
    node.up = up;
    for (const child of node.c ?? []) link_up(child, node);
  };
  link_up(page.root, null);
  return page;
}

export function saved_reader(page: SavedPage): PageReader<SavedNode> {
  const boxes = new Map<SavedNode, Box | undefined>();
  return {
    root_: page.root,
    parent_: (node) => node.up ?? null,
    children_: (node) => node.c ?? [],
    tag_: (node) => node.t,
    attr_: (node, name) => node.a?.[name] ?? null,
    text_: (node) => node.s ?? "",
    box_: (node) => {
      if (!boxes.has(node)) boxes.set(node, node.r && !node.h ? { x: node.r[0], y: node.r[1], w: node.r[2], h: node.r[3] } : undefined);
      return boxes.get(node);
    },
    scrolls_sideways_: (node) => node.x === 1,
    pinned_: (node) => node.p === 1,
    pointer_: (node) => node.k === 1,
    view_: () => ({ w: page.view.w, h: page.view.h, page_h: page.view.doc_h }),
  };
}

function* walk(node: SavedNode): Generator<SavedNode> {
  yield node;
  for (const child of node.c ?? []) yield* walk(child);
}

const BUTTON_INPUTS = new Set(["button", "submit", "reset", "image"]);

// The same picks as `find_rel_link` and `find_text_link`: an `href` link marked rel, then present links and enabled buttons. The text list mirrors `texts_of`.
export function saved_input(page: SavedPage, patterns: readonly string[], direction: "next" | "prev" = "next"): NextPageInput<SavedNode> {
  const nodes = [...walk(page.root)];
  const attr = (node: SavedNode, name: string) => node.a?.[name];
  const rel_links = nodes.filter((node) => ["link", "a", "area"].includes(node.t) && attr(node, "href") !== undefined && (attr(node, "rel") ?? "").split(/\s+/).includes(direction));
  const present = (node: SavedNode) => node.r !== undefined && !node.h;
  const is_link = (node: SavedNode) => node.t === "a" && attr(node, "href") !== undefined;
  const is_button = (node: SavedNode) =>
    attr(node, "disabled") === undefined && (node.t === "button" || attr(node, "role") === "button" || (node.t === "input" && BUTTON_INPUTS.has(attr(node, "type") ?? "")));
  const texts = (node: SavedNode) => [node.s ?? "", attr(node, "aria-label") ?? "", attr(node, "title") ?? "", node.t === "input" ? (attr(node, "value") ?? "") : ""].filter((text) => text.trim() !== "");
  const control = (link: boolean) => (node: SavedNode): Control<SavedNode> => ({ node, texts: texts(node), is_link: link });
  const links = nodes.filter((node) => present(node) && is_link(node)).map(control(true));
  const buttons = nodes.filter((node) => present(node) && !is_link(node) && is_button(node)).map(control(false));
  return { rel_links, controls: [...links, ...buttons], patterns };
}
