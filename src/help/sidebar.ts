// The sidebar: page links with their section lists, the "you are here" mark and the narrow-window drawer.

import type { Block } from "./blocks.ts";
import type { HelpModel } from "./model.ts";
import { chevron_icon, heart_icon } from "../shared/icons.ts";
import { ADVANCED_SUFFIX, PAGES } from "../shared/page/help_route.ts";
import type { PageId } from "../shared/page/help_route.ts";
import { el, new_tab_link } from "./dom.ts";
import { page_sections, section_anchor, section_hash } from "./sections.ts";
import type { Section } from "./sections.ts";

export const ONLY_CHANGED_CLASS = "desertfox-only-changed";

// The filter is a class on the settings box. The stylesheet (home.html) hides the rows whose `data-changed` is false and the groups left with none, so a refresh of the rows needs no code here.
function clear_only_changed(): void {
  document.querySelector(".desertfox-settings")?.classList.toggle(ONLY_CHANGED_CLASS, false);
  const box = document.querySelector<HTMLInputElement>(".desertfox-only-changed-toggle");
  if (box) box.checked = false;
}

function support_card(): HTMLElement {
  const heading = el("div", "desertfox-help-support-heading", heart_icon("desertfox-help-support-heart"), "Enjoying DesertFox?");
  return el(
    "div",
    "desertfox-help-support",
    heading,
    el("div", "desertfox-help-support-note", "Support its work"),
    new_tab_link("GitHub Sponsors", "https://github.com/sponsors/uhs-robert", "desertfox-help-support-link"),
    new_tab_link("Ko-fi", "https://ko-fi.com/uphillsolutions", "desertfox-help-support-link"),
  );
}

// The section links of the current render with the id of the heading each one names, for the "you are here" mark.
type SectionLink = { link: HTMLElement; heading_id: string };
let section_links: SectionLink[] = [];

// The link of the section the reader is in gets aria-current="location". That is the last heading at or above `line`, or the last heading of all when `at_end`, where a short last section never reaches the line.
// `top_of` gives a heading's distance from the viewport top, or undefined when it is not on the page or hidden. Returns the current link, and writes an attribute only where it changes.
export function mark_current_section(entries: SectionLink[], top_of: (heading_id: string) => number | undefined, line: number, at_end: boolean): HTMLElement | undefined {
  const placed = entries.flatMap((entry) => {
    const top = top_of(entry.heading_id);
    return top === undefined ? [] : [{ entry, top }];
  });
  const above = placed.filter(({ top }) => top <= line);
  const last_of = (rows: typeof placed) => rows.reduce<(typeof placed)[number] | undefined>((a, b) => (a === undefined || b.top >= a.top ? b : a), undefined);
  const current = last_of(at_end ? placed : above)?.entry;
  for (const entry of entries) {
    const marked = entry.link.getAttribute("aria-current") === "location";
    if (entry === current && !marked) entry.link.setAttribute("aria-current", "location");
    else if (entry !== current && marked) entry.link.removeAttribute("aria-current");
  }
  return current?.link;
}

// A page that does not scroll has no end to reach, so its last section is not marked for that.
export const at_page_end = (scroll_y: number, window_height: number, page_height: number): boolean => page_height > window_height + 2 && scroll_y + window_height >= page_height - 2;

const CURRENT_LINE_FRACTION = 0.3;
let sidebar_scroller: HTMLElement | undefined;
let marked_link: HTMLElement | undefined;
let page_watcher: { disconnect(): void } | undefined;

// The sidebar scrolls on its own, so a long list can hide the current link. Only the sidebar moves, never the page.
function scroll_sidebar_to(bar: HTMLElement, link: HTMLElement): void {
  const bar_box = bar.getBoundingClientRect();
  const link_box = link.getBoundingClientRect();
  if (link_box.top < bar_box.top) bar.scrollTop += link_box.top - bar_box.top;
  else if (link_box.bottom > bar_box.bottom) bar.scrollTop += link_box.bottom - bar_box.bottom;
}

