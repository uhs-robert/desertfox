// Whether the page added content after a load click or a scroll, so `]]` can say when nothing came.

import { LAYER_ATTRIBUTE } from "../../shared/layers.ts";

// A page that loads more answers within this, or the user sees nothing happen.
export const LOAD_WAIT_MS = 3000;

// `start_` calls `on_added` with the elements of the page that each batch of changes added, and returns the stop.
export type ContentWatch = { start_: (on_added: (added: readonly Element[]) => void) => () => void; page_height_: () => number };

export function wait_for_new_content(watch: ContentWatch, within_ms = LOAD_WAIT_MS): Promise<boolean> {
  const height_before = watch.page_height_();
  return new Promise((resolve) => {
    let settled = false;
    let stop = () => {};
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      stop();
      clearTimeout(timer);
      resolve(loaded);
    };
    const timer = setTimeout(() => finish(watch.page_height_() > height_before), within_ms);
    stop = watch.start_(() => finish(true));
    if (settled) stop();
  });
}

// Tags a page adds for its own bookkeeping (analytics, styles), which show no content.
const NOT_CONTENT = new Set(["script", "style", "link", "meta", "noscript", "template"]);

const is_page_content = (node: Node): boolean => node.nodeType === Node.ELEMENT_NODE && !NOT_CONTENT.has((node as Element).localName) && !(node as Element).hasAttribute(LAYER_ATTRIBUTE);

// Our own toast and badge carry the layer attribute, so they do not count as the page's content.
export const dom_content_watch = (doc: Document): ContentWatch => ({
  start_: (on_added) => {
    const observer = new MutationObserver((records) => {
      const added = records.flatMap((record) => Array.from(record.addedNodes).filter(is_page_content)) as Element[];
      if (added.length > 0) on_added(added);
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  },
  page_height_: () => doc.documentElement.scrollHeight,
});

// One load at a time in a document: a `]]` while a load is pending would click the busy control again or scroll past the items still on their way.
// `act_` clicks or scrolls. `nothing_loaded_` runs when the wait ends with nothing added, but not when the page went away first: a page that the cache brings back on Back resumes its timer, and its toast would be stale.
export type LoadStepDeps = { watch_: ContentWatch; page_: EventTarget; act_: () => void; nothing_loaded_: () => void };

export function create_load_step() {
  let pending = false;
  // Answers false, and does nothing, while a load is pending.
  return (deps: LoadStepDeps): boolean => {
    if (pending) return false;
    pending = true;
    const loaded = wait_for_new_content(deps.watch_);
    const left = new Promise<undefined>((resolve) => deps.page_.addEventListener("pagehide", () => resolve(undefined), { once: true }));
    deps.act_();
    void Promise.race([loaded, left]).then((arrived) => {
      pending = false;
      if (arrived === false) deps.nothing_loaded_();
    });
    return true;
  };
}
