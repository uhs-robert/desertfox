// What each setting accepts, refuses and lists, written out value by value, so a change to how the settings are
// declared cannot change what a user sees. The editor schema is compared with a copy of its output before #85.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_SETTINGS, effective_settings } from "../src/shared/config.ts";
import { parse_setting_words, SETTING_NAMES, SETTING_SPECS } from "../src/shared/settings_schema.ts";
import { enabled_widgets } from "../src/newtab/render.ts";
import { read_sections } from "../src/newtab/lists.ts";
import { settings_schema } from "../src/shared/config_build/schemas.ts";

const EXPECTATIONS: Record<string, string> = {
  which_key_delay_ms: "a number of milliseconds, 0 or more",
  which_key_border: '"square", "round" or "chamfer"',
  hint_letters: "a string of 2 or more distinct letters",
  ignore_sites: "a list of match pattern strings",
  next_patterns: "a list of link texts",
  prev_patterns: "a list of link texts",
  mode_indicator: '"always", "not_normal" or "off"',
  palette: "a theme name",
  light_intensity: "a whole number from 1 to 5",
  search_prefixes: '{"here": "...", "tab": "..."} with non-empty strings',
  container_prefixes: '{"reopen": "...", "tab": "..."} with non-empty strings',
  home_page: "a non-empty URL string",
  default_engine: "the name of a search engine",
  new_tab_page: '"desertfox" or an http or https URL',
  completion_all_windows: "true or false",
  cmdline_prompt: "a string of 1 to 8 characters on one line",
  open_completion: 'a list of "bookmarks" and "history" with no repeat',
  statusbar_widgets: 'a list of "url", "scroll" and "tabs" with no repeat',
  history_completion_max: "a whole number, 0 or more",
  history_list_max: "a whole number, 0 or more",
  newtab_clock: 'true, false, "analog" or "digital"',
  newtab_date: "true or false",
  newtab_clock_format: "12 or 24",
  newtab_bookmarks: "true or false",
  newtab_bookmarks_max: "a whole number, 0 or more",
  newtab_recent_tabs: "true or false",
  newtab_recent_tabs_max: "a whole number, 0 or more",
  newtab_links: 'a list of tables with "label", an http or https "url" and an optional "group"',
  open_quick_start_on_install: "true or false",
};

test("every setting keeps its expectation text, in the declared order", () => {
  assert.deepEqual(SETTING_NAMES, Object.keys(EXPECTATIONS));
  for (const name of SETTING_NAMES) assert.equal(SETTING_SPECS[name].expectation, EXPECTATIONS[name], name);
});

test("every setting keeps its listed values", () => {
  const listed = Object.fromEntries(SETTING_NAMES.map((name) => [name, SETTING_SPECS[name].listed_values?.()]).filter(([, values]) => values !== undefined));
  const { palette, ...rest } = listed as Record<string, readonly string[]>;
  assert.ok(palette?.includes("oasis_moonlight"));
  assert.deepEqual(rest, {
    which_key_border: ["square", "round", "chamfer"],
    mode_indicator: ["always", "not_normal", "off"],
    light_intensity: ["1", "2", "3", "4", "5"],
    new_tab_page: ["desertfox"],
    completion_all_windows: ["true", "false"],
    cmdline_prompt: ["caret", "colon"],
    open_completion: ["bookmarks", "history"],
    statusbar_widgets: ["url", "scroll", "tabs"],
    newtab_clock: ["true", "false", "analog", "digital"],
    newtab_date: ["true", "false"],
    newtab_clock_format: ["12", "24"],
    newtab_bookmarks: ["true", "false"],
    newtab_recent_tabs: ["true", "false"],
    open_quick_start_on_install: ["true", "false"],
  });
});

