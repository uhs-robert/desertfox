import assert from "node:assert/strict";
import { test } from "node:test";
import { create_page_text, is_page_change } from "../../../src/content/caret/page_text.ts";
import type { TextModel } from "../../../src/content/caret/text_model.ts";

// A MutationObserver whose records wait until the test delivers them, as the browser's wait for a microtask checkpoint.
function fake_observer() {
  const observers: FakeObserver[] = [];
  class FakeObserver {
    targets: unknown[] = [];
    pending: MutationRecord[] = [];
    callback: MutationCallback;
    constructor(callback: MutationCallback) {
      this.callback = callback;
      observers.push(this);
    }
    observe = (target: unknown) => void this.targets.push(target);
    disconnect = () => void ((this.targets = []), (this.pending = []));
    takeRecords = () => this.pending.splice(0);
  }
  const queue = (record: MutationRecord) => observers.forEach((observer) => observer.targets.length > 0 && observer.pending.push(record));
  const deliver = () =>
    observers.forEach((observer) => {
      const records = observer.takeRecords();
      if (records.length > 0) observer.callback(records, observer as unknown as MutationObserver);
    });
  return { observer_class: FakeObserver as unknown as typeof MutationObserver, queue, deliver, watched: () => observers.flatMap((observer) => observer.targets) };
}

function fake_frame() {
  const listeners: { fire: () => void; signal: AbortSignal }[] = [];
  return {
    frame: { addEventListener: (_type: string, fire: () => void, options: { signal: AbortSignal }) => void listeners.push({ fire, signal: options.signal }) } as unknown as Element,
    load: () => listeners.filter((listener) => !listener.signal.aborted).forEach((listener) => listener.fire()),
  };
}

const own = { nodeType: 1, hasAttribute: (name: string) => name === "data-desertfox-layer" };
const page_node = { nodeType: 1, hasAttribute: () => false };
const record = (added: unknown[], removed: unknown[] = []) => ({ type: "childList", target: {}, addedNodes: added, removedNodes: removed }) as unknown as MutationRecord;
const text_change = { type: "characterData", target: {}, addedNodes: [], removedNodes: [] } as unknown as MutationRecord;

// Each model maps character `index` to the node `nodes[index - shift]`, so a rebuilt model with a longer prefix moves the same nodes further on.
function fake_page() {
  (globalThis as { document?: unknown }).document = { name: "page" };
  const observer = fake_observer();
  const nodes = Array.from({ length: 8 }, (_, index) => ({ index }));
  const page = { prefix: "", trees: [] as unknown[], empty_trees_: [] as unknown[], frames: [] as Element[], pending_hosts_: [] as unknown[], dead_nodes: false, starts: [] as (Node | undefined)[] };
  const build_model_ = (start_node?: Node): TextModel => {
    page.starts.push(start_node);
    const shift = page.prefix.length;
    const dead = () => page.dead_nodes;
    return {
      text: page.prefix + "ab ab ab",
      trees: [...page.trees],
      empty_trees_: [...page.empty_trees_],
      frames: [...page.frames],
      pending_hosts_: [...page.pending_hosts_],
      point_at_: (index: number) => {
        if (dead()) throw new Error("dead object");
        return { node: nodes[index - shift], offset: 0 };
      },
      index_of_: (node: unknown) => {
        const at = nodes.indexOf(node as { index: number });
        return at < 0 ? undefined : at + shift;
      },
    } as unknown as TextModel;
  };
  const page_text = create_page_text({ build_model_, observer_class: observer.observer_class });
  return { page, page_text, observer, builds: () => page.starts.length };
}

test("an unchanged page keeps its model, and a change delivered to the observer makes it stale", () => {
  const { page_text, observer, builds } = fake_page();
  const model = page_text.current();
  assert.equal(page_text.current(), model);
  assert.equal(page_text.is_current(model), true);
  observer.queue(text_change);
  observer.deliver();
  assert.equal(page_text.is_current(model), false);
  const rebuilt = page_text.current();
  assert.notEqual(rebuilt, model);
  assert.equal(builds(), 2);
  assert.equal(page_text.is_current(rebuilt), true);
});

// R1: a change made in the same task as the key has no record delivered yet.
test("a change whose record is not delivered yet reads as stale", () => {
  const { page_text, observer } = fake_page();
  const model = page_text.current();
  observer.queue(record([page_node]));
  assert.equal(page_text.is_current(model), false);
  assert.notEqual(page_text.current(), model);
});

// R2: the toast, the badge and the command line come and go during a session.
test("elements of DesertFox never make the page stale, delivered or not", () => {
  const { page_text, observer, builds } = fake_page();
  const model = page_text.current();
  observer.queue(record([own], [own]));
  assert.equal(page_text.is_current(model), true);
  observer.queue(record([own]));
  observer.deliver();
  assert.equal(page_text.current(), model);
  assert.equal(builds(), 1);
});

