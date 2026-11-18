import { get_config } from "../background/startup.ts";
import { NEW_TAB_PAGE_FILE } from "../shared/config.ts";
import { define } from "../shared/registry/builtin.ts";
import { open_in, own_pages, require_tab_id, typed_url_target, WHERE_PARAM } from "./open_target.ts";
import type { Where } from "./open_target.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { SEND_KEY_MAX_TIMES } from "../shared/send_key_limit.ts";
import { home_page_url } from "./url_build.ts";
import { browser_reload_clear_deps, make_reload_clear } from "./reload_clear.ts";
import type { ClearScope } from "./reload_clear.ts";

const reload_clear = make_reload_clear(browser_reload_clear_deps);

define("page.back", {
  label: "Back",
  intent: "Go back one page in the tab history. A count prefix goes back that many pages.",
  bridge: false,
  runs_in: "background",
  count: "repeat",
  run: async (ctx) => browser.tabs.goBack(require_tab_id(ctx)),
});

define("page.forward", {
  label: "Forward",
  intent: "Go forward one page in the tab history. A count prefix goes forward that many pages.",
  bridge: false,
  runs_in: "background",
  count: "repeat",
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
    if (args.clear === "site" || args.clear === "all") return reload_clear.run(tab_id, args.clear as ClearScope);
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
    await open_in(ctx, await typed_url_target(home_url, own_pages), args.where as Where);
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
  modes: ["normal", "insert"],
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

// Meant for site rows on result lists, where a row names the item selector and binds j and k. Enter on the focused link then opens it, as the browser does.
define("page.item", {
  label: "Move through items",
  intent: "Focus the next item that a CSS selector names. With no selector, it reads the page for a list or a grid of items (the item finder) and moves through that, and when it is not sure there is one, or when this bundle cannot load, down and up scroll like the plain keys. It draws a box around the item, which is a search result on a results page. Down and up go to the nearest item below or above, left and right to the nearest on the same row, so one bind set serves a list and a grid. It starts from the item that holds the focus, else the last item it moved to while that is on screen, else the first item in view. A count prefix moves that many items. Down and up scroll 50 px per count instead while the item runs past the view edge and at the last item, and with no item on the page they scroll as the plain keys do. Left and right show a notice at the last item. First and last scroll the list to its top or bottom and go to the first and last item, whatever has focus. While the page draws or loads more items they follow the end, until it stays the same for a second or you press a key. They ignore a count, record the place they leave in the jump list, and do nothing on a page with no item. Current focuses the item a move would start from and goes nowhere, and does nothing on a page with no item. Escape clears the box. With hover on, the item under the box also gets the pointer events of a mouse resting on it, about 300 ms after the last move, and loses them when the box moves or clears.",
  params: [
    { name: "selector", type: "string", main: true, rest: true, verbatim: true, optional: true, description: "Move through the elements this CSS selector finds." },
    { name: "link", type: "string", optional: true, description: "Focus the element this CSS selector finds in the item." },
    { name: "direction", type: "enum", values: ["down", "up", "left", "right", "first", "last", "current"], value_labels: { down: "to item below", up: "to item above", left: "to item on the left", right: "to item on the right", first: "to first item", last: "to last item", current: "to the current item" }, description: { down: "Go to the nearest item below.", up: "Go to the nearest item above.", left: "Go to the nearest item on the left.", right: "Go to the nearest item on the right.", first: "Go to the first item on the page.", last: "Go to the last item on the page.", current: "Focus the item a move starts from, and go nowhere." } },
    { name: "times", type: "int", default: 1, min: 1, description: "Move this many items." },
    { name: "hover", type: "bool", default: false, description: "Hover the item, which starts a video preview." },
  ],
  bridge: false,
  runs_in: "content",
  count: { param: "times" },
  // The ends replace gg and G on the result rows, which record the place they leave, so `<C-o>` and `''` come back.
  jumps: (args) => args.direction === "first" || args.direction === "last",
  bundle: "item",
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
