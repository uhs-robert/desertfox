import assert from "node:assert/strict";
import { test } from "node:test";
import { close_drawer_on_escape, close_drawer_on_window_blur, render_help, reset_group_state, section_hash, update_config_source } from "../src/help/render.ts";
import { parse_route, site_rules_help_url } from "../src/help/route.ts";
import type { Route } from "../src/help/route.ts";
import type { Block } from "../src/help/blocks.ts";

type FakeListener = (event?: unknown) => void;

// Just enough DOM for render_help: elements with a class, an id, children, attributes, listeners and focus.
class FakeNode {
  className = "";
  tabIndex = 0;
  hidden = false;
  id = "";
  children: (FakeNode | string)[] = [];
  parent: FakeNode | null = null;
  attributes: Record<string, string> = {};
  listeners: Record<string, FakeListener> = {};
  tag: string;
  textContent = "";
  scrollTop = 0;
  shown = true;
  constructor(tag: string) { this.tag = tag; }
  classList = {
    contains: (name: string) => this.className.split(" ").includes(name),
    toggle: (name: string, force: boolean) => {
      const names = this.className.split(" ").filter((each) => each && each !== name);
      this.className = (force ? [...names, name] : names).join(" ");
    },
  };
  append(...nodes: (FakeNode | string)[]) {
    for (const node of nodes) if (typeof node !== "string") node.parent = this;
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: (FakeNode | string)[]) { this.children = []; this.append(...nodes); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, listener: FakeListener) { this.listeners[name] = listener; }
  matches(selector: string): boolean {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    const [, tag, name, value] = /^(\w+)(?:\[([\w-]+)="([^"]*)"\])?$/.exec(selector)!;
    return this.tag === tag && (name === undefined || this.attributes[name] === value);
  }
  querySelector(selector: string): FakeNode | null {
    return this.find_all((node) => node.matches(selector))[0] ?? null;
  }
  closest(selector: string): FakeNode | null {
    return this.matches(selector) ? this : this.parent?.closest(selector) ?? null;
  }
  contains(node: FakeNode | null): boolean {
    return node === this || (node?.parent ? this.contains(node.parent) : false);
  }
  focus() { fake_document.activeElement = this; }
  getClientRects() { return this.shown ? [{}] : []; }
  find_all(test: (node: FakeNode) => boolean): FakeNode[] {
    const below = this.children.flatMap((child) => (typeof child === "string" ? [] : child.find_all(test)));
    return test(this) ? [this, ...below] : below;
  }
}

const fake_document = {
  activeElement: null as FakeNode | null,
  body: new FakeNode("body"),
  createElement: (tag: string) => new FakeNode(tag),
  createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
  querySelector: (selector: string) => fake_document.body.querySelector(selector),
};

const by_class = (name: string) => (node: FakeNode): boolean => node.classList.contains(name);

const QUICK_START: Block[] = [
  { kind: "paragraph", inlines: [{ kind: "text", text: "intro" }] },
  { kind: "heading", level: 2, text: "Click with hints" },
  { kind: "heading", level: 2, text: "Which-key" },
  { kind: "heading", level: 2, text: "Which key" },
];

const GROUPS = [{ name: "scroll", commands: [] }, { name: "tab", commands: [] }];

const GUIDE: Block[] = [
  { kind: "heading", level: 2, text: "Set up your engines" },
  { kind: "heading", level: 3, text: "Slots" },
  { kind: "heading", level: 3, text: "Trees" },
];

function render(route: Route, keep_state = false, guide: Block[] = [], root = new FakeNode("body"), warnings: string[] = []): FakeNode {
  (globalThis as { document?: unknown }).document = fake_document;
  fake_document.body = root;
  fake_document.activeElement = null;
  if (!keep_state) reset_group_state();
  render_help(root as never, { quick_start: QUICK_START, groups: GROUPS, warnings, config_source: "Config files", rebuild_steps: ["step one"], engines: [], tip: { kind: "tip", inlines: [] } } as never, route, guide);
  return root;
}

