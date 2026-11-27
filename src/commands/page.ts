import { get_config } from "../background/config_main.ts";
import { NEW_TAB_PAGE_FILE } from "../shared/config.ts";
import { define } from "../shared/registry/builtin.ts";
import { open_in, require_tab_id, typed_url_target, WHERE_PARAM } from "./open_target.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { SEND_KEY_MAX_TIMES } from "../shared/send_key_limit.ts";
import { home_page_url, own_pages } from "../shared/url_build.ts";
import { browser_reload_clear_deps, make_reload_clear } from "./reload_clear.ts";

const reload_clear = make_reload_clear(browser_reload_clear_deps);

define("page.back", {
  label: "Back",
  intent: "Go back one page in the tab history. A count prefix goes back that many pages.",
  bridge: false,
  runs_in: "background",
  count: "repeat",
  modes: ["normal", "item"],
  run: async (ctx) => browser.tabs.goBack(require_tab_id(ctx)),
});

define("page.forward", {
  label: "Forward",
  intent: "Go forward one page in the tab history. A count prefix goes forward that many pages.",
  bridge: false,
  runs_in: "background",
  count: "repeat",
  modes: ["normal", "item"],
  run: async (ctx) => browser.tabs.goForward(require_tab_id(ctx)),
});

define("page.reload", {
  label: "Reload",
  intent: "Reload the page. With hard on, skip the cache. With clear set to site, first clear the cookies of this page's host in its container, plus the cookies a parent domain sets for it, the page's own storage and service workers, and the whole cache. With clear set to all, first clear them for every site and container.",
  params: [
    { name: "hard", type: "bool", default: false, description: "Skip the cache." },
    {
      name: "clear",
      type: "enum",
      values: ["site", "all"],
      optional: true,
      value_labels: { site: "after clearing this site", all: "after clearing every site" },
      description: { site: "Clear this host first.", all: "Clear every site and container first." },
    },
  ],
  bridge: false,
  runs_in: "background",
  // `page.reload --all` logs you out everywhere, so `.` and a macro never replay it.
  repeatable: (args) => args.clear !== "all",
  run: async (ctx, args) => {
    const tab_id = require_tab_id(ctx);
    if (args.clear === "site" || args.clear === "all") return reload_clear.run(tab_id, args.clear);
    return browser.tabs.reload(tab_id, { bypassCache: args.hard === true });
  },
});

// Firefox gives tabs.print no tab id and no result: it opens the print window on the active tab, which a key press always targets. `.` skips it, but a macro records and replays it like any command.
define("page.print", {
  label: "Print",
  intent: "Open the Firefox print window for the active tab.",
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: async () => {
    browser.tabs.print();
  },
});

define("page.save_pdf", {
  label: "Save as PDF",
  intent: "Ask for a file name and save the active tab as a PDF. Cancelling the file picker does nothing.",
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: async () => {
    const status = await browser.tabs.saveAsPDF({});
    if (status === "not_saved" || status === "not_replaced") throw new RuntimeRefusal("Could not save the page as PDF");
  },
});

// `isArticle` is Firefox's own verdict, the one that lights its address bar icon, so a page it cannot show fails here with a message and not a silent no-op. A tab already in Reader View is not an article, and the same call takes it back to the page.
const READER_REFUSAL = "Firefox cannot show this page in Reader View";

define("page.reader", {
  label: "Reader View",
  intent: "Toggle Reader View on the page.",
  bridge: false,
  runs_in: "background",
  run: async (ctx) => {
    const tab_id = require_tab_id(ctx);
    const tab = await browser.tabs.get(tab_id);
    if (tab.isArticle !== true && tab.isInReaderMode !== true) throw new RuntimeRefusal(READER_REFUSAL);
    await browser.tabs.toggleReaderMode(tab_id).catch(() => {
      throw new RuntimeRefusal(READER_REFUSAL);
    });
  },
});

