// The load-more step of `]]`, tried when the next pass finds no next page. Structure first: it finds the page's main list and takes the lone control right after its last item. The words only break ties. With no control, it scrolls to the end of the list, but only when that list reaches the end of the page.

import { in_chrome as node_in_chrome, in_pinned as node_in_pinned, is_actionable as node_is_actionable, list_groups, main_list } from "../lib/groups.ts";
import { ancestors, descendants, in_carousel, is_item_size, normalize } from "../lib/page_reader.ts";
import type { NextPageAction } from "./detect.ts";
import type { PageReader } from "../lib/page_reader.ts";

const LOAD_WORDS = new Set([
  "more", "load more", "show more", "see more", "view more", "more results", "more stories", "more posts", "more articles", "more news", "more items", "more products", "older posts", "older entries", "older", "show older", "load older",
  "mehr", "mehr laden", "mehr anzeigen", "weitere laden", "weitere anzeigen", "weitere artikel", "mehr artikel", "mehr ergebnisse", "ältere artikel",
  "plus", "voir plus", "afficher plus", "charger plus", "plus d'articles", "plus de résultats", "voir plus d'articles", "charger plus d'articles",
  "más", "ver más", "cargar más", "mostrar más", "más noticias", "más resultados", "ver más noticias",
  "mais", "ver mais", "carregar mais", "mostrar mais", "veja mais", "mais notícias", "carregar mais notícias",
  "もっと見る", "さらに表示", "もっと読む", "続きを見る", "さらに読み込む", "もっと読み込む",
  "ещё", "еще", "показать ещё", "показать еще", "загрузить ещё", "загрузить еще", "больше",
  "mostra altro", "carica altri", "altri articoli", "meer laden", "toon meer", "więcej", "pokaż więcej", "daha fazla",
]);

// Counts and punctuation drop out, so "Еще 20 материалов" reads as "еще материалов". A typographic apostrophe becomes a plain one, as the words use ("Voir plus d’articles").
const strip_counts = (text: string): string => text.replace(/’/g, "'").replace(/[^\p{L}\p{M}' ]+/gu, " ").replace(/\s+/g, " ").trim();

// The whole text is a load word, or a load word and one noun ("load more stories", "mostrar mais conteúdos").
export function is_load_text(text: string): boolean {
  const stripped = strip_counts(normalize(text));
  const words = stripped.split(" ");
  return LOAD_WORDS.has(stripped) || (words.length >= 2 && words.length <= 4 && LOAD_WORDS.has(words.slice(0, -1).join(" ")));
}


// One step past a control, the search looks this far below the list's box, so a module between the last item and the box end does not hide the control.
const SEARCH_BELOW_PX = 700;
// A control may stand this far to either side of the list's column.
const COLUMN_SLACK_PX = 50;
// A plain button with no load word counts only this close below the last item.
const PLAIN_BUTTON_REACH_PX = 300;
// More controls than this in the control's own branch make it part of a module or a footer, not a lone load control.
const MAX_BRANCH_CONTROLS = 3;
// The list reaches the end of the page when less than this many screens of page follow it. The infinite lists of the corpus end 0 to 200 px from the page end, the article and front pages 500 px or more.
const END_OF_PAGE_SCREENS = 0.5;

export function find_load_more<N>(reader: PageReader<N>): NextPageAction<N> {
  const nodes = [reader.root_, ...descendants(reader, reader.root_)];
  const self_and_up = (node: N) => [node, ...ancestors(reader, node)];
  const role = (node: N) => reader.attr_(node, "role") ?? "";
  const in_chrome = (node: N) => node_in_chrome(reader, node);
  const in_pinned = (node: N) => node_in_pinned(reader, node);
  const is_actionable = (node: N) => node_is_actionable(reader, node);
  const is_toggle = (node: N) =>
    ["aria-expanded", "aria-haspopup"].some((name) => reader.attr_(node, name) !== null) ||
    (reader.attr_(node, "aria-controls") !== null && reader.attr_(node, "aria-pressed") !== null) ||
    self_and_up(node).some((at) => /^(summary|label)$/.test(reader.tag_(at)));
  const texts_of = (node: N) => [reader.text_(node), ...["aria-label", "title", "value"].map((name) => reader.attr_(node, name) ?? "")].filter((text) => text.trim() !== "" && text.length < 200);
  const bottom = (node: N) => reader.box_(node)!.y + reader.box_(node)!.h;

  // The main list: the repeated block that covers the most area.
  const view = reader.view_();
  const list = main_list(reader, list_groups(reader, nodes, { box_of: (child) => reader.box_(child), is_item: (_child, box) => is_item_size(box), stop: () => false }));
  if (!list) return { action: "none" };
  const { items } = list;
  const last = items.reduce((lowest, item) => (bottom(item) > bottom(lowest) ? item : lowest));
  const list_box = reader.box_(list.parent) ?? reader.box_(last)!;
  const list_end = Math.max(bottom(last), list_box.y + list_box.h);
  const inside_item = (node: N) => self_and_up(node).some((at) => items.includes(at));

  // The branch that holds the control, from just below where it meets the list.
  const holds_last = new Set(self_and_up(last));
  const branch_of = (node: N) => {
    let branch = node;
    for (const at of ancestors(reader, node)) {
      if (holds_last.has(at)) break;
      branch = at;
    }
    return branch;
  };

  const below = (node: N) => reader.box_(node)!.y - bottom(last);
  const in_reach = (node: N) => {
    const box = reader.box_(node);
    if (!box || box.w === 0) return false;
    if (box.y < bottom(last) - 4 || box.y > list_end + SEARCH_BELOW_PX) return false;
    return box.x + box.w >= list_box.x - COLUMN_SLACK_PX && box.x <= list_box.x + list_box.w + COLUMN_SLACK_PX;
  };
  // A div or span that a script makes clickable has no role. Only its own pointer cursor and a load word mark it, and it never stands alone as a plain button.
  const is_weak_load = (node: N) => in_reach(node) && reader.attr_(node, "aria-disabled") !== "true" && reader.pointer_?.(node) && texts_of(node).some(is_load_text) && !descendants(reader, node).some(is_actionable);
  // Tried after `is_actionable`, so it never sees a link or a button.
  const is_control = (node: N) => is_actionable(node) || is_weak_load(node);
  // Many controls share one branch (a footer), so each branch is counted once.
  const counts = new Map<N, number>();
  const control_count = (node: N) => counts.get(node) ?? counts.set(node, [node, ...descendants(reader, node)].filter(is_control).length).get(node)!;

  const candidates = nodes
    .filter((node) => is_control(node) && in_reach(node) && !inside_item(node) && !in_chrome(node) && !is_toggle(node) && !in_carousel(reader, node) && !in_pinned(node))
    .filter((node) => control_count(branch_of(node)) <= MAX_BRANCH_CONTROLS)
    .sort((a, b) => below(a) - below(b));

  const worded = candidates.find((node) => texts_of(node).some(is_load_text));
  if (worded !== undefined) return { action: "click", target: worded };
  // A plain link after a list is usually 'view all' or the footer, so only a button counts without a load word.
  const button = candidates.find((node) => reader.tag_(node) === "button" || role(node) === "button");
  if (button !== undefined && below(button) < PLAIN_BUTTON_REACH_PX) return { action: "click", target: button };
  // An article or a front page also has a largest block. Scrolling there loads nothing and only jumps the view, so the list must reach the end of the page, with room for a footer or a spinner.
  return view.page_h - list_end <= view.h * END_OF_PAGE_SCREENS ? { action: "scroll", target: last } : { action: "none" };
}