const group_nodes = (root: FakeNode) => root.find_all(by_class("desertfox-help-nav-group")).map((group) => ({
  page: (group.find_all((node) => node.tag === "a")[0]!.children[0]) as string,
  page_link: group.find_all((node) => node.tag === "a")[0]!,
  toggle: group.find_all(by_class("desertfox-help-sections-toggle"))[0]!,
  list: group.find_all(by_class("desertfox-help-sections"))[0]!,
}));

const links = (list: FakeNode) => (list.children as FakeNode[]).map((link) => link.attributes["href"]);

test("the settings group lists the setting groups as sections", () => {
  const by_page = Object.fromEntries(group_nodes(render({ page: "home" })).map((group) => [group.page, links(group.list)]));
  assert.deepEqual(by_page["Settings"], [
    "#section=settings/appearance",
    "#section=settings/new-tab",
    "#section=settings/search",
    "#section=settings/command-line-and-completion",
    "#section=settings/general",
    "#section=settings/keys",
    "#section=settings/search-engines",
    "#section=settings/aliases",
    "#section=settings/quickmarks",
    "#section=settings/advanced-settings-files",
    "#section=settings/advanced-back-up-and-restore",
    "#section=settings/advanced-edit-files",
  ]);
});

test("every page with sections has a group, and Home has none", () => {
  assert.deepEqual(group_nodes(render({ page: "home" })).map((group) => group.page), ["Settings", "Quick Start", "Commands", "Search Engines", "Styling"]);
});

test("the current page's group is open and the others are closed", () => {
  for (const [page, title] of [["home", "Home"], ["quick-start", "Quick Start"], ["commands", "Commands"], ["styling", "Styling"]] as const) {
    for (const group of group_nodes(render({ page }))) {
      const open = group.page === title;
      assert.equal(group.list.hidden, !open);
      assert.equal(group.toggle.attributes["aria-expanded"], String(open));
      assert.equal((group.toggle.children[0] as FakeNode).tag, "svg");
      assert.equal(group.toggle.attributes["aria-controls"], group.list.id);
    }
  }
  const engines = group_nodes(render({ page: "search-engines" }, false, GUIDE));
  assert.deepEqual(engines.map((group) => !group.list.hidden), [false, false, false, true, false]);
});

test("each toggle works alone and flips aria-expanded", () => {
  const groups = group_nodes(render({ page: "quick-start" }));
  const [settings, quick_start] = [groups[0]!, groups[1]!];
  settings.toggle.listeners["click"]!();
  assert.equal(settings.list.hidden, false);
  assert.equal(settings.toggle.attributes["aria-expanded"], "true");
  assert.equal(quick_start.list.hidden, false);
  quick_start.toggle.listeners["click"]!();
  assert.equal(quick_start.list.hidden, true);
  assert.equal(quick_start.toggle.attributes["aria-expanded"], "false");
  assert.equal(settings.list.hidden, false);
});

test("each group lists its page's sections", () => {
  const by_page = Object.fromEntries(group_nodes(render({ page: "home" })).map((group) => [group.page, links(group.list)]));
  assert.equal(by_page["Home"], undefined);
  assert.deepEqual(by_page["Styling"], ["#section=styling/variables", "#section=styling/classes"]);
  assert.deepEqual(by_page["Commands"], ["#section=commands/scroll", "#section=commands/tab"]);
  assert.deepEqual(by_page["Quick Start"], ["#section=quick-start/click-with-hints", "#section=quick-start/which-key", "#section=quick-start/which-key-2"]);
});

test("heading ids are unique, focusable and match the section links", () => {
  const root = render({ page: "quick-start" });
  const headings = root.find_all((node) => node.tag === "h2");
  assert.deepEqual(headings.map((node) => node.id), ["quick-start-click-with-hints", "quick-start-which-key", "quick-start-which-key-2"]);
  assert.ok(headings.every((node) => node.tabIndex === -1));
});

