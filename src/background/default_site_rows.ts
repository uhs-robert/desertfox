// Site rows that ship with DesertFox. The compiler appends them after the user's rows, so a user row wins column by column, and `bind` merges key by key. A row has a name, and the `default_site_rows_off` setting turns every row of that name off. One name can cover several rows when a site has several address forms.

import type { SiteRuleRow } from "../shared/match_pattern.ts";
import type { DEFAULT_SITE_ROW_NAMES } from "../shared/table_constants.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import type { BindingTable, SiteModeTable } from "../shared/settings_table.ts";

export type DefaultSiteRow = { name: (typeof DEFAULT_SITE_ROW_NAMES)[number]; row: SiteRuleRow };

// Sheets reads the key code of a keydown and ignores the rest, so hjkl send the arrow keys to its grid editor.
const SHEETS_TARGET = "#waffle-rich-text-editor";
const arrow = (key: string, key_code: number, ctrl = false, shift = false): BoundInvocation => ({ id: "page.send_key", args: { key, key_code, target: SHEETS_TARGET, ...(ctrl ? { ctrl } : {}), ...(shift ? { shift } : {}) } });
const clipboard = (action: "cut" | "copy" | "paste"): BoundInvocation => ({ id: "page.clipboard", args: { action, target: SHEETS_TARGET } });
const VISUAL_OFF: BoundInvocation = { id: "mode.site", args: { name: "off" } };
const VISUAL_ON: BoundInvocation = { id: "mode.site", args: { name: "visual" } };
const SHEETS_BIND: BindingTable = {
  h: arrow("ArrowLeft", 37),
  j: arrow("ArrowDown", 40),
  k: arrow("ArrowUp", 38),
  l: arrow("ArrowRight", 39),
  // Ctrl+arrow jumps to the edge of the data, Ctrl+Home to A1.
  gg: arrow("Home", 36, true),
  "<C-h>": arrow("ArrowLeft", 37, true),
  "<C-j>": arrow("ArrowDown", 40, true),
  "<C-k>": arrow("ArrowUp", 38, true),
  "<C-l>": arrow("ArrowRight", 39, true),
  // A synthetic Ctrl+X or Ctrl+V does not cut or paste, so these keys run the page's clipboard action instead.
  x: clipboard("cut"),
  p: clipboard("paste"),
  // `y` copies the cell at all times, so it replaces the yank group on Sheets.
  y: clipboard("copy"),
  v: VISUAL_ON,
  V: VISUAL_ON,
  // Ctrl+End goes to the last cell of the data, and Home from there to column A of that row.
  G: [{ ...arrow("End", 35, true), label: "Bottom of column A", intent: "Go to column A of the last row with data." }, arrow("Home", 36)],
};
// VISUAL extends the selection: the same keys with Shift held, and the clipboard keys act on the range. Each clipboard key leaves the mode first, so a refused clipboard step cannot leave it stuck. Escape ends the mode through the site-mode exit policy and collapses nothing.
const SHEETS_VISUAL: SiteModeTable[string] = {
  label: "VISUAL",
  bind: {
    h: arrow("ArrowLeft", 37, false, true),
    j: arrow("ArrowDown", 40, false, true),
    k: arrow("ArrowUp", 38, false, true),
    l: arrow("ArrowRight", 39, false, true),
    gg: arrow("Home", 36, true, true),
    "<C-h>": arrow("ArrowLeft", 37, true, true),
    "<C-j>": arrow("ArrowDown", 40, true, true),
    "<C-k>": arrow("ArrowUp", 38, true, true),
    "<C-l>": arrow("ArrowRight", 39, true, true),
    G: [{ ...arrow("End", 35, true, true), label: "Extend to the last row", intent: "Extend the selection to the last row with data." }, arrow("Home", 36, false, true)],
    x: [VISUAL_OFF, clipboard("cut")],
    y: [VISUAL_OFF, clipboard("copy")],
    p: [VISUAL_OFF, clipboard("paste")],
  },
};
// Select all, Cut and Paste are Sheets' own, so url.increment must not take <C-a> and <C-x> and mode.pass_next must not take <C-v> on Sheets. A user Sheets row that sets `pass` replaces this column, so it must list all three keys to keep them. A row that sets `only` replaces it too, and there a key left out of `only` goes to the page, so it must leave `<C-a>` and `<C-x>` out. `only` always keeps `<C-v>` for the one-shot pass, so an `only` row cannot free it.
const SHEETS_PASS = "<C-a> <C-x> <C-v>";

// Sheets cancels a cell edit on Escape, so `escape_to_page` lets its own handler see the key.
// The cell editor stays focused, parked with no width, while a cell is only selected, so it counts as a field only once it has width. The id stands for the site: a rule on zero width alone would also catch the hidden field a web terminal types into.
// The second pattern is the address form of a Google Workspace domain.
// Google Maps pans on arrow keys, real or synthetic, only while its map element has focus. Maps focuses its search box as it loads, so `focus_on_load` hands the focus to the map in its place. hjkl focus the map and send arrows there, so they pan again after Escape blurs it. The guard leaves j and k to scroll the place panel when it has focus. The aria-label of the map is localized, so the selector skips it. The matcher cannot name every google.<country> host, so the rows cover google.com alone.
const MAPS_TARGET = 'div[role="application"][tabindex="0"]';
const map_arrow = (key: string, key_code: number): BoundInvocation => ({ id: "page.send_key", args: { key, key_code, target: MAPS_TARGET, focus: true }, when_focus: MAPS_TARGET });
const MAPS_BIND: BindingTable = { h: map_arrow("ArrowLeft", 37), j: map_arrow("ArrowDown", 40), k: map_arrow("ArrowUp", 38), l: map_arrow("ArrowRight", 39) };

