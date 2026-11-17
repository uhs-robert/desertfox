// Whether the page added content after a load click or a scroll, so `]]` can say when nothing came.

import { LAYER_ATTRIBUTE } from "../../shared/layers.ts";

// A page that loads more answers within this, or the user sees nothing happen.
export const LOAD_WAIT_MS = 3000;

// `start_` calls `on_added` for each added element of the page and returns the stop.
export type ContentWatch = { start_: (on_added: () => void) => () => void; page_height_: () => number };

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
      if (records.some((record) => Array.from(record.addedNodes).some(is_page_content))) on_added();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  },
  page_height_: () => doc.documentElement.scrollHeight,
});