test("the list, unsettable and toggle sets stay the same", () => {
  assert.deepEqual(SETTING_NAMES.filter((name) => SETTING_SPECS[name].is_list), ["ignore_sites", "next_patterns", "prev_patterns", "open_completion", "statusbar_widgets"]);
  assert.deepEqual(SETTING_NAMES.filter((name) => !SETTING_SPECS[name].settable), ["search_prefixes", "container_prefixes", "newtab_links"]);
  // A toggle flips the value in force, so an absent one flips from its default.
  const toggles = Object.fromEntries(SETTING_NAMES.filter((name) => SETTING_SPECS[name].is_toggle).map((name) => [name, DEFAULT_SETTINGS[name]]));
  assert.deepEqual(toggles, { completion_all_windows: false, newtab_date: true, newtab_bookmarks: false, newtab_recent_tabs: false, open_quick_start_on_install: true });
});

const ACCEPTS: Record<string, unknown[]> = {
  which_key_delay_ms: [0, 0.5, 300],
  which_key_border: ["square", "round", "chamfer"],
  hint_letters: ["ab", "asdfghjkl", "12"],
  ignore_sites: [[], ["*://a.com/*", "x"]],
  next_patterns: [[], ["next", ">"]],
  prev_patterns: [[], ["prev", "<"]],
  mode_indicator: ["always", "not_normal", "off"],
  palette: ["oasis_moonlight", "no_such_theme"],
  light_intensity: [1, 5],
  search_prefixes: [{ here: "s", tab: "S" }, { tab: "T", here: "h" }],
  container_prefixes: [{ reopen: "c", tab: "C" }],
  home_page: ["desertfox", "x"],
  default_engine: ["duck"],
  new_tab_page: ["desertfox", "https://a.example/", "HTTP://A.EXAMPLE"],
  completion_all_windows: [true, false],
  // Code points, not UTF-16 units: eight emoji are sixteen units.
  cmdline_prompt: ["c", "> ", "12345678", "\u{1F600}".repeat(8), "\t"],
  open_completion: [[], ["history"], ["history", "bookmarks"]],
  statusbar_widgets: [[], ["tabs"], ["tabs", "url"]],
  history_completion_max: [0, 10],
  history_list_max: [0, 10],
  newtab_clock: [true, false, "analog", "digital"],
  newtab_date: [true, false],
  newtab_clock_format: [12, 24],
  newtab_bookmarks: [true],
  newtab_bookmarks_max: [0, 8],
  newtab_recent_tabs: [false],
  newtab_recent_tabs_max: [3],
  newtab_links: [[], [{ label: "A", url: "https://a.example/", group: "G" }, { label: "B", url: "http://b.example/" }]],
  open_quick_start_on_install: [true, false],
};

const REFUSES: Record<string, unknown[]> = {
  which_key_delay_ms: [-1, Number.POSITIVE_INFINITY, Number.NaN, "300"],
  which_key_border: ["Square", "", 1],
  hint_letters: ["a", "aa", "aba", 12],
  ignore_sites: ["a.com", [""], [1]],
  next_patterns: ["next", [""], [1]],
  prev_patterns: ["prev", [""], [1]],
  mode_indicator: ["normal", true],
  palette: ["", 1],
  light_intensity: [0, 6, 2.5, "3"],
  search_prefixes: [{ here: "s" }, { here: "s", tab: "" }, { here: "s", tab: "S", extra: "x" }, { reopen: "c", tab: "C" }, ["s", "S"], null],
  container_prefixes: [{ here: "s", tab: "S" }],
  home_page: ["", 1],
  default_engine: [""],
  new_tab_page: ["", "javascript:alert(1)", "ftp://a.example", "https://", "https://a.example:99999/", "about:blank"],
  completion_all_windows: ["true", 1],
  cmdline_prompt: ["", "123456789", "\u{1F600}".repeat(9), "a\nb", "a\rb", 1, true],
  open_completion: [["bookmarks", "bookmarks"], ["tabs"], "history"],
  statusbar_widgets: [["url", "url"], ["clock"], "url"],
  history_completion_max: [-1, 1.5, "10"],
  history_list_max: [-1, 1.5, "10"],
  newtab_clock: ["true", "Analog", 1],
  newtab_date: ["false"],
  newtab_clock_format: [11, "12", 12.0001],
  newtab_bookmarks: [0],
  newtab_bookmarks_max: [-1, 1.5],
  newtab_recent_tabs: ["yes"],
  newtab_recent_tabs_max: [Number.NaN],
  newtab_links: ["x", [{ label: "A", url: "javascript:alert(1)" }], [{ label: "A", url: "https://a.example/", group: "" }], [{ url: "https://a.example/" }]],
  open_quick_start_on_install: [null],
};

