// The one owner of the page text that the caret session and page search read. It holds the newest model and says whether a model still matches the page.
// A model is never changed after its build. A rebuild makes a new one, and a holder of an older model carries its positions over by DOM point.

import { build_text_model, host_gained_root, trees_alive } from "./text_model.ts";
import type { DomPoint, TextModel } from "./text_model.ts";

export type PageTextDeps = { build_model_: (start_node?: Node) => TextModel; observer_class: typeof MutationObserver };

export type PageText = {
  // The held model while it matches the page, else a new one. A start node always reads the page again, because the model finds its start as it walks.
  current(start_node?: Node): TextModel;
  is_current(model: TextModel): boolean;
  // Where a character of `from` sits in `to`. Undefined when its text left the page.
  carry(from: TextModel, index: number, to: TextModel): number | undefined;
  locate(point: DomPoint | undefined, model: TextModel): number | undefined;
  point_of(model: TextModel, index: number): DomPoint | undefined;
  // Nothing reads the page text now: the watching stops, and the next `current` reads the page again.
  release(): void;
};

// An element of DesertFox itself (the command line, the surfaces) comes and goes with a search, and its text is not in the model.
// Marked by an attribute: a style check such as `all: initial` stops holding once the element sets a longhand, as the command line does when it resizes.
const is_own_element = (node: Node) => node.nodeType === 1 && (node as Element).hasAttribute("data-desertfox-layer");

export const is_page_change = (record: MutationRecord) =>
  record.type === "characterData" || [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some((node) => !is_own_element(node));

const browser_deps = (): PageTextDeps => ({ build_model_: (start_node) => build_text_model(document.body, start_node), observer_class: MutationObserver });

export function create_page_text(deps: PageTextDeps = browser_deps()): PageText {
  let held: TextModel | undefined;
  let changed = false;
  let observer: MutationObserver | undefined;
  let frame_listening = new AbortController();
  const note_change = () => void (changed = true);

  const stop_watching = () => {
    observer?.disconnect();
    frame_listening.abort();
  };

  // One observer for the page and every tree of the model, the empty ones too: a shadow root or frame document that was empty at build time can fill later. A frame that navigates fires no mutation in its parent, so its `load` event stands in.
  const watch = (model: TextModel) => {
    stop_watching();
    observer ??= new deps.observer_class((records) => records.some(is_page_change) && note_change());
    frame_listening = new AbortController();
    for (const tree of [document, ...model.trees, ...model.empty_trees_]) observer.observe(tree, { childList: true, characterData: true, subtree: true });
    for (const frame of model.frames) frame.addEventListener("load", note_change, { signal: frame_listening.signal });
  };

  // A record waits for a microtask checkpoint, so a change made in this task has none delivered yet. Taking the records reads it now.
  const page_changed = () => changed || (changed = observer?.takeRecords().some(is_page_change) === true);

  // A frame or shadow host that left the page takes its text with it, and a host that gained a root has text the model lacks.
  const is_current = (model: TextModel) => model === held && !page_changed() && trees_alive(model) && !host_gained_root(model);

  // A node of a removed frame throws on any read.
  const locate = (point: DomPoint | undefined, model: TextModel): number | undefined => {
    try {
      return point && model.index_of_(point.node, point.offset);
    } catch {
      return undefined;
    }
  };

  const point_of = (model: TextModel, index: number): DomPoint | undefined => {
    try {
      return model.point_at_(index);
    } catch {
      return undefined;
    }
  };

  return {
    current(start_node) {
      if (start_node === undefined && held && is_current(held)) return held;
      held = deps.build_model_(start_node);
      watch(held);
      changed = false;
      return held;
    },
    is_current,
    carry: (from, index, to) => locate(point_of(from, index), to),
    locate,
    point_of,
    release() {
      stop_watching();
      held = undefined;
      changed = false;
    },
  };
}
