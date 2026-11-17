// The load-more step of `]]`, tried when the next pass finds no next page. Structure first: it finds the page's main list and takes the lone control right after its last item. The words only break ties. With no control, it scrolls to the end of the list, but only when that list reaches the end of the page.

import { ancestors, descendants, in_carousel, is_item_size, normalize, signature, stacked_items } from "./detect.ts";
import type { NextPageAction, PageReader } from "./detect.ts";

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

const CHROME_TAGS = new Set(["nav", "header", "footer", "aside", "dialog"]);
const CHROME_ROLES = new Set(["navigation", "banner", "contentinfo", "menu", "menubar", "tablist", "dialog"]);
const ACTION_ROLES = new Set(["button", "link"]);
const ACTION_INPUTS = new Set(["button", "submit"]);

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
// A link list (menu, tags) is items that are only short links.
const SHORT_LINK_TEXT = 30;

export function find_load_more<N>(reader: PageReader<N>): NextPageAction<N> {
  const nodes = [reader.root_, ...descendants(reader, reader.root_)];
  const self_and_up = (node: N) => [node, ...ancestors(reader, node)];
  const role = (node: N) => reader.attr_(node, "role") ?? "";
  const is_chrome = (node: N) => CHROME_TAGS.has(reader.tag_(node)) || CHROME_ROLES.has(role(node)) || reader.attr_(node, "aria-modal") === "true";
  const in_chrome = (node: N) => self_and_up(node).some(is_chrome);
  const in_pinned = (node: N) => self_and_up(node).some(reader.pinned_);
  const is_actionable = (node: N) => {
    const tag = reader.tag_(node);
    if (tag === "a" || tag === "area") return reader.attr_(node, "href") !== null;
    if (tag === "input") return ACTION_INPUTS.has(reader.attr_(node, "type") ?? "");
    return tag === "button" || tag === "summary" || ACTION_ROLES.has(role(node));
  };
  const is_toggle = (node: N) =>
    ["aria-expanded", "aria-haspopup"].some((name) => reader.attr_(node, name) !== null) ||
    (reader.attr_(node, "aria-controls") !== null && reader.attr_(node, "aria-pressed") !== null) ||
    self_and_up(node).some((at) => /^(summary|label)$/.test(reader.tag_(at)));
  const texts_of = (node: N) => [reader.text_(node), ...["aria-label", "title", "value"].map((name) => reader.attr_(node, name) ?? "")].filter((text) => text.trim() !== "" && text.length < 200);
  const bottom = (node: N) => reader.box_(node)!.y + reader.box_(node)!.h;

  // The main list: the repeated block that covers the most area. Area per item is capped at the screen width and three screens high, so one huge item does not win alone.
  const view = reader.view_();
  let list: { box: N; items: N[]; area: number } | undefined;
  for (const box of nodes) {
    const groups = new Map<string, N[]>();
    for (const child of reader.children_(box)) {
      if (!is_item_size(reader.box_(child))) continue;
      const kind = signature(reader, child);
      groups.set(kind, [...(groups.get(kind) ?? []), child]);
    }
    for (const items of groups.values()) {
      if (!stacked_items(reader, items)) continue;
      if (in_chrome(box) || in_carousel(reader, box) || reader.scrolls_sideways_(box) || in_pinned(box)) continue;
      if (items.every((item) => is_actionable(item) && reader.text_(item).trim().length < SHORT_LINK_TEXT)) continue;
      const area = items.reduce((sum, item) => sum + Math.min(reader.box_(item)!.w, view.w) * Math.min(reader.box_(item)!.h, 3 * view.h), 0);
      if (!list || area > list.area) list = { box, items, area };
    }
  }
  if (!list) return { action: "none" };
  const { items } = list;
  const last = items.reduce((lowest, item) => (bottom(item) > bottom(lowest) ? item : lowest));
  const list_box = reader.box_(list.box) ?? reader.box_(last)!;
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
  // Many controls share one branch (a footer), so each branch is counted once.
  const counts = new Map<N, number>();
  const control_count = (node: N) => counts.get(node) ?? counts.set(node, [node, ...descendants(reader, node)].filter(is_actionable).length).get(node)!;

  const below = (node: N) => reader.box_(node)!.y - bottom(last);
  const candidates = nodes
    .filter((node) => {
      const box = reader.box_(node);
      if (!box || box.w === 0 || !is_actionable(node)) return false;
      if (box.y < bottom(last) - 4 || box.y > list_end + SEARCH_BELOW_PX) return false;
      if (box.x + box.w < list_box.x - COLUMN_SLACK_PX || box.x > list_box.x + list_box.w + COLUMN_SLACK_PX) return false;
      return !inside_item(node) && !in_chrome(node) && !is_toggle(node) && !in_carousel(reader, node) && !in_pinned(node);
    })
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
