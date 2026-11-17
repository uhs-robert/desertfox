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
const item_step = (selector: string, link: string | undefined, direction: "down" | "up" | "left" | "right" | "first" | "last" | "current"): BoundInvocation => ({ id: "page.item", args: { selector, ...(link ? { link } : {}), direction } });
// gg and G go to the first and last item. `page.item` does nothing for them on a page that shows no item, so `when_present` hands those pages the plain scroll to the top and bottom.
const end_binds = (selector: string, link: string | undefined): BindingTable => ({
  gg: { ...item_step(selector, link, "first"), when_present: selector },
  G: { ...item_step(selector, link, "last"), when_present: selector },
});
const item_binds = (selector: string, link?: string): BindingTable => ({ j: item_step(selector, link, "down"), k: item_step(selector, link, "up"), ...end_binds(selector, link) });
// A result is the block that holds a title link, so the box spans site, address, title and snippet. `.MjjYud` is a generated class, but the block is its own nesting level in every layout read, and when the class changes the selector matches nothing and j and k scroll as usual.
const GOOGLE_ITEMS = item_binds("#search div.MjjYud:has(a > h3)", "a:has(> h3)");
const DDG_ITEMS = item_binds('article[data-testid="result"]', 'a[data-testid="result-title-a"]');
const BING_ITEMS = item_binds("li.b_algo", "h2 a");
const HACKERNEWS_ITEMS = item_binds("tr.athing", ".titleline > a");
const GRID_DIRECTIONS = { h: "left", j: "down", k: "up", l: "right" } as const;
// An image grid has no row of text to read, so h and l step along a row of tiles and j and k step down and up the grid.
const grid_binds = (selector: string, link: string): BindingTable => ({ ...Object.fromEntries(Object.entries(GRID_DIRECTIONS).map(([key, direction]) => [key, item_step(selector, link, direction)])), ...end_binds(selector, link) });
// The tile is a figure, which holds the picture and its caption link.
const DDG_IMAGE_TILES = grid_binds("figure", "a[href]");
// A Google image tile is a div with a picture button (focusable) and a caption link.
const GOOGLE_IMAGE_TILES = grid_binds('div[data-attrid="images universal"]', '[role="button"]');
const WIKIPEDIA_ITEMS = item_binds("li.mw-search-result", ".mw-search-result-heading a");
const LOBSTERS_ITEMS = item_binds("ol.stories > li.story", "a.u-url");
const STARTPAGE_ITEMS = item_binds("div.result:has(a.result-title)", "a.result-title");
const ARXIV_ITEMS = item_binds("li.arxiv-result", "p.list-title > a");
const STACKOVERFLOW_ITEMS = item_binds("div.s-post-summary", "h3 a.s-link");
const TILDES_ITEMS = item_binds("article.topic", "h1.topic-title > a");
// Drive scrolls its file list in an inner panel and draws only the rows near the view, so a move through `page.item` stops at the last drawn row and gg and G stop short of the ends. Drive's own arrow keys move its selection, scroll the panel and draw more rows, so each key focuses the current file with `page.item` and then sends Drive's key to it. `current` takes the focus into the files from the view toggle or from nowhere, so the key never lands on the toggle. The pattern leaves the docs editors on docs.google.com and a file preview (drive.google.com/file/*) out.
// Drive draws both views as a role=grid. The grid view puts every file in one role=row as a role=gridcell, the list view makes each file a role=row (a table row). Only the file itself carries data-id at that level: its thumbnail parts inside carry data-id too, so the selectors name the role.
const DRIVE_GRID_ITEM = '[role="grid"] [role="gridcell"][data-id]';
const DRIVE_LIST_ITEM = '[role="grid"] [role="row"][data-id]';
const DRIVE_ANY_ITEM = `${DRIVE_GRID_ITEM}, ${DRIVE_LIST_ITEM}`;
// Each key runs only while the page shows a file of its view, so a page with no file keeps the plain scroll. The count goes to every step: `current` ignores it and the key goes out that many times.
const drive_key = (guard: string, key: string, key_code: number, until_stable = false): BoundInvocation[] => [{ ...item_step(guard, undefined, "current"), when_present: guard }, { id: "page.send_key", args: { key, key_code, ...(until_stable ? { until_stable } : {}) } }];
// A list has one file per row, so h and l keep the plain sideways scroll there, which a narrow window needs.
const DRIVE_BIND: BindingTable = {
  j: drive_key(DRIVE_ANY_ITEM, "ArrowDown", 40),
  k: drive_key(DRIVE_ANY_ITEM, "ArrowUp", 38),
  // Drive ignores a sent Home and End, so gg and G press the arrow until the selection stops at the end.
  gg: drive_key(DRIVE_ANY_ITEM, "ArrowUp", 38, true),
  G: drive_key(DRIVE_ANY_ITEM, "ArrowDown", 40, true),
  h: drive_key(DRIVE_GRID_ITEM, "ArrowLeft", 37),
  l: drive_key(DRIVE_GRID_ITEM, "ArrowRight", 39),
};