// Firefox has no stop call for the tabs API, so the page itself stops.
define("page.stop", {
  label: "Stop loading",
  intent: "Stop the page from loading.",
  bridge: false,
  runs_in: "content",
});

define("page.home", {
  label: "Home page",
  intent: "Open the home page from the settings.",
  params: [WHERE_PARAM],
  bridge: false,
  runs_in: "background",
  run: async (ctx, args) => {
    const home_url = home_page_url((await get_config()).settings.home_page, () => browser.runtime.getURL(NEW_TAB_PAGE_FILE));
    await open_in(ctx, await typed_url_target(home_url, own_pages), args.where);
  },
});

// The search sits in the next_page bundle, which loads on the first run. It reads the top page and same-origin frames only: a frame of another site has its own script and the top page cannot see its links.
define("page.follow", {
  label: "Follow page link",
  intent: "Go to the next or previous page of a series. It takes a link marked rel next or prev first, then the link or button whose text best matches the next_patterns or prev_patterns setting: an earlier pattern wins, then a link over a button, then the shorter text. With no next page, the next page in place clicks a load more control after the main list of the page, or scrolls an endless list to its end, and says so when nothing loaded.",
  params: [{ name: "direction", type: "enum", values: ["next", "prev"], value_labels: { next: "to next page", prev: "to previous page" }, description: { next: "Follow the link to the next page.", prev: "Follow the link to the previous page." } }, WHERE_PARAM],
  bridge: false,
  runs_in: "content",
  bundle: "next_page",
  jumps: (args) => args.where === "here",
  modes: ["normal", "item"],
});

// Both keys start from the focused control, else the last one Escape left, else the top of the view. It stops at the ends and does not wrap.
define("page.focus_field", {
  label: "Focus form control",
  intent: "Focus the next or previous form control. It visits text fields, selects, checkboxes, radios and buttons in page order. A count prefix moves that many controls. It stops with a notice past the last or before the first control.",
  params: [
    { name: "direction", type: "enum", values: ["next", "prev"], value_labels: { next: "to next control", prev: "to previous control" }, description: { next: "Focus the next form control.", prev: "Focus the previous form control." } },
    { name: "steps", type: "int", default: 1, min: 1, description: "Move this many controls." },
  ],
  bridge: false,
  runs_in: "content",
  count: { param: "steps" },
  bundle: "hints",
});

// Both keys start where `page.focus_field` does. Focus only: Enter on the focused link follows it.
define("page.focus_link", {
  label: "Focus link",
  intent: "Focus the next or previous link without following it. It visits links with an address in page order. A count prefix moves that many links. It stops with a notice past the last or before the first link.",
  params: [
    { name: "direction", type: "enum", values: ["next", "prev"], value_labels: { next: "to next link", prev: "to previous link" }, description: { next: "Focus the next link.", prev: "Focus the previous link." } },
    { name: "steps", type: "int", default: 1, min: 1, description: "Move this many links." },
  ],
  bridge: false,
  runs_in: "content",
  count: { param: "steps" },
  bundle: "hints",
});

// Both keys start from the last heading they jumped to while it is on screen, else from the top of the view. They stop at the ends and do not wrap.
define("page.heading", {
  label: "Go to heading",
  intent: "Scroll a heading to the top of the view. It goes to the next, previous, first or last one. It counts h1 to h6 and role=heading, in page order, from the last heading it jumped to while that is on screen, else from the top of the view. A count prefix moves that many headings. It stops with a notice past the last or before the first heading. First and last take no count and go to the ends of the page. Next section and previous section also count paragraphs (p, pre and blockquote with at least 40 characters of text, a blockquote once), and skip navigation, header banner, footer, aside, form and dialog content. They stop with the notice No next section or No previous section at the ends, and No sections on a page with none.",
  params: [
    { name: "direction", type: "enum", values: ["next", "prev", "first", "last", "next_block", "prev_block"], value_labels: { next: "to next heading", prev: "to previous heading", first: "to first heading", last: "to last heading", next_block: "to next section", prev_block: "to previous section" }, description: { next_block: "Scroll the next paragraph or heading to the top.", prev_block: "Scroll the previous paragraph or heading to the top.", next: "Scroll the next heading to the top.", prev: "Scroll the previous heading to the top.", first: "Scroll the first heading of the page to the top.", last: "Scroll the last heading of the page to the top." } },
    { name: "steps", type: "int", default: 1, min: 1, description: "Move this many stops, which first and last ignore." },
  ],
  bridge: false,
  runs_in: "content",
  count: { param: "steps" },
  bundle: "hints",
  jumps: true,
});

