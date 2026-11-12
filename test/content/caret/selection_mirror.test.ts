import assert from "node:assert/strict";
import { test } from "node:test";
import { create_selection_mirror } from "../../../src/content/caret/selection_mirror.ts";
import type { TextModel } from "../../../src/content/caret/text_model.ts";

type FakeNode = { nodeType: number; ownerDocument: FakeDocument; base: number };

class FakeRange {
  startContainer!: FakeNode;
  startOffset = 0;
  endContainer!: FakeNode;
  endOffset = 0;
  setStart(node: FakeNode, offset: number) {
    [this.startContainer, this.startOffset] = [node, offset];
  }
  setEnd(node: FakeNode, offset: number) {
    [this.endContainer, this.endOffset] = [node, offset];
  }
  get collapsed() {
    return this.startContainer === this.endContainer && this.startOffset === this.endOffset;
  }
  cloneRange() {
    return Object.assign(new FakeRange(), this);
  }
}

// Forward unless `setBaseAndExtent` says otherwise. `collapse` reuses the first range in place, the worst a browser may do to a range it holds. A removed frame's selection throws on every read, as a dead object does in Firefox.
class FakeSelection {
  ranges: FakeRange[] = [];
  backward = false;
  dead = false;
  private live() {
    if (this.dead) throw new Error("can't access dead object");
    return this.ranges;
  }
  get rangeCount() {
    return this.live().length;
  }
  get isCollapsed() {
    return this.live().every((range) => range.collapsed);
  }
  get anchorNode() {
    const last = this.live().at(-1);
    return last ? (this.backward ? last.endContainer : last.startContainer) : null;
  }
  get anchorOffset() {
    const last = this.live().at(-1);
    return last ? (this.backward ? last.endOffset : last.startOffset) : 0;
  }
  get focusNode() {
    const last = this.live().at(-1);
    return last ? (this.backward ? last.startContainer : last.endContainer) : null;
  }
  get focusOffset() {
    const last = this.live().at(-1);
    return last ? (this.backward ? last.startOffset : last.endOffset) : 0;
  }
  getRangeAt(at: number) {
    return this.live()[at]!;
  }
  addRange(range: FakeRange) {
    this.live().push(range);
    this.backward = false;
  }
  removeAllRanges() {
    this.live();
    this.ranges = [];
  }
  collapse(node: FakeNode, offset: number) {
    const range = this.ranges[0] ?? new FakeRange();
    range.setStart(node, offset);
    range.setEnd(node, offset);
    this.ranges = [range];
    this.backward = false;
  }
  setBaseAndExtent(anchor: FakeNode, anchor_offset: number, focus: FakeNode, focus_offset: number) {
    const range = new FakeRange();
    this.backward = anchor === focus && focus_offset < anchor_offset;
    range.setStart(anchor, this.backward ? focus_offset : anchor_offset);
    range.setEnd(focus, this.backward ? anchor_offset : focus_offset);
    this.ranges = [range];
  }
}

type FakeDocument = { nodeType: 9; defaultView: object; selection: FakeSelection; getSelection: () => FakeSelection; createRange: () => FakeRange };

function fake_document(): FakeDocument {
  const selection = new FakeSelection();
  return { nodeType: 9, defaultView: {}, selection, getSelection: () => selection, createRange: () => new FakeRange() };
}

// The text "abcdef": "abc" in one text node of `first`, "def" in one of `second`. `second` is a shadow root of the first document, or a frame document of its own.
function fake_model(top: FakeDocument, second: "shadow_root" | FakeDocument) {
  const first_node: FakeNode = { nodeType: 3, ownerDocument: top, base: 0 };
  const second_owner = second === "shadow_root" ? top : second;
  const second_node: FakeNode = { nodeType: 3, ownerDocument: second_owner, base: 3 };
  const second_tree = second === "shadow_root" ? { nodeType: 11, host: { isConnected: true }, ownerDocument: top } : second;
  const node_at = (index: number) => (index < 3 ? first_node : second_node);
  const model = {
    text: "abcdef",
    trees: [top, second_tree],
    point_at_: (index: number) => ({ node: node_at(index), offset: index - node_at(index).base }),
    index_of_: (node: FakeNode, offset: number) => (node === first_node || node === second_node ? node.base + Math.min(offset, 2) : undefined),
    tree_runs_: (from: number, to: number) =>
      [
        { tree: top, from: Math.max(from, 0), to: Math.min(to, 3) },
        { tree: second_tree, from: Math.max(from, 3), to: Math.min(to, 6) },
      ].filter((run) => run.from < run.to),
  } as unknown as TextModel;
  return { model, first_node, second_node };
}

const ends = (selection: FakeSelection) => selection.ranges.map((range) => [range.startContainer.base + range.startOffset, range.endContainer.base + range.endOffset]);

class FakeElement {
  isContentEditable: boolean;
  holds: unknown;
  constructor(is_editable: boolean, holds: unknown) {
    this.isContentEditable = is_editable;
    this.holds = holds;
  }
  contains(node: unknown) {
    return node === this.holds;
  }
}