export function refresh_current_section(): void {
  const top_of = (id: string) => {
    const heading = document.getElementById(id);
    return heading && heading.getClientRects().length > 0 ? heading.getBoundingClientRect().top : undefined;
  };
  const at_end = at_page_end(window.scrollY, window.innerHeight, document.documentElement.scrollHeight);
  const current = mark_current_section(section_links, top_of, window.innerHeight * CURRENT_LINE_FRACTION, at_end);
  if (current !== marked_link && current && sidebar_scroller && current.getClientRects().length > 0) scroll_sidebar_to(sidebar_scroller, current);
  marked_link = current;
}

let mark_queued = false;

// One scroll listener for the whole page, throttled to one run per frame. It reads the links of the latest render, so a redraw needs no new listener.
function queue_current_section(): void {
  if (mark_queued || typeof requestAnimationFrame !== "function") return;
  mark_queued = true;
  requestAnimationFrame(() => {
    mark_queued = false;
    refresh_current_section();
  });
}

let scroll_listener_added = false;
// A layout change with no scroll (a block opens, the filter hides rows, a box fills in) moves the headings, so the page content is watched too.
export function follow_current_section(sidebar_node: HTMLElement, page: HTMLElement): void {
  sidebar_scroller = sidebar_node;
  marked_link = undefined;
  if (!scroll_listener_added && typeof window !== "undefined" && window.addEventListener) {
    scroll_listener_added = true;
    window.addEventListener("scroll", queue_current_section, { passive: true });
    window.addEventListener("resize", queue_current_section);
  }
  page_watcher?.disconnect();
  page_watcher = undefined;
  if (typeof ResizeObserver === "function") {
    const watcher = new ResizeObserver(queue_current_section);
    watcher.observe(page);
    page_watcher = watcher;
  }
  queue_current_section();
}

function section_list(page: PageId, sections: Section[], expanded: boolean, keep_advanced = false): HTMLElement {
  const list = el("div", "desertfox-help-sections");
  list.id = `desertfox-help-sections-${page}`;
  list.hidden = !expanded;
  for (const { title, slug } of sections) {
    const link = el("a", undefined, title);
    const hash = section_hash(page, slug) + (keep_advanced ? ADVANCED_SUFFIX : "");
    link.setAttribute("href", hash);
    section_links.push({ link, heading_id: section_anchor(page, slug) });
    // The same hash fires no hashchange, so a click would not scroll back from where the reader moved.
    link.addEventListener("click", () => {
      // A group the filter hides has no heading to scroll to, so a link to a group shows every setting.
      if (page === "settings" && document.getElementById(section_anchor(page, slug))?.closest(".desertfox-settings-section")) clear_only_changed();
      if (decodeURIComponent(location.hash) !== decodeURIComponent(hash)) return;
      const heading = document.getElementById(section_anchor(page, slug));
      const collapsed = heading?.closest("details");
      if (collapsed) collapsed.open = true;
      heading?.scrollIntoView();
      heading?.focus({ preventScroll: true });
    });
    list.append(link);
  }
  return list;
}

// Kept outside the tree, like any state a render would wipe. Holds only chevron toggles, never the automatic opening of the current page.
const group_open = new Map<PageId, boolean>();
let last_page: PageId | undefined;

export function reset_group_state(): void {
  group_open.clear();
  last_page = undefined;
}

// A real button, so keys and hints reach it.
function section_toggle(page: PageId, title: string, list: HTMLElement): HTMLElement {
  const button = el("button", "desertfox-help-sections-toggle", chevron_icon());
  button.setAttribute("type", "button");
  button.setAttribute("aria-label", `${title} sections`);
  button.setAttribute("aria-controls", list.id);
  button.setAttribute("aria-expanded", String(!list.hidden));
  button.addEventListener("click", () => {
    list.hidden = !list.hidden;
    group_open.set(page, !list.hidden);
    button.setAttribute("aria-expanded", String(!list.hidden));
  });
  return button;
}

// The logo is the packaged icon, reached by a path relative to home.html, which the build copies to the package root.
function brand(): HTMLElement {
  const logo = document.createElement("img");
  logo.className = "desertfox-help-logo";
  logo.setAttribute("src", "icons/desertfox.svg");
  logo.setAttribute("alt", "");
  return el("div", "desertfox-help-brand", logo, "DesertFox");
}