// The arrow mode on every site, started by Alt+l (the `browser` block of the default keymap). Each key goes through `page.arrow`, which moves a native control itself because Firefox ignores a script's arrow keys there. Escape sends Escape to the page, so a script menu closes, and ends the mode.
const arrow_key = (direction: "left" | "down" | "up" | "right"): BoundInvocation => ({ id: "page.arrow", args: { direction } });
const ARROW_MODE: SiteModeTable[string] = {
  label: "ARROW",
  sticky: true,
  bind: {
    h: arrow_key("left"),
    j: arrow_key("down"),
    k: arrow_key("up"),
    l: arrow_key("right"),
    // The mode ends first, so a page that cannot take the Escape never leaves it on.
    "<Escape>": [{ id: "mode.site", args: { name: "off" } }, { id: "page.send_key", args: { key: "Escape", key_code: 27 } }],
  },
};

// Result pages that j and k walk item by item through `page.item`. Each row names the item and, where the item is not itself the link, the link inside it that takes focus, so Enter opens it. Selectors checked on live pages.
const item_binds = (selector: string, link?: string): BindingTable => ({
  j: { id: "page.item", args: { selector, ...(link ? { link } : {}), direction: "down" } },
  k: { id: "page.item", args: { selector, ...(link ? { link } : {}), direction: "up" } },
});
const GOOGLE_ITEMS = item_binds("#search a:has(> h3)");
const BING_ITEMS = item_binds("li.b_algo", "h2 a");
const HACKERNEWS_ITEMS = item_binds("tr.athing", ".titleline > a");
const WIKIPEDIA_ITEMS = item_binds("li.mw-search-result", ".mw-search-result-heading a");

export const DEFAULT_SITE_ROWS: readonly DefaultSiteRow[] = [
  { name: "sheets", row: { site: "https://docs.google.com/spreadsheets/*", bind: SHEETS_BIND, modes: { visual: SHEETS_VISUAL }, pass: SHEETS_PASS, escape_to_page: true, editable_remove: [SHEETS_TARGET], editable_remove_unsized: true } },
  { name: "sheets", row: { site: "https://docs.google.com/a/*/spreadsheets/*", bind: SHEETS_BIND, modes: { visual: SHEETS_VISUAL }, pass: SHEETS_PASS, escape_to_page: true, editable_remove: [SHEETS_TARGET], editable_remove_unsized: true } },
  { name: "maps", row: { site: "https://www.google.com/maps*", bind: MAPS_BIND, focus_on_load: MAPS_TARGET } },
  { name: "maps", row: { site: "https://google.com/maps*", bind: MAPS_BIND, focus_on_load: MAPS_TARGET } },
  { name: "arrow", row: { site: "<all_urls>", modes: { arrow: ARROW_MODE } } },
  // These engines move their own result highlight on j and k, so the keys go to the page. h, l, v and ' stay ours.
  // DuckDuckGo's results and verticals all sit at `/?q=...` and a search from its home page loads that address afresh, so its settings and help pages keep their own j and k scroll.
  { name: "ddg", row: { site: "https://duckduckgo.com/?*", pass: "j k" } },
  { name: "kagi", row: { site: "https://kagi.com/search*", pass: "j k" } },
  // Brave moves its highlight on arrow keys only, so j and k send them to the focused element.
  { name: "brave", row: { site: "https://search.brave.com/search*", bind: { j: { id: "page.send_key", args: { key: "ArrowDown", key_code: 40 } }, k: { id: "page.send_key", args: { key: "ArrowUp", key_code: 38 } } } } },
  // Google result pages on www.google.com only, as the Maps rows. The title links of the web results are the items, so People also ask and the sidebar stay out.
  { name: "google", row: { site: "https://www.google.com/search*", bind: GOOGLE_ITEMS } },
  { name: "bing", row: { site: "https://www.bing.com/search*", bind: BING_ITEMS } },
  // Hacker News has no keys of its own. A comment has no title link, so it takes the focus itself.
  { name: "hackernews", row: { site: "https://news.ycombinator.com/*", bind: HACKERNEWS_ITEMS } },
  { name: "wikipedia", row: { site: "https://*.wikipedia.org/w/index.php?*search=*", bind: WIKIPEDIA_ITEMS } },
  { name: "wikipedia", row: { site: "https://*.wikipedia.org/wiki/Special:Search*", bind: WIKIPEDIA_ITEMS } },
];

export const default_rows_left_on = (rows: readonly DefaultSiteRow[], off_names: readonly string[]): DefaultSiteRow[] => rows.filter(({ name }) => !off_names.includes(name));