// Meant for site rows: a row binds a key to this command to turn it into a key the site's own script reads. The default `<A-Escape>` insert binding also uses it, to send Escape to the page on any site.
define("page.send_key", {
  label: "Send key to page",
  intent: "Send a key press to the page. It sends a keydown and a keyup with the given key and key code, and the modifiers that are on. With keypress on, it sends a keypress between them, for a page that reads typed characters. The target is the element the CSS selector finds, or the focused element when there is no selector. It refuses when the selector matches nothing. With focus on, it focuses the target first, for a page that reads keys only while its element has focus. A count prefix sends the key that many times, in order.",
  params: [
    { name: "key", type: "string", description: "Send this key name, for example ArrowDown." },
    { name: "key_code", type: "int", min: 0, description: "Send this legacy key code, such as 40." },
    { name: "target", type: "string", optional: true, description: "Send to the element this CSS selector finds." },
    { name: "times", type: "int", default: 1, min: 1, max: SEND_KEY_MAX_TIMES, description: "Send the key this many times." },
    { name: "ctrl", type: "bool", default: false, description: "Hold Ctrl for the key." },
    { name: "shift", type: "bool", default: false, description: "Hold Shift for the key." },
    { name: "alt", type: "bool", default: false, description: "Hold Alt for the key." },
    { name: "meta", type: "bool", default: false, description: "Hold Meta (Super, or Command on macOS) for the key." },
    { name: "keypress", type: "bool", default: false, description: "Also send a keypress between the keydown and the keyup." },
    { name: "focus", type: "bool", default: false, description: "Focus the target element before sending the key." },
  ],
  bridge: false,
  runs_in: "content",
  modes: ["normal", "insert", "item"],
  // The handler sends the repeats itself, so a quick second key cannot land between them.
  count: { param: "times" },
  bundle: "site_actions",
});

// Meant for site rows: a row binds a key to this command for a control that a site's script opens only on a click, not on Enter. It lives in the hints bundle, which already holds the hint click. The site_actions bundle has no room for it.
define("page.click", {
  label: "Click on page",
  intent: "Click the first shown element a CSS selector finds. It sends the pointer and mouse events of a hint click, so a control that opens only on a click opens. It refuses when nothing shown matches.",
  params: [{ name: "selector", type: "string", main: true, rest: true, verbatim: true, description: "Click the first shown element this CSS selector finds." }],
  bridge: false,
  runs_in: "content",
  modes: ["normal"],
  bundle: "hints",
});

// Meant for the arrow mode, which binds h, j, k and l to it. Firefox ignores a script's arrow keys on its own controls, so the handler moves each native control through the DOM and sends a keydown to the rest.
define("page.arrow", {
  label: "Arrow on the focused control",
  intent: "Press an arrow on the focused control. A select, range or radio changes its value and fires input and change. With nothing focused, the page scrolls as the normal keys do. On any other element, it sends an ArrowLeft, ArrowDown, ArrowUp or ArrowRight keydown and keyup, which only a page script reads. A count prefix repeats it.",
  params: [
    { name: "direction", type: "enum", values: ["left", "down", "up", "right"], value_labels: { left: "left", down: "down", up: "up", right: "right" }, description: { left: "Press the left arrow.", down: "Press the down arrow.", up: "Press the up arrow.", right: "Press the right arrow." } },
    { name: "times", type: "int", default: 1, min: 1, max: SEND_KEY_MAX_TIMES, description: "Press this many times." },
  ],
  bridge: false,
  runs_in: "content",
  count: { param: "times" },
  bundle: "site_actions",
});