export const DEFAULT_SITE_ROWS: readonly DefaultSiteRow[] = [
  { name: "sheets", row: { site: "https://docs.google.com/spreadsheets/*", bind: SHEETS_BIND, modes: { visual: SHEETS_VISUAL }, pass: SHEETS_PASS, escape_to_page: true, editable_remove: [SHEETS_TARGET], editable_remove_unsized: true } },
  { name: "sheets", row: { site: "https://docs.google.com/a/*/spreadsheets/*", bind: SHEETS_BIND, modes: { visual: SHEETS_VISUAL }, pass: SHEETS_PASS, escape_to_page: true, editable_remove: [SHEETS_TARGET], editable_remove_unsized: true } },
  { name: "maps", row: { site: "https://www.google.com/maps*", bind: MAPS_BIND, focus_on_load: MAPS_TARGET } },
  { name: "maps", row: { site: "https://google.com/maps*", bind: MAPS_BIND, focus_on_load: MAPS_TARGET } },
  { name: "arrow", row: { site: "<all_urls>", modes: { arrow: ARROW_MODE } } },
  // The Google image rows sit before the `google` row, which matches the same address (a pattern cannot exclude udm=2). The two patterns end the udm value at an ampersand or at the end, so udm=28 stays out.
  { name: "google_images", row: { site: "https://www.google.com/search*udm=2&*", bind: GOOGLE_IMAGE_TILES } },
  { name: "google_images", row: { site: "https://www.google.com/search*udm=2", bind: GOOGLE_IMAGE_TILES } },
  // The image row sits before the `ddg` row. The first row that binds a key decides it, so on the image vertical (iax=images) this row wins over `ddg`, which matches the same address.
  { name: "ddg_images", row: { site: "https://duckduckgo.com/?*iax=images*", bind: DDG_IMAGE_TILES } },
  // DuckDuckGo's own j and k stop at the last result and never reach the More results button, so j and k walk the results through `page.item`. The ad blocks are `article[data-testid="ad"]`, so they stay out.
  // Its results and verticals all sit at `/?q=...` and a search from its home page loads that address afresh, so its settings and help pages keep j and k as scroll. The image vertical has its own row above.
  { name: "ddg", row: { site: "https://duckduckgo.com/?*", bind: DDG_ITEMS } },
  // Kagi moves its own result highlight on j and k, so the keys go to the page. h, l, v and ' stay ours.
  { name: "kagi", row: { site: "https://kagi.com/search*", pass: "j k" } },
  // Brave moves its highlight on arrow keys only, so j and k send them to the focused element.
  { name: "brave", row: { site: "https://search.brave.com/search*", bind: { j: { id: "page.send_key", args: { key: "ArrowDown", key_code: 40 } }, k: { id: "page.send_key", args: { key: "ArrowUp", key_code: 38 } } } } },
  // Google result pages on www.google.com only, as the Maps rows. The result blocks that hold a title link are the items, so People also ask and the sidebar stay out.
  { name: "google", row: { site: "https://www.google.com/search*", bind: GOOGLE_ITEMS } },
  { name: "bing", row: { site: "https://www.bing.com/search*", bind: BING_ITEMS } },
  // Hacker News has no keys of its own. A comment has no title link, so it takes the focus itself.
  { name: "hackernews", row: { site: "https://news.ycombinator.com/*", bind: HACKERNEWS_ITEMS } },
  { name: "wikipedia", row: { site: "https://*.wikipedia.org/w/index.php?*search=*", bind: WIKIPEDIA_ITEMS } },
  { name: "wikipedia", row: { site: "https://*.wikipedia.org/wiki/Special:Search*", bind: WIKIPEDIA_ITEMS } },
  // Lobsters has no keys of its own. A story page holds one story header, so the rows cover the story lists only.
  { name: "lobsters", row: { site: "https://lobste.rs/", bind: LOBSTERS_ITEMS } },
  { name: "lobsters", row: { site: "https://lobste.rs/newest*", bind: LOBSTERS_ITEMS } },
  { name: "lobsters", row: { site: "https://lobste.rs/active*", bind: LOBSTERS_ITEMS } },
  { name: "lobsters", row: { site: "https://lobste.rs/t/*", bind: LOBSTERS_ITEMS } },
  { name: "lobsters", row: { site: "https://lobste.rs/page/*", bind: LOBSTERS_ITEMS } },
  { name: "lobsters", row: { site: "https://lobste.rs/recent*", bind: LOBSTERS_ITEMS } },
  { name: "lobsters", row: { site: "https://lobste.rs/top*", bind: LOBSTERS_ITEMS } },
  { name: "lobsters", row: { site: "https://lobste.rs/domains/*", bind: LOBSTERS_ITEMS } },
  { name: "lobsters", row: { site: "https://lobste.rs/search*", bind: LOBSTERS_ITEMS } },
  { name: "archwiki", row: { site: "https://wiki.archlinux.org/index.php?*search=*", bind: WIKIPEDIA_ITEMS } },
  // Startpage's knowledge panel is also a `div.result`, so the item needs a title link.
  { name: "startpage", row: { site: "https://www.startpage.com/sp/search*", bind: STARTPAGE_ITEMS } },
  { name: "arxiv", row: { site: "https://arxiv.org/search/*", bind: ARXIV_ITEMS } },
  // A question page holds no post summary, so the pattern may cover every /questions address.
  { name: "stackoverflow", row: { site: "https://stackoverflow.com/questions*", bind: STACKOVERFLOW_ITEMS } },
  // Tildes has no keys of its own logged out. A topic page holds no `article.topic`, so j and k scroll there.
  { name: "tildes", row: { site: "https://tildes.net/*", bind: TILDES_ITEMS } },
  { name: "drive", row: { site: "https://drive.google.com/drive/*", bind: DRIVE_BIND } },
];

export const default_rows_left_on = (rows: readonly DefaultSiteRow[], off_names: readonly string[]): DefaultSiteRow[] => rows.filter(({ name }) => !off_names.includes(name));