// The current page's group is open unless the reader toggled it on this page. Going to a page drops its stored toggle, so a menu click always opens it. Other groups keep what the reader set, closed at first. Each toggle works alone.
export function sidebar(current: PageId, model: HelpModel, guide: Block[], advanced: boolean): HTMLElement {
  section_links = [];
  if (current !== last_page) group_open.delete(current);
  last_page = current;
  const entries = PAGES.map((page): HTMLElement => {
    const link = el("a", undefined, page.title);
    link.setAttribute("href", page.hash);
    if (page.id === current) link.setAttribute("aria-current", "page");
    const sections = page_sections(page.id, model, guide);
    if (sections.length === 0) return link;
    const list = section_list(page.id, sections, group_open.get(page.id) ?? page.id === current, page.id === "commands" && advanced);
    const toggle = section_toggle(page.id, page.title, list);
    // A click on the current page's entry fires no hashchange and so no render, and a click from one of its sections renders on the same page. Neither reaches the reset above, so the click does it.
    link.addEventListener("click", () => {
      group_open.delete(page.id);
      list.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    });
    return el("div", "desertfox-help-nav-group", el("div", "desertfox-help-nav-row", link, toggle), list);
  });
  return el("nav", "desertfox-help-sidebar", brand(), ...entries, support_card());
}

const DRAWER_OPEN_CLASS = "desertfox-help-drawer-open";
export const SIDEBAR_ID = "desertfox-help-sidebar";

function set_drawer_open(help: HTMLElement, open: boolean): void {
  help.classList.toggle(DRAWER_OPEN_CLASS, open);
  help.querySelector(".desertfox-help-menu-toggle")?.setAttribute("aria-expanded", String(open));
}

// Below the narrow breakpoint the sidebar is a drawer behind the menu button. Above it CSS hides the bar and the backdrop and ignores the open class.
// The drawer starts closed on every render, because each render follows a pick or a hash change. It lives in the DOM only, like the group toggles.
export function wire_drawer(help: HTMLElement, menu_toggle: HTMLElement, sidebar_node: HTMLElement, backdrop: HTMLElement, page_heading: HTMLElement): void {
  const close = (focus_target: HTMLElement | null) => {
    set_drawer_open(help, false);
    focus_target?.focus({ preventScroll: true });
  };
  menu_toggle.addEventListener("click", () => {
    const open = !help.classList.contains(DRAWER_OPEN_CLASS);
    set_drawer_open(help, open);
    if (open) (sidebar_node.querySelector<HTMLElement>('a[aria-current="page"]') ?? sidebar_node.querySelector("a"))?.focus();
  });
  backdrop.addEventListener("click", () => close(menu_toggle));
  // A section link on the same hash already focused its heading. Any other pick leaves focus on a link that is about to hide, and a hash change moves it on again.
  sidebar_node.addEventListener("click", (event) => {
    if (!help.classList.contains(DRAWER_OPEN_CLASS) || !(event.target as Element).closest("a")) return;
    close(sidebar_node.contains(document.activeElement) ? page_heading : null);
  });
  // Tab past either end of the drawer closes it, so focus never sits under the backdrop. Past the last link into the browser's own UI no focusin fires, so main.ts also calls close_drawer_on_window_blur.
  help.addEventListener("focusin", (event) => {
    if (help.classList.contains(DRAWER_OPEN_CLASS) && !sidebar_node.contains(event.target as Node)) close(null);
  });
}

export function close_drawer_on_window_blur(): void {
  const help = document.querySelector<HTMLElement>(`.${DRAWER_OPEN_CLASS}`);
  if (help) set_drawer_open(help, false);
}

// main.ts listens in the capture phase before the content script loads, so Escape closes the drawer instead of reaching the key flow.
export function close_drawer_on_escape(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  const help = document.querySelector<HTMLElement>(`.${DRAWER_OPEN_CLASS}`);
  const menu_toggle = help?.querySelector<HTMLElement>(".desertfox-help-menu-toggle");
  if (!help || !menu_toggle) return;
  set_drawer_open(help, false);
  // A window widened past the breakpoint hides the button and shows no drawer, so Escape keeps its usual meaning there.
  if (menu_toggle.getClientRects().length === 0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  menu_toggle.focus();
}