test("each section link round-trips through the router to a heading on its page", () => {
  const groups = group_nodes(render({ page: "home" }));
  for (const group of groups) {
    for (const hash of links(group.list) as string[]) {
      const route = parse_route(hash);
      const target = render(route).find_all((node) => (node.tag === "h2" || node.tag === "h3") && node.id === `${route.page}-${route.section}`);
      assert.equal(target.length, 1, hash);
    }
  }
});

test("a section route opens its page's group", () => {
  const groups = group_nodes(render({ page: "commands", section: "tab" }));
  assert.deepEqual(groups.map((group) => !group.list.hidden), [false, false, true, false, false]);
});

test("section routes parse for every page and reject an unknown page", () => {
  assert.deepEqual(parse_route(section_hash("styling", "classes")), { page: "styling", section: "classes" });
  assert.deepEqual(parse_route("#section=nowhere/x"), { page: "home" });
  assert.deepEqual(parse_route("#section=quick-start"), { page: "home" });
});

test("a toggle persists across renders, auto-opening does not, and a menu click reopens a closed group", () => {
  render({ page: "home" });
  group_nodes(render({ page: "home" }, true))[2]!.toggle.listeners["click"]!();
  assert.deepEqual(group_nodes(render({ page: "home" }, true)).map((group) => !group.list.hidden), [false, false, true, false, false]);
  assert.deepEqual(group_nodes(render({ page: "styling" }, true)).map((group) => !group.list.hidden), [false, false, true, false, true]);
  // Styling was only open by default, so it closes, and the toggled Commands group stays open.
  const on_commands = group_nodes(render({ page: "commands" }, true)).map((group) => !group.list.hidden);
  assert.deepEqual(on_commands, [false, false, true, false, false]);
});

test("automatic opening piles nothing up", () => {
  render({ page: "home" });
  assert.deepEqual(group_nodes(render({ page: "commands" }, true)).map((group) => !group.list.hidden), [false, false, true, false, false]);
  const closed = group_nodes(render({ page: "commands" }, true))[2]!;
  closed.toggle.listeners["click"]!();
  assert.equal(group_nodes(render({ page: "commands" }, true))[2]!.list.hidden, true);
  render({ page: "home" }, true);
  assert.equal(group_nodes(render({ page: "commands" }, true))[2]!.list.hidden, false);
});

test("clicking the current page's menu entry reopens a group the chevron closed", () => {
  const commands = group_nodes(render({ page: "commands" }))[2]!;
  commands.toggle.listeners["click"]!();
  assert.equal(commands.list.hidden, true);
  commands.page_link.listeners["click"]!();
  assert.equal(commands.list.hidden, false);
  assert.equal(commands.toggle.attributes["aria-expanded"], "true");
  assert.equal(group_nodes(render({ page: "commands" }, true))[2]!.list.hidden, false);
});

test("a menu click from a section of the same page reopens a closed group", () => {
  const commands = group_nodes(render({ page: "commands", section: "tab" }))[2]!;
  commands.toggle.listeners["click"]!();
  commands.page_link.listeners["click"]!();
  assert.equal(group_nodes(render({ page: "commands" }, true))[2]!.list.hidden, false);
});

test("Search Engines lists the guide's level-3 headings and Your engines, with matching heading ids", () => {
  const root = render({ page: "search-engines" }, false, GUIDE);
  const group = group_nodes(root)[3]!;
  assert.deepEqual(links(group.list), ["#section=search-engines/slots", "#section=search-engines/trees", "#section=search-engines/your-engines"]);
  const headings = root.find_all((node) => node.id.startsWith("search-engines-"));
  assert.deepEqual(headings.map((node) => [node.tag, node.id, node.tabIndex]), [["h3", "search-engines-slots", -1], ["h3", "search-engines-trees", -1], ["h2", "search-engines-your-engines", -1]]);
});

test("without the guide, Search Engines lists only Your engines", () => {
  assert.deepEqual(links(group_nodes(render({ page: "search-engines" }))[3]!.list), ["#section=search-engines/your-engines"]);
});