function setup(second: "shadow_root" | "frame" = "shadow_root", focused: () => unknown = () => null) {
  const top = fake_document();
  const frame = fake_document();
  const window_selection = new FakeSelection();
  Object.assign(globalThis, { HTMLElement: FakeElement, getSelection: () => window_selection });
  const page = fake_model(top, second === "frame" ? frame : "shadow_root");
  const mirror = create_selection_mirror({ focused_element_: () => focused() as Element | null });
  return { top, frame, window_selection, mirror, ...page };
}

test("paint draws one range per tree, and its own paint is no outside move", () => {
  const { top, model, mirror } = setup();
  mirror.paint(model, { from: 1, to: 5 });
  assert.deepEqual(ends(top.selection), [
    [1, 3],
    [3, 5],
  ]);
  assert.equal(mirror.foreign_cursor_(model, { anchor: 1, caret: 4 }, true), undefined);
  assert.equal(mirror.moved_since_(mirror.mark(model)), false);
});

// R7: line visual mode and j, k, 0, ^ and $ ask Selection.modify, which collapses the selection the paint drew, here across a shadow root.
test("measure puts back the ranges Selection.modify collapsed, so the paint and an earlier mark still stand", () => {
  const { top, model, mirror, second_node } = setup();
  mirror.paint(model, { from: 1, to: 5 });
  const mark = mirror.mark(model);
  const answer = mirror.measure(model, () => {
    top.selection.collapse(second_node, 2);
    return "line end";
  });
  assert.equal(answer, "line end");
  assert.deepEqual(ends(top.selection), [
    [1, 3],
    [3, 5],
  ]);
  assert.equal(mirror.foreign_cursor_(model, { anchor: 1, caret: 4 }, true), undefined, "the mirror took its own measure for a click");
  assert.equal(mirror.moved_since_(mark), false, "a search position would be lost to a measure");
});

test("measure puts the ranges back when the measure throws", () => {
  const { top, model, mirror, first_node } = setup();
  mirror.paint(model, { from: 0, to: 2 });
  assert.throws(() =>
    mirror.measure(model, () => {
      top.selection.collapse(first_node, 1);
      throw new Error("layout");
    }),
  );
  assert.deepEqual(ends(top.selection), [[0, 2]]);
});

test("a click after the paint moves the caret there, and visual mode keeps its anchor", () => {
  const { top, model, mirror, second_node } = setup();
  mirror.paint(model, { from: 1, to: 3 });
  top.selection.collapse(second_node, 1);
  assert.deepEqual(mirror.foreign_cursor_(model, { anchor: 1, caret: 2 }, true), { anchor: 1, caret: 4 });
  assert.deepEqual(mirror.foreign_cursor_(model, { anchor: 1, caret: 2 }, false), { anchor: 4, caret: 4 });
});

test("a drag after the paint is taken whole, and a backward one puts the caret at its start", () => {
  const { top, model, mirror, second_node } = setup();
  mirror.paint(model, { from: 0, to: 1 });
  top.selection.setBaseAndExtent(second_node, 3, second_node, 1);
  assert.deepEqual(mirror.foreign_cursor_(model, { anchor: 0, caret: 0 }, false), { anchor: 5, caret: 4 });
});

// The same span painted the other way round has the same range ends, so only the anchor and focus tell it.
test("a mark sees a selection drawn again the other way round", () => {
  const { top, model, mirror, second_node } = setup();
  top.selection.setBaseAndExtent(second_node, 0, second_node, 2);
  const mark = mirror.mark(model);
  top.selection.setBaseAndExtent(second_node, 2, second_node, 0);
  assert.equal(mirror.moved_since_(mark), true);
});

test("a mark taken in a frame that left the page counts as moved", () => {
  const { frame, model, mirror } = setup("frame");
  mirror.paint(model, { from: 4, to: 5 });
  const mark = mirror.mark(model);
  assert.equal(mirror.moved_since_(mark), false);
  frame.selection.dead = true;
  assert.equal(mirror.moved_since_(mark), true);
});

test("paint clears its last paint in a frame the new model no longer reads, and a frame that died does not stop it", () => {
  const { top, frame, model, mirror } = setup("frame");
  mirror.paint(model, { from: 2, to: 5 });
  assert.deepEqual(ends(frame.selection), [[3, 5]]);
  const top_only = fake_model(top, fake_document()).model;
  mirror.paint(top_only, { from: 0, to: 1 });
  assert.deepEqual(ends(frame.selection), [], "the old paint stayed in the frame");
  mirror.paint(model, { from: 4, to: 5 });
  frame.selection.dead = true;
  mirror.paint(top_only, { from: 1, to: 2 });
  assert.deepEqual(ends(top.selection), [[1, 2]]);
});

test("clear empties every selection of the model and of this window, and spares a focused contenteditable's caret", () => {
  let focused: unknown = null;
  const { top, frame, window_selection, model, mirror, first_node, second_node } = setup("frame", () => focused);
  mirror.paint(model, { from: 0, to: 6 });
  window_selection.collapse(second_node, 0);
  top.selection.collapse(first_node, 1);
  focused = new FakeElement(true, first_node);
  mirror.clear(model);
  assert.deepEqual(ends(frame.selection), []);
  assert.deepEqual(ends(window_selection), [], "the window's own selection stayed");
  assert.deepEqual(ends(top.selection), [[1, 1]], "the field lost its caret");
});
