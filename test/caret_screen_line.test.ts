import assert from "node:assert/strict";
import { test } from "node:test";
import { crosses_frame_or_block_host, line_target } from "../src/content/caret/screen_line.ts";
import type { TextModel, TextTree, TreeRun } from "../src/content/caret/text_model.ts";

type FakeDocument = { nodeType: 9; defaultView: { getComputedStyle: (host: unknown) => { display: string } } };

const view = { getComputedStyle: (host: unknown) => ({ display: (host as { display: string }).display }) };
const document_of = (): FakeDocument => ({ nodeType: 9, defaultView: view });
const shadow_in = (owner: FakeDocument, display: string) => ({ nodeType: 11, ownerDocument: owner, host: { display, ownerDocument: owner } });
const run_in = (tree: unknown): TreeRun => ({ tree: tree as TextTree, from: 0, to: 1 });

test("a run in one tree never needs the model's line", () => {
  const page = document_of();
  assert.equal(crosses_frame_or_block_host([run_in(page)]), false);
  assert.equal(crosses_frame_or_block_host([run_in(shadow_in(page, "block"))]), false);
});

test("an inline shadow host on the page's own document keeps Selection.modify's answer", () => {
  const page = document_of();
  assert.equal(crosses_frame_or_block_host([run_in(page), run_in(shadow_in(page, "inline")), run_in(page)]), false);
  assert.equal(crosses_frame_or_block_host([run_in(page), run_in(shadow_in(page, "inline-block"))]), false);
});

test("a block shadow host, on either side of the step, falls back to the model's line", () => {
  const page = document_of();
  assert.equal(crosses_frame_or_block_host([run_in(page), run_in(shadow_in(page, "block"))]), true);
  assert.equal(crosses_frame_or_block_host([run_in(shadow_in(page, "flex")), run_in(page)]), true);
});

test("a frame's document falls back to the model's line, and so does a shadow root in it", () => {
  const page = document_of();
  const frame = document_of();
  assert.equal(crosses_frame_or_block_host([run_in(page), run_in(frame)]), true);
  assert.equal(crosses_frame_or_block_host([run_in(shadow_in(page, "inline")), run_in(shadow_in(frame, "inline"))]), true);
});

// A model of three lines of 4 characters. Index 0..4 sit on the first row and the rest on the second.
function model_with(runs: TreeRun[]): TextModel {
  const box_of = (index: number) => ({ x: 0, y: index < 5 ? 0 : 20, left: 0, top: index < 5 ? 0 : 20, width: 5, height: 10 });
  return {
    text: "aaaa\nbbbb\ncccc",
    tree_runs: () => runs,
    point_at: (index: number) => {
      const owner = { defaultView: { frameElement: null }, createRange: () => ({ setStart() {}, setEnd() {}, getBoundingClientRect: () => box_of(index) }) };
      return { node: { nodeType: 3, length: 14, ownerDocument: owner }, offset: index };
    },
  } as unknown as TextModel;
}

test("line_target takes the model line only when the step crossed a frame or a block host", () => {
  const page = document_of();
  Object.assign(globalThis, { Node: { TEXT_NODE: 3 }, document: page, DOMRect: class { x = 0; y = 0; width = 0; height = 0; constructor(x: number, y: number, width: number, height: number) { Object.assign(this, { x, y, width, height }); } } });
  assert.equal(line_target(model_with([run_in(page)]), 2, 7, "forward"), 7);
  assert.equal(line_target(model_with([run_in(page), run_in(shadow_in(page, "inline"))]), 2, 7, "forward"), 7);
  assert.equal(line_target(model_with([run_in(page), run_in(shadow_in(page, "block"))]), 2, 7, "forward"), 5);
});