test("every setting accepts and refuses the same values", () => {
  assert.deepEqual(Object.keys(ACCEPTS), SETTING_NAMES);
  assert.deepEqual(Object.keys(REFUSES), SETTING_NAMES);
  for (const name of SETTING_NAMES) {
    for (const value of ACCEPTS[name]!) assert.equal(SETTING_SPECS[name].check(value), true, `${name} accepts ${JSON.stringify(value)}`);
    for (const value of REFUSES[name]!) assert.equal(SETTING_SPECS[name].check(value), false, `${name} refuses ${String(JSON.stringify(value))}`);
  }
});

test("a typed word tries text, then number, then true or false", () => {
  assert.deepEqual(parse_setting_words("cmdline_prompt", ["12"]), { value: "12" });
  assert.deepEqual(parse_setting_words("cmdline_prompt", ["false"]), { value: "false" });
  assert.deepEqual(parse_setting_words("newtab_clock_format", ["12"]), { value: 12 });
  assert.deepEqual(parse_setting_words("newtab_clock", ["false"]), { value: false });
  assert.deepEqual(parse_setting_words("completion_all_windows", ["true"]), { value: true });
  // Number() reads more than digits: spaces, hex and exponents pass, an empty word does not.
  assert.deepEqual(parse_setting_words("light_intensity", [" 5"]), { value: 5 });
  assert.deepEqual(parse_setting_words("which_key_delay_ms", ["0x10"]), { value: 16 });
  assert.deepEqual(parse_setting_words("which_key_delay_ms", ["1e3"]), { value: 1000 });
  assert.deepEqual(parse_setting_words("which_key_delay_ms", [""]), { error: "which_key_delay_ms: expected a number of milliseconds, 0 or more" });
  assert.deepEqual(parse_setting_words("which_key_delay_ms", ["Infinity"]), { error: "which_key_delay_ms: expected a number of milliseconds, 0 or more" });
  // Several words join with one space for a single value.
  assert.deepEqual(parse_setting_words("cmdline_prompt", ["a", "b"]), { value: "a b" });
  assert.deepEqual(parse_setting_words("open_completion", ["history", "history"]), { error: 'open_completion: expected a list of "bookmarks" and "history" with no repeat' });
});

test("a bad link names its item and its fault", () => {
  const explain = SETTING_SPECS.newtab_links.explain!;
  assert.equal(explain("x"), "it is not a list of tables");
  assert.equal(explain([]), undefined);
  assert.equal(explain(["x"]), "item 1 is not a table");
  assert.equal(explain([{ label: "A", url: "https://a.example/" }, { label: "B", url: "https://b.example/", note: 1 }]), 'item 2 ("B") has the unknown field "note"');
  assert.equal(explain([{ url: "https://a.example/" }]), 'item 1 needs a non-empty "label"');
  assert.equal(explain([{ label: "A", url: "ftp://a.example/" }]), 'item 1 ("A") needs an http or https "url"');
  assert.equal(explain([{ label: "A", url: "https://a.example/", group: 2 }]), 'item 1 ("A") has an empty or non-text "group"');
});