test("a rebuild keeps the sidebar's scroll position, on the same page and across pages", () => {
  const root = render({ page: "quick-start" });
  const sidebar_of = () => root.querySelector(".desertfox-help-sidebar")!;
  assert.equal(sidebar_of().scrollTop, 0);
  sidebar_of().scrollTop = 120;
  render({ page: "quick-start", section: "which-key" }, true, [], root);
  assert.equal(sidebar_of().scrollTop, 120);
  render({ page: "commands" }, true, [], root);
  assert.equal(sidebar_of().scrollTop, 120);
});

test("the sidebar brand shows the packaged logo above the name", () => {
  const brand = render(parse_route("")).querySelector(".desertfox-help-sidebar")?.querySelector(".desertfox-help-brand");
  const logo = brand?.children[0] as FakeNode;
  assert.equal(logo.className, "desertfox-help-logo");
  assert.equal(logo.attributes.src, "icons/desertfox.svg");
  assert.equal(brand?.children[1], "DesertFox");
});

test("the home page opens with the keycap mark", () => {
  const keycap = render(parse_route("")).querySelector(".desertfox-help-keycap");
  assert.equal(keycap?.attributes.src, "icons/desertfox-keycap.svg");
});

test("the home header holds the keycap above the title, ahead of the lead sentence", () => {
  const page = render(parse_route("")).querySelector(".desertfox-help-page");
  const header = page?.children[0] as FakeNode;
  assert.equal(header.className, "desertfox-help-home-header");
  assert.equal((header.children[0] as FakeNode).className, "desertfox-help-keycap");
  assert.equal((header.children[1] as FakeNode).tag, "h1");
  assert.equal((page?.children[1] as FakeNode).tag, "p");
});

function drawer(route: Route = { page: "commands" }) {
  const root = render(route);
  const help = root.querySelector(".desertfox-help")!;
  const sidebar = root.querySelector(".desertfox-help-sidebar")!;
  const menu = root.querySelector(".desertfox-help-menu-toggle")!;
  const is_open = () => help.classList.contains("desertfox-help-drawer-open");
  const escape = () => {
    const event = { key: "Escape", stopped: false, preventDefault() {}, stopImmediatePropagation() { this.stopped = true; } };
    close_drawer_on_escape(event as never);
    return event.stopped;
  };
  return { root, help, sidebar, menu, is_open, escape, backdrop: root.querySelector(".desertfox-help-backdrop")! };
}

test("the menu button names and controls the sidebar and starts closed", () => {
  const { sidebar, menu, is_open } = drawer();
  assert.equal(menu.tag, "button");
  assert.equal(menu.attributes["aria-label"], "Menu");
  assert.equal(menu.attributes["aria-controls"], sidebar.id);
  assert.equal(menu.attributes["aria-expanded"], "false");
  assert.equal((menu.children[0] as FakeNode).tag, "svg");
  assert.equal(is_open(), false);
});

test("opening the drawer flips aria-expanded and focuses the current page's link", () => {
  const { menu, is_open } = drawer();
  menu.listeners["click"]!();
  assert.equal(is_open(), true);
  assert.equal(menu.attributes["aria-expanded"], "true");
  assert.equal(fake_document.activeElement?.attributes["aria-current"], "page");
  assert.equal(fake_document.activeElement?.children[0], "Commands");
});

test("Escape closes the open drawer, takes the key and returns focus to the menu button", () => {
  const { menu, is_open, escape } = drawer();
  assert.equal(escape(), false, "Escape with the drawer closed reaches the page");
  menu.listeners["click"]!();
  assert.equal(escape(), true);
  assert.equal(is_open(), false);
  assert.equal(menu.attributes["aria-expanded"], "false");
  assert.equal(fake_document.activeElement, menu);
});

test("Escape leaves the key alone once the window is wide again", () => {
  const { menu, is_open, escape } = drawer();
  menu.listeners["click"]!();
  menu.shown = false;
  assert.equal(escape(), false);
  assert.equal(is_open(), false);
});