// Bound to j, k, h, l, gg and G in item mode, and by site rows on result lists, which name the item selector in their `keymap.item` column. Enter on the focused link then opens it, as the browser does.
define("page.item", {
  label: "Move through items",
  intent: "Focus the next item that a CSS selector names. With no selector, it reads the page for a list or a grid of items (the item navigator) and moves through that, and when it is not sure there is one, or when this bundle cannot load, down and up scroll like the plain keys, and first and last scroll to the top and bottom as the plain keys do. It draws a box around the item, which is a search result on a results page. With extent, a selector run from the item's parent, the box and the long-item rule cover the item down to the bottom of the element it finds, as a comment's text under its author line; focus, landing and the link stay on the item. Down and up go to the nearest item below or above, left and right to the nearest on the same row, so one bind set serves a list and a grid. It starts from the item that holds the focus, else the last item it moved to while that is on screen, else the first item in view. A count prefix moves that many items. Down and up scroll 50 px per count instead while the item runs past the view edge and at the last item, and with no item on the page they scroll as the plain keys do. Left and right show a notice at the last item. First and last scroll the list to its top or bottom and go to the first and last item, whatever has focus. While the page draws or loads more items they follow the end, until it stays the same for a second or you press a key. They ignore a count, record the place they leave in the jump list, and do nothing on a page with no item, except with no selector, where they scroll to the top or bottom. With no selector they also focus the end item only when it is in view after the scroll. Next section goes to the first item of the next section and previous section to the start of the current one, then of the one before it, where the sections are those the item navigator found (a front page) or a section selector names, and a count jumps that many. They show a notice when there are none or none further. Current focuses the item a move would start from and goes nowhere, and does nothing on a page with no item. Escape clears the box. Other end swaps the ends of the selection in visual item mode. Extend moves the cursor of that selection, and current with extend starts one. With hover on, the item under the box also gets the pointer events of a mouse resting on it, about 300 ms after the last move, and loses them when the box moves or clears.",
  params: [
    { name: "selector", type: "string", main: true, rest: true, verbatim: true, optional: true, description: "Move through the elements this CSS selector finds." },
    { name: "link", type: "string", optional: true, description: "Focus the element this CSS selector finds in the item." },
    { name: "direction", type: "enum", values: ["down", "up", "left", "right", "next_section", "prev_section", "first", "last", "current", "other_end"], value_labels: { other_end: "to the other end of the selection", down: "to item below", up: "to item above", left: "to item on the left", right: "to item on the right", next_section: "to the next section", prev_section: "to the previous section", first: "to first item", last: "to last item", current: "to the current item" }, description: { down: "Go to the nearest item below.", up: "Go to the nearest item above.", left: "Go to the nearest item on the left.", right: "Go to the nearest item on the right.", next_section: "Go to the first item of the next section.", prev_section: "Go to the start of this section, then of the one before.", first: "Go to the first item on the page.", last: "Go to the last item on the page.", current: "Focus the item a move starts from, and go nowhere.", other_end: "Swap the ends of the selection." } },
    { name: "section", type: "string", default: "", when: { direction: ["next_section", "prev_section"] }, description: "Take the sections from the elements this CSS selector finds." },
    { name: "extent", type: "string", default: "", description: "Extend the box down to what this selector finds." },
    { name: "times", type: "int", default: 1, min: 1, description: "Move this many items." },
    { name: "hover", type: "bool", default: false, description: "Hover the item, which starts a video preview." },
    { name: "extend", type: "bool", default: false, description: "Move the cursor of the selection in visual item mode." },
  ],
  bridge: false,
  runs_in: "content",
  count: { param: "times" },
  // The ends replace gg and G on the result rows, which record the place they leave, so `<C-o>` and `''` come back.
  jumps: (args) => args.direction === "first" || args.direction === "last",
  bundle: "item",
  modes: ["normal", "item", "item_visual"],
});