// The first ten were the defaults before #85. The rest were written at each reader, or were what an absent value read as.
test("the defaults stay the same", () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    which_key_delay_ms: 300,
    which_key_border: "square",
    hint_letters: "asdfghjkl",
    ignore_sites: [],
    next_patterns: ["next", "more", "newer", ">", "\u203a", "\u2192", "\u00bb", "\u226b", ">>"],
    prev_patterns: ["prev", "previous", "older", "<", "\u2039", "\u2190", "\u00ab", "\u226a", "<<"],
    mode_indicator: "always",
    palette: "oasis_moonlight",
    light_intensity: 3,
    search_prefixes: { here: "s", tab: "S" },
    container_prefixes: { reopen: "c", tab: "C" },
    default_engine: "duck",
    new_tab_page: "desertfox",
    completion_all_windows: false,
    cmdline_prompt: "caret",
    open_completion: ["bookmarks", "history"],
    statusbar_widgets: ["url", "scroll", "tabs"],
    history_completion_max: 10,
    history_list_max: 20,
    newtab_clock: true,
    newtab_date: true,
    newtab_clock_format: 12,
    newtab_bookmarks: false,
    newtab_bookmarks_max: 8,
    newtab_recent_tabs: false,
    newtab_recent_tabs_max: 8,
    newtab_links: [],
    open_quick_start_on_install: true,
  });
  assert.equal("home_page" in DEFAULT_SETTINGS, false, "page.home refuses without one");
});

test("the new tab page reads an absent setting as before", async () => {
  assert.deepEqual(enabled_widgets(effective_settings({})), { clock: true, clock_style: "analog", date: true });
  assert.deepEqual(enabled_widgets(effective_settings({ newtab_clock: true, newtab_date: false })), { clock: true, clock_style: "analog", date: false });
  const tabs = Array.from({ length: 12 }, (_, index) => ({ id: index, url: `https://t${index}.example/`, title: `T${index}`, lastAccessed: index, windowId: 1, incognito: false }));
  const readers = { query_tabs: async () => tabs, bookmark_tree: async () => [], page_is_private: async () => false } as never;
  assert.deepEqual(await read_sections(effective_settings({}), readers), []);
  const sections = await read_sections(effective_settings({ newtab_recent_tabs: true }), readers);
  assert.equal(sections[0]?.rows.length, 8);
});

test("the editor schema matches its output before #85, apart from the listed changes", () => {
  const before = JSON.parse(readFileSync(new URL("fixtures/settings/editor_schema_before_85.json", import.meta.url), "utf8"));
  const properties = before.properties;
  // One enum of the four values, the same values as the old boolean-or-word form.
  properties.newtab_clock = { ...properties.newtab_clock, oneOf: undefined, enum: [true, false, "analog", "digital"] };
  // The check refuses an empty pattern, and now the editor does too.
  properties.ignore_sites.items.minLength = 1;
  // Defaults that were written at the readers.
  properties.ignore_sites.default = [];
  properties.new_tab_page.default = "desertfox";
  properties.open_completion.default = ["bookmarks", "history"];
  properties.newtab_links.default = [];
  // A setting added after the fixture.
  properties.history_list_max = (settings_schema().properties as Record<string, unknown>).history_list_max;
  // Settings that had no description.
  const described_now = settings_schema().properties as Record<string, { description: string }>;
  for (const name of ["which_key_delay_ms", "hint_letters", "search_prefixes", "container_prefixes"]) {
    assert.equal(properties[name].description, undefined, name);
    properties[name].description = described_now[name]!.description;
  }
  // Settings added since the fixture was taken.
  for (const name of ["statusbar_widgets", "next_patterns", "prev_patterns"]) properties[name] = JSON.parse(JSON.stringify((settings_schema().properties as Record<string, unknown>)[name]));
  assert.deepEqual(JSON.parse(JSON.stringify(settings_schema())), JSON.parse(JSON.stringify(before)));
});