test("a click on the backdrop closes the drawer and focuses the menu button", () => {
  const { menu, backdrop, is_open } = drawer();
  menu.listeners["click"]!();
  backdrop.listeners["click"]!();
  assert.equal(is_open(), false);
  assert.equal(fake_document.activeElement, menu);
});

test("picking a link closes the drawer and moves focus out of it", () => {
  const { root, menu, sidebar, is_open } = drawer();
  menu.listeners["click"]!();
  const link = fake_document.activeElement!;
  sidebar.listeners["click"]!({ target: link });
  assert.equal(is_open(), false);
  assert.equal(fake_document.activeElement, root.querySelector("h1"));
});

test("a chevron click inside the drawer keeps it open", () => {
  const { menu, sidebar, is_open } = drawer();
  menu.listeners["click"]!();
  const chevron = sidebar.querySelector(".desertfox-help-sections-toggle")!;
  chevron.listeners["click"]!();
  sidebar.listeners["click"]!({ target: chevron });
  assert.equal(is_open(), true);
});

test("focus leaving the drawer closes it", () => {
  const { root, help, menu, sidebar, is_open } = drawer();
  menu.listeners["click"]!();
  help.listeners["focusin"]!({ target: sidebar.querySelector("a") });
  assert.equal(is_open(), true);
  help.listeners["focusin"]!({ target: root.querySelector("h1") });
  assert.equal(is_open(), false);
});

test("the window losing focus to the browser UI closes the drawer without taking focus back", () => {
  const { menu, is_open } = drawer();
  menu.listeners["click"]!();
  fake_document.activeElement = null;
  close_drawer_on_window_blur();
  assert.equal(is_open(), false);
  assert.equal(menu.attributes["aria-expanded"], "false");
  assert.equal(fake_document.activeElement, null);
});

test("Home says what DesertFox is and links the next steps, with no settings table and no config steps", () => {
  const page = render({ page: "home" }).querySelector(".desertfox-help-page")!;
  assert.deepEqual(page.find_all((node) => node.tag === "h2").map((node) => node.children[0]), ["Start here"]);
  assert.deepEqual(page.find_all((node) => node.tag === "a").map((node) => node.attributes["href"]), ["#/quick-start", "#/settings", "#/commands"]);
  assert.match(text_of(page), /lets you use Firefox from the keyboard/);
  assert.equal(page.find_all((node) => node.tag === "ol" || node.tag === "table").length, 0);
});

test("Home shows the problems heading only when a warning exists, and the popup link finds it", () => {
  const root = render({ page: "home" }, false, [], undefined, ["A key is bound twice."]);
  const heading = root.find_all((node) => node.tag === "h2" && node.children[0] === "Problems in your setup");
  assert.equal(heading.length, 1);
  assert.equal(heading[0]!.id, "home-warnings");
});

test("Settings puts the groups and forms first and the files, backup and host in a collapsed Advanced block", () => {
  const page = render({ page: "settings" }).querySelector(".desertfox-help-page")!;
  const texts = page.find_all((node) => node.tag === "p").map((node) => node.children[0]);
  assert.ok(texts.includes("Config files."));
  const headings = page.find_all((node) => node.tag === "h2" || node.tag === "h3").map((node) => node.children[0]);
  assert.deepEqual(headings, ["Appearance", "New tab", "Search", "Command line and completion", "General", "Keys", "Search engines", "Aliases", "Quickmarks", "Advanced: settings files", "Advanced: back up and restore", "Advanced: edit files"]);
  const [advanced] = page.find_all((node) => node.tag === "details");
  assert.ok(advanced && advanced.find_all((node) => node.tag === "ol").length === 1);
  assert.equal(advanced.find_all(by_class("desertfox-settings-install")).length, 1);
  assert.equal(advanced.find_all(by_class("desertfox-transfer")).length + advanced.find_all(by_class("desertfox-files")).length, 2);
  for (const box of ["desertfox-keys", "desertfox-engines", "desertfox-aliases", "desertfox-quickmarks"]) assert.equal(advanced.find_all(by_class(box)).length, 0, box);
});