// The actions on the current item of item mode. The handler asks the item bundle which item that is.
define("page.item_action", {
  name: "item_action",
  label: "Act on the current item",
  intent: "Toggle or open the current item of item mode. Open clicks the element that has the focus inside the item, else the item's link. Toggle clicks the first native checkbox or element with role checkbox that shows in the item, or the element a CSS selector finds when a site row names one. Both send the pointer and mouse events of a hint click. Toggle range, in visual item mode, sets every checkbox of the range to the opposite of the anchor item's, skips the items with none, and says how many it changed. Open range, in visual item mode, opens the first item of the range in this tab and the others in background tabs, then ends the selection. Open background does the same with every item in background tabs, and with the current item outside visual item mode. They open the first link of an item, skip the items with none, and refuse when no item has one. The others refuse when there is no current item, no checkbox or no link.",
  params: [
    { name: "action", type: "enum", values: ["toggle", "toggle_range", "open", "open_range", "open_background"], value_labels: { toggle: "to toggle the checkbox", toggle_range: "to set the checkboxes of the range", open: "to open the link", open_range: "to open the range", open_background: "to open in background tabs" }, description: { toggle: "Toggle the checkbox of the current item.", toggle_range: "Set the range to the opposite of the anchor box.", open: "Open the link of the current item.", open_range: "Open the first here, the rest in background tabs.", open_background: "Open the range or the item in background tabs." } },
    { name: "target", type: "string", default: "", when: { action: ["toggle"] }, description: "Click what this selector finds in the item instead." },
  ],
  bridge: false,
  runs_in: "content",
  bundle: "item_act",
  modes: ["item", "item_visual"],
});

// Tab and Shift-Tab of item mode. Focus stays in the item and wraps at its edges. An item whose only focusable element is its link steps on through the page's focusables, as the browser's Tab does.
define("page.item_focus", {
  name: "item_focus",
  label: "Move the focus inside the current item",
  intent: "Focus the next or previous control in the current item. The controls are the links, buttons, fields and checkboxes that show, and the focus wraps at the item's edges. An item with a single focusable element steps on through the page's focusables instead. It refuses when the item has no focusable element. Enter then clicks the focused element.",
  params: [{ name: "direction", type: "enum", values: ["next", "prev"], value_labels: { next: "to the next element", prev: "to the previous element" }, description: { next: "Focus the next element.", prev: "Focus the previous element." } }],
  bridge: false,
  runs_in: "content",
  bundle: "item_act",
  modes: ["item"],
});

