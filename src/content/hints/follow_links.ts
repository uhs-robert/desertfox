// Finds the next or previous page link for `page.follow`. A `rel` link wins over any text match.

import { collect, query_for } from "./candidates.ts";
import type { Found } from "./candidates.ts";
import { keep_present_found } from "./headings.ts";

export type FollowDirection = "next" | "prev";

// A longer text is a sentence that happens to hold the word ("Read more about the next release").
const MAX_WORDS = 4;

// A pattern this short is an arrow or a bracket. As a substring it would hit every sentence, so it must be the whole text.
const MAX_WHOLE_TEXT_PATTERN = 2;

const rel_selector = (direction: FollowDirection): string => ["link", "a", "area"].map((tag) => `${tag}[rel~="${direction}"][href]`).join(", ");

// The first `rel` link in document order, across same-origin frames and shadow roots. It needs no box, because a `<link>` in the head has none.
export const find_rel_link = (root: ParentNode, direction: FollowDirection): Found | undefined => collect(root, { selector: rel_selector(direction) })[0];

export type TextItem = { texts: readonly string[]; is_link: boolean };

const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

function matches_pattern(text: string, pattern: string): boolean {
  if (pattern.length <= MAX_WHOLE_TEXT_PATTERN) return text === pattern;
  return text.split(" ").length <= MAX_WORDS && text.includes(pattern);
}

// The index of the best item, or -1. An earlier pattern wins, then a link over a button, then the shorter text, then the earlier item.
export function pick_by_text(items: readonly TextItem[], patterns: readonly string[]): number {
  const lower_patterns = patterns.map(normalize).filter((pattern) => pattern !== "");
  let best = -1;
  let best_rank: readonly number[] | undefined;
  items.forEach((item, index) => {
    for (const text of item.texts.map(normalize)) {
      const pattern_index = lower_patterns.findIndex((pattern) => matches_pattern(text, pattern));
      if (pattern_index === -1) continue;
      const rank = [pattern_index, item.is_link ? 0 : 1, text.length];
      if (!best_rank || is_better(rank, best_rank)) {
        best = index;
        best_rank = rank;
      }
    }
  });
  return best;
}

function is_better(rank: readonly number[], than: readonly number[]): boolean {
  for (let place = 0; place < rank.length; place++) if (rank[place] !== than[place]) return rank[place]! < than[place]!;
  return false;
}

const texts_of = (element: Element): string[] => [(element as HTMLElement).innerText ?? element.textContent ?? "", element.getAttribute("aria-label") ?? "", element.getAttribute("title") ?? "", (element as HTMLInputElement).value ?? ""].filter((text) => typeof text === "string" && text !== "");

// Links and buttons that are on the page, including off-screen ones: the next link usually sits at the bottom.
export function find_text_link(root: ParentNode, patterns: readonly string[]): Found | undefined {
  const links = keep_present_found(collect(root, query_for("links", undefined)));
  const buttons = keep_present_found(collect(root, query_for("buttons", undefined)));
  const items = [...links, ...buttons];
  const index = pick_by_text(items.map((item, place) => ({ texts: texts_of(item.element), is_link: place < links.length })), patterns);
  return items[index];
}

export const find_follow_link = (root: ParentNode, direction: FollowDirection, patterns: readonly string[]): Found | undefined => find_rel_link(root, direction) ?? find_text_link(root, patterns);