test("the changed-only toggle sets its class on the settings box, and a group box starts with the none-changed line", () => {
  const root = render({ page: "settings" });
  const box = root.querySelector(".desertfox-settings")!;
  assert.match(text_of(box), /You have not changed any setting yet/);
  const check = root.find_all((node) => node.tag === "input")[0]!;
  const change = check.listeners["change"]!;
  (check as unknown as { checked: boolean }).checked = true;
  change();
  assert.ok(box.classList.contains("desertfox-only-changed"));
  (check as unknown as { checked: boolean }).checked = false;
  change();
  assert.equal(box.classList.contains("desertfox-only-changed"), false);
});

test("a model change updates the Settings config source line in place", () => {
  const root = render({ page: "settings" });
  const line = root.querySelector(".desertfox-config-source")!;
  update_config_source({ config_source: "Your settings come from files" } as never);
  assert.equal(line.textContent, "Your settings come from files.");
});

test("the Site Rules route carries its address through the hash, whatever the address holds", () => {
  for (const address of ["https://a.test/", "https://a.test/p?x=1&y=%20#top", "https://a.test/?advanced"]) {
    assert.deepEqual(parse_route(site_rules_help_url("", address)), { page: "site-rules", address }, address);
  }
  assert.deepEqual(parse_route("#/site-rules"), { page: "site-rules" });
  assert.deepEqual(parse_route("#/site-rules?address=%E0%A4%A"), { page: "site-rules" });
});

const SITE_RULES_VIEW = {
  address: "https://a.test/",
  rows: [
    { origin: "user", site: "https://a.test/*", columns: [{ name: "hint_add", value: ".a, .b", shadowed: false }], changes: [{ keys: "j", action: "Reload", replaces: "Scroll down" }] },
    { origin: "default", name: "sheets", site: "https://a.test/*", columns: [{ name: "hint_add", value: ".c", shadowed: true }], changes: [{ keys: "k", mode: "visual", action: "Stop", dead: "an earlier row decides it" }] },
  ],
};

function render_site_rules(address: string | undefined, rows = SITE_RULES_VIEW.rows): FakeNode {
  (globalThis as { document?: unknown }).document = fake_document;
  const root = new FakeNode("body");
  fake_document.body = root;
  reset_group_state();
  const model = { quick_start: QUICK_START, groups: GROUPS, warnings: [], config_source: "", rebuild_steps: [], engines: [], tip: { kind: "tip", inlines: [] }, site_rules_for: () => ({ address, rows }) };
  render_help(root as never, model as never, { page: "site-rules", ...(address === undefined ? {} : { address }) }, []);
  return root;
}

const text_of = (node: FakeNode | string): string => (typeof node === "string" ? node : node.children.map(text_of).join(" "));

test("the Site Rules page draws each row with its origin, columns as name and value, and the keys it changes", () => {
  const sections = render_site_rules("https://a.test/").find_all(by_class("desertfox-help-command"));
  assert.equal(sections.length, 2);
  assert.match(text_of(sections[0]!), /Your rule.*hint_add.*\.a, \.b.*Scroll down/);
  assert.match(text_of(sections[1]!), /Built-in rule sheets.*hint_add.*\.c.*visual.*Stop/);
  assert.equal(sections[0]!.find_all(by_class("desertfox-help-shadowed")).length, 0);
  assert.equal(sections[1]!.find_all(by_class("desertfox-help-shadowed")).length, 2);
  assert.match(text_of(sections[1]!), /an earlier rule decides this/);
});

test("the Site Rules page says so when no row fits, and tells where to run it without an address", () => {
  assert.match(text_of(render_site_rules("https://a.test/", [])), /No rule applies to this address/);
  assert.match(text_of(render_site_rules(undefined)), /Open a web page, then run +:help site_rules/);
});