// Bound by site rows whose items nest (a comment thread). The handler asks the item bundle which item is current, and lands each move through `page.item`, so focus, scroll and the box match j.
define("page.tree", {
  name: "tree",
  label: "Move through a tree of items",
  intent: "Move through nested items by depth, as in a comment thread. Parent goes to the nearest item above with a lower depth, left folds an open item as fold does and otherwise goes to the parent (a count does not repeat the fold), child to the next item when it is one level deeper, and next and prev to the nearest sibling at the same depth in that direction, without leaving the parent. A count prefix repeats a move. Child on a folded item unfolds it and stays on it. Fold folds the item with its replies, or the parent when the item has no replies or is folded already. Unfold opens a folded item and toggle flips the fold. The extent selector goes to the item moves as it does for page.item. Folding and unfolding click the site's own fold control, with the pointer events of a hint click, or with fold by keys send ArrowLeft and ArrowRight to the item, and do not check the result. With the aria preset the items are the treeitems of the tree that holds the current item, folded is aria-expanded false, the parent is the closest treeitem around the item, child on a folded item only opens it, and a tree that moves its focus by aria-activedescendant is refused. The command refuses when there is no current item, no such relative or no fold control that shows.",
  params: [
    { name: "action", type: "enum", values: ["parent", "left", "child", "next", "prev", "fold", "unfold", "toggle"], value_labels: { parent: "to the parent", left: "to fold, else to the parent", child: "to the first reply", next: "to the next sibling", prev: "to the previous sibling", fold: "to fold the thread", unfold: "to unfold the item", toggle: "to toggle the fold" }, description: { parent: "Go to the parent item.", left: "Fold an open item, else go to the parent item.", child: "Go to the first reply, or unfold a folded item.", next: "Go to the next item at the same level.", prev: "Go to the previous item at the same level.", fold: "Fold the thread, or the parent of a leaf.", unfold: "Unfold a folded item.", toggle: "Fold the item, or unfold it when it is folded." } },
    { name: "preset", type: "enum", values: ["none", "aria"], default: "none", value_labels: { aria: "as an ARIA tree" }, description: { aria: "Walk the current tree, folded by the arrows." } },
    // An ARIA tree needs none of the selectors below, so they are required only with no preset. The arm never holds when the preset is aria, so the param is then not accepted.
    { name: "selector", type: "string", main: true, rest: true, verbatim: true, default: [{ value: "", when: { preset: ["aria"] } }], when: { preset: ["none"] }, description: "Move through the elements this CSS selector finds." },
    { name: "link", type: "string", optional: true, description: "Focus the element this CSS selector finds in the item." },
    { name: "depth", type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_.:-]*$", default: [{ value: "aria-level", when: { preset: ["aria"] } }], when: { preset: ["none"] }, description: "Read the depth from the attribute of this name." },
    { name: "depth_from", type: "enum", values: ["item", "inside", "above"], default: "item", when: { preset: ["none"] }, description: { inside: "Read it from inside the item, where depth-at finds it.", above: "Read it from the closest ancestor that depth-at finds." } },
    // The arm never holds (the param needs `inside` or `above`), so the param is required once its `when` holds.
    { name: "depth_at", type: "string", default: [{ value: "", when: { depth_from: ["item"] } }], when: { depth_from: ["inside", "above"] }, description: "Find the element that holds the depth with this selector." },
    { name: "fold_by", type: "enum", values: ["click", "keys"], default: "click", when: { preset: ["none"] }, value_labels: { keys: "by the arrow keys" }, description: { keys: "Fold with ArrowLeft and unfold with ArrowRight." } },
    { name: "fold", type: "string", default: "", when: { fold_by: ["click"] }, description: "Click what this CSS selector finds in the item to fold it." },
    { name: "folded", type: "string", default: "", when: { preset: ["none"] }, description: "Treat an item as folded while this CSS selector matches." },
    { name: "extent", type: "string", default: "", description: "Extend the box down to what this selector finds." },
    { name: "times", type: "int", default: 1, min: 1, when: { action: ["parent", "left", "child", "next", "prev"] }, description: "Move this many steps." },
  ],
  bridge: false,
  runs_in: "content",
  count: { param: "times" },
  bundle: "tree",
  modes: ["item"],
});

// Meant for site rows, where a synthetic Ctrl+X or Ctrl+V keydown does not cut or paste: the browser runs a clipboard action only from `execCommand`, so a row binds a key to this command instead.
define("page.clipboard", {
  label: "Cut, copy or paste in the page",
  intent: "Run cut, copy or paste as Ctrl+X, C or V would. The page's own clipboard handling runs. It focuses the element the CSS selector finds, or acts on the focused element when there is no selector. It refuses when the selector matches nothing, or when the page or the clipboard refuses the action.",
  params: [
    { name: "action", type: "enum", values: ["cut", "copy", "paste"], value_labels: { cut: "cut", copy: "copy", paste: "paste" }, description: { cut: "Cut the selection to the clipboard.", copy: "Copy the selection to the clipboard.", paste: "Paste the clipboard at the selection." } },
    { name: "target", type: "string", optional: true, description: "Focus the element this CSS selector finds and act on it." },
  ],
  bridge: false,
  runs_in: "content",
  modes: ["normal"],
  bundle: "site_actions",
});