test("a record is a page change unless every node it adds or removes belongs to DesertFox", () => {
  assert.equal(is_page_change(record([own], [own])), false);
  assert.equal(is_page_change(record([own, page_node])), true);
  assert.equal(is_page_change(text_change), true);
});

// R3: a page that changes without pause.
test("many changes cost one rebuild per read, and a read with no change since costs none", () => {
  const { page_text, observer, builds } = fake_page();
  page_text.current();
  for (let tick = 0; tick < 20; tick++) observer.queue(text_change);
  observer.deliver();
  for (let tick = 0; tick < 20; tick++) observer.queue(text_change);
  const rebuilt = page_text.current();
  assert.equal(builds(), 2);
  assert.equal(page_text.current(), rebuilt);
  assert.equal(builds(), 2);
});

test("a model that is not the newest one is never current", () => {
  const { page_text } = fake_page();
  const first = page_text.current();
  const second = page_text.current({} as Node);
  assert.notEqual(second, first);
  assert.equal(page_text.is_current(first), false);
  assert.equal(page_text.is_current(second), true);
});

test("a start node always reads the page again and reaches the build", () => {
  const { page, page_text, builds } = fake_page();
  page_text.current();
  const start = { name: "picked" } as unknown as Node;
  page_text.current(start);
  assert.equal(builds(), 2);
  assert.equal(page.starts.at(-1), start);
});

test("each rebuild points the observer at the page, the new model's trees and the empty trees it met", () => {
  const { page, page_text, observer } = fake_page();
  const old_root = { name: "old root" };
  page.trees = [old_root];
  page_text.current();
  const text_root = { nodeType: 9, defaultView: {}, name: "text root" };
  const empty_root = { name: "empty root" };
  page.trees = [text_root];
  page.empty_trees_ = [empty_root];
  observer.queue(text_change);
  page_text.current();
  assert.deepEqual(observer.watched(), [(globalThis as { document?: unknown }).document, text_root, empty_root]);
});

// R4: a navigating frame fires `load` on its element and no mutation in the parent.
test("a frame that loads makes the model stale, and a rebuild drops the listeners of frames the new model lost", () => {
  const { page, page_text } = fake_page();
  const { frame, load } = fake_frame();
  page.frames = [frame];
  const model = page_text.current();
  load();
  assert.equal(page_text.is_current(model), false);
  page.frames = [];
  const rebuilt = page_text.current();
  load();
  assert.equal(page_text.is_current(rebuilt), true, "a frame the new model no longer lists still made it stale");
});

// R4: Firefox cuts a content script off from a removed frame's objects.
test("a tree that left the page makes the model stale, and carry from its dead nodes answers undefined", () => {
  const { page, page_text } = fake_page();
  const frame_document = { nodeType: 9, defaultView: {} as unknown };
  page.trees = [frame_document];
  const model = page_text.current();
  assert.equal(page_text.is_current(model), true);
  frame_document.defaultView = null;
  page.dead_nodes = true;
  assert.equal(page_text.is_current(model), false);
  page.trees = [];
  const rebuilt = page_text.current();
  assert.equal(page_text.carry(model, 0, rebuilt), undefined);
  assert.equal(page_text.point_of(model, 0), undefined);
});

test("carry finds the same node in a model with text before it, and undefined once the node left", () => {
  const { page, page_text } = fake_page();
  const model = page_text.current();
  page.prefix = "zz ";
  const rebuilt = page_text.current({} as Node);
  assert.equal(page_text.carry(model, 3, rebuilt), 6);
  assert.equal(page_text.locate(page_text.point_of(model, 3), rebuilt), 6);
  assert.equal(page_text.locate(undefined, rebuilt), undefined);
  assert.equal(page_text.carry(model, 3, { ...rebuilt, index_of_: () => undefined }), undefined);
});

// R5: attaching a shadow root fires no mutation.
test("a custom element that gains a shadow root makes the model stale", () => {
  const { page, page_text } = fake_page();
  const host: Record<string, unknown> = { shadowRoot: null };
  page.pending_hosts_ = [host];
  const model = page_text.current();
  assert.equal(page_text.is_current(model), true);
  host.shadowRoot = {};
  assert.equal(page_text.is_current(model), false);
});

test("release stops the watching, and the next read builds a new model", () => {
  const { page, page_text, observer, builds } = fake_page();
  const { frame, load } = fake_frame();
  page.frames = [frame];
  const model = page_text.current();
  page_text.release();
  assert.deepEqual(observer.watched(), []);
  assert.equal(page_text.is_current(model), false);
  load();
  const rebuilt = page_text.current();
  assert.equal(builds(), 2);
  assert.equal(page_text.is_current(rebuilt), true);
});
