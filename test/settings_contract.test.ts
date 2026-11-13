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
  toast_ms: "a whole number of milliseconds, from 500 to 30000",
  toast_error_ms: "a whole number of milliseconds, from 500 to 30000",
  which_key_repeat: "true or false",
  which_key_border: '"square", "round" or "chamfer"',
  which_key_skip: "a list of key prefixes in keymap notation",
  hint_letters: "a string of 2 or more distinct letters, without /",
  hint_key_line: "true or false",
  hint_add: "a list of CSS selectors",
  hint_remove: "a list of CSS selectors",
  blur_on_load: "true or false",
  editable_add: "a list of CSS selectors",
  editable_remove: "a list of CSS selectors",
  editable_remove_unsized: "true or false",
  escape_to_page: "true or false",
  scroll_selector: "a CSS selector, or empty for none",
  site_rules: 'a list of tables with "site", an optional "off" of true or false, an optional "pass" of key sequences, an optional "only" of key sequences, an optional "bind" of keys to commands, an optional "modes" of modes that each have a label plus a bind and any per-site setting',
  default_site_rows_off: 'a list of "sheets" with no repeat',
  next_patterns: "a list of link texts",
  prev_patterns: "a list of link texts",
  strip_tracking_params: "a list of query parameter names",
  strip_tracking: "true or false",
  zoom: "a number, from 0.3 to 5",
  media_quality: '"off", "auto", "max", "min", 144, 240, 360, 480, 720, 1080, 1440, 2160 or 4320',
  editor_ext: "a file extension of up to 10 letters or digits, without a dot, or empty for none",
  layout_fallback: "true or false",
  mode_indicator: '"always", "not_normal" or "off"',
  theme: "a theme name",
  light_intensity: "a whole number from 1 to 5",
  search_prefixes: '{"here": "...", "tab": "..."} with non-empty strings',
  container_prefixes: '{"reopen": "...", "tab": "..."} with non-empty strings',
  home_page: "a non-empty URL string",
  default_engine: "the name of a search engine",
  new_tab_page: '"desertfox" or an http or https URL',
  bridge: "true or false",
  bridge_share_tabs: "true or false",
  host_auto_update: "true or false",
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
};

test("every setting keeps its expectation text, in the declared order", () => {
  assert.deepEqual(SETTING_NAMES, Object.keys(EXPECTATIONS));
  for (const name of SETTING_NAMES) assert.equal(SETTING_SPECS[name].expectation, EXPECTATIONS[name], name);
});

test("every setting keeps its listed values", () => {
  const listed = Object.fromEntries(SETTING_NAMES.map((name) => [name, SETTING_SPECS[name].listed_values?.()]).filter(([, values]) => values !== undefined));
  const { theme, ...rest } = listed as Record<string, readonly string[]>;
  assert.ok(theme?.includes("oasis_moonlight"));
  assert.deepEqual(rest, {
    which_key_repeat: ["true", "false"],
    which_key_border: ["square", "round", "chamfer"],
    layout_fallback: ["true", "false"],
    mode_indicator: ["always", "not_normal", "off"],
    light_intensity: ["1", "2", "3", "4", "5"],
    new_tab_page: ["desertfox"],
    hint_key_line: ["true", "false"],
    blur_on_load: ["true", "false"],
    media_quality: ["off", "auto", "max", "min", "144", "240", "360", "480", "720", "1080", "1440", "2160", "4320"],
    editable_remove_unsized: ["true", "false"],
    escape_to_page: ["true", "false"],
    strip_tracking: ["true", "false"],
    bridge: ["true", "false"],
    bridge_share_tabs: ["true", "false"],
    host_auto_update: ["true", "false"],
    completion_all_windows: ["true", "false"],
    cmdline_prompt: ["caret", "colon"],
    open_completion: ["bookmarks", "history"],
    statusbar_widgets: ["url", "scroll", "tabs"],
    default_site_rows_off: ["sheets"],
    newtab_clock: ["true", "false", "analog", "digital"],
    newtab_date: ["true", "false"],
    newtab_clock_format: ["12", "24"],
    newtab_bookmarks: ["true", "false"],
    newtab_recent_tabs: ["true", "false"],
  });
});

test("the list, unsettable and toggle sets stay the same", () => {
  assert.deepEqual(SETTING_NAMES.filter((name) => SETTING_SPECS[name].is_list), ["which_key_skip", "hint_add", "hint_remove", "editable_add", "editable_remove", "default_site_rows_off", "next_patterns", "prev_patterns", "strip_tracking_params", "open_completion", "statusbar_widgets"]);
  assert.deepEqual(SETTING_NAMES.filter((name) => !SETTING_SPECS[name].settable), ["search_prefixes", "container_prefixes"]);
  // A toggle flips the value in force, so an absent one flips from its default.
  const toggles = Object.fromEntries(SETTING_NAMES.filter((name) => SETTING_SPECS[name].is_toggle).map((name) => [name, DEFAULT_SETTINGS[name]]));
  assert.deepEqual(toggles, { hint_key_line: true, which_key_repeat: true, blur_on_load: false, editable_remove_unsized: false, escape_to_page: false, strip_tracking: true, layout_fallback: true, bridge: false, bridge_share_tabs: false, host_auto_update: false, completion_all_windows: false, newtab_date: true, newtab_bookmarks: false, newtab_recent_tabs: false });
});

const ACCEPTS: Record<string, unknown[]> = {
  which_key_delay_ms: [0, 0.5, 300],
  toast_ms: [500, 3000, 30000],
  toast_error_ms: [500, 6000, 30000],
  which_key_repeat: [true, false],
  which_key_border: ["square", "round", "chamfer"],
  which_key_skip: [[], ["g", ",", "<C-w>"]],
  hint_letters: ["ab", "asdfghjkl", "12"],
  hint_key_line: [true, false],
  hint_add: [[], [".card", "div[role=row]"]],
  hint_remove: [[], ["nav"]],
  blur_on_load: [true, false],
  editable_add: [[], ["div.cell"]],
  editable_remove: [[], ["#editor"]],
  editable_remove_unsized: [true, false],
  escape_to_page: [true, false],
  scroll_selector: ["", "#pane", ".kix-appview-editor"],
  site_rules: [[], [{ site: "*://a.com/*" }, { site: "*://b.com/*", pass: "j k <C-d> gg" }, { site: "*://c.com/*", only: "<A-j>" }], [{ site: "*://a.com/*", off: true, pass: "j" }, { site: "*://b.com/*", off: false }], [{ site: "*://a.com/*", bind: { h: { id: "page.send_key", args: { key: "ArrowLeft", key_code: 37 } }, gx: { id: "scroll.top" } } }], [{ site: "*://a.com/*", bind: { h: "scroll top", G: ["scroll top", { id: "scroll.top", label: "Top" }], x: { run: ["a", "b"], label: "Both", intent: "Does both" }, y: Array(20).fill("x") } }], [{ site: "*://a.com/*", zoom: 1.5 }], [{ site: "*://a.com/*", blur_on_load: true }], [{ site: "*://a.com/*", escape_to_page: true }], [{ site: "*://a.com/*", strip_tracking: false }, { site: "*://b.com/*", strip_tracking: true }], [{ site: "*://a.com/*", scroll_selector: "#pane" }], [{ site: "*://a.com/*", editable_add: ["div"], editable_remove: ["#e"], editable_remove_unsized: true }], [{ site: "*://a.com/*", hint_add: [".card"], hint_remove: [] }], [{ site: "*://a.com/*", media_quality: "auto" }, { site: "*://b.com/*", media_quality: 720 }]],
  default_site_rows_off: [[], ["sheets"]],
  next_patterns: [[], ["next", ">"]],
  prev_patterns: [[], ["prev", "<"]],
  strip_tracking_params: [[], ["utm_*", "fbclid"]],
  strip_tracking: [true, false],
  zoom: [0.3, 1, 1.25, 5],
  media_quality: ["off", "auto", "max", "min", 144, 480, 720, 1080, 4320],
  editor_ext: ["", "md", "py", "txt", "Mp4", "abcdefghij"],
  layout_fallback: [true, false],
  mode_indicator: ["always", "not_normal", "off"],
  theme: ["oasis_moonlight", "no_such_theme"],
  light_intensity: [1, 5],
  search_prefixes: [{ here: "s", tab: "S" }, { tab: "T", here: "h" }],
  container_prefixes: [{ reopen: "c", tab: "C" }],
  home_page: ["desertfox", "x"],
  default_engine: ["duck"],
  new_tab_page: ["desertfox", "https://a.example/", "HTTP://A.EXAMPLE"],
  bridge: [true, false],
  bridge_share_tabs: [true, false],
  host_auto_update: [true, false],
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
};

const REFUSES: Record<string, unknown[]> = {
  which_key_delay_ms: [-1, Number.POSITIVE_INFINITY, Number.NaN, "300"],
  toast_ms: [499, 30001, 1000.5, "3000"],
  toast_error_ms: [499, 30001, 1000.5, "6000"],
  which_key_repeat: ["true", 1],
  which_key_border: ["Square", "", 1],
  which_key_skip: ["g", [""], ["<S-1>"], ["g", "<a>"]],
  hint_letters: ["a", "aa", "aba", "a/b", 12],
  hint_key_line: ["true", 1],
  // The check cannot parse a selector without a page, so a bad one is a notice when hints start.
  hint_add: [".card", [""], [1]],
  hint_remove: ["nav", [""], [1]],
  blur_on_load: ["true", 1],
  editable_add: ["div", [""], [1]],
  editable_remove: ["div", [""], [1]],
  editable_remove_unsized: ["true", 1],
  escape_to_page: ["true", 1],
  scroll_selector: [1, true, ["#a"]],
  site_rules: [
    "a.com", [""], [{}], [{ site: "a" , pass: "j", only: "k" }], [{ site: "a", pass: "" }], [{ site: "a", pass: "   " }], [{ site: "a", only: "<j>" }], [{ site: "a", keys: "j" }], [{ site: "a", pass: 1 }], [{ site: "a", off: "true" }], [{ site: "a", off: 1 }], [{ site: "a", bind: {} }], [{ site: "a", bind: "h" }], [{ site: "a", bind: { "<a>": { id: "x" } } }], [{ site: "a", bind: { h: "" } }], [{ site: "a", bind: { h: [] } }], [{ site: "a", bind: { h: ["x", 1] } }], [{ site: "a", bind: { h: {} } }], [{ site: "a", bind: { h: { id: "x", args: "y" } } }], [{ site: "a", bind: { h: { id: "x", extra: "y" } } }], [{ site: "a", bind: { h: { run: "x", extra: "y" } } }], [{ site: "a", bind: { h: { run: "x", label: 1 } } }], [{ site: "a", bind: { h: Array(21).fill("x") } }], [{ site: "a", zoom: 9 }], [{ site: "a", no_such_setting: 2 }], [{ site: "a", blur_on_load: "yes" }], [{ site: "a", escape_to_page: "yes" }], [{ site: "a", strip_tracking: "yes" }], [{ site: "a", scroll_selector: 1 }], [{ site: "a", editable_add: [""] }], [{ site: "a", editable_remove: "x" }], [{ site: "a", editable_remove_unsized: "yes" }], [{ site: "a", hint_add: [""] }], [{ site: "a", hint_remove: "nav" }], [{ site: "a", media_quality: "high" }], [{ site: "a", media_quality: 500 }],
  ],
  default_site_rows_off: ["sheets", ["other"], ["sheets", "sheets"], [1]],
  next_patterns: ["next", [""], [1]],
  prev_patterns: ["prev", [""], [1]],
  strip_tracking_params: ["utm_*", [""], [1]],
  strip_tracking: ["true", 1],
  zoom: [0.2, 5.5, Number.NaN, "1.5"],
  media_quality: ["", "high", "1080", "1080p", "Max", 0, 500, 1081, -720, 1.5, Number.NaN, true, ["max"]],
  editor_ext: [1, true, ["md"], ".md", "../x", "abcdefghijk", "m d"],
  layout_fallback: ["true", 1],
  mode_indicator: ["normal", true],
  theme: ["", 1],
  light_intensity: [0, 6, 2.5, "3"],
  search_prefixes: [{ here: "s" }, { here: "s", tab: "" }, { here: "s", tab: "S", extra: "x" }, { reopen: "c", tab: "C" }, ["s", "S"], null],
  container_prefixes: [{ here: "s", tab: "S" }],
  home_page: ["", 1],
  default_engine: [""],
  new_tab_page: ["", "javascript:alert(1)", "ftp://a.example", "https://", "https://a.example:99999/", "about:blank"],
  bridge: ["true", 1],
  bridge_share_tabs: ["true", 1],
  host_auto_update: ["true", 1],
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

test("a bad site rule names its item and its fault", () => {
  const explain = SETTING_SPECS.site_rules.explain!;
  assert.equal(explain([{ site: "*://a.test/*" }, { site: "*://b.test/*", pass: "j", only: "k" }]), 'item 2 sets both "pass" and "only", and only one may be set');
  assert.equal(explain([{ site: "*://a.test/*", pass: " " }]), 'item 1 has a field "pass" that lists no key');
  assert.match(explain([{ site: "*://a.test/*", only: "j <j>" }])!, /^item 1 has a field "only" that has "<j>", which /);
  assert.equal(explain([{ pass: "j" }]), 'item 1 needs a non-empty "site"');
  assert.equal(explain([{ site: "*://a.test/*", off: "yes" }]), 'item 1 has a field "off" that is not true or false');
  assert.equal(explain([{ site: "*://a.test/*", bind: { h: {} } }]), 'item 1 has a field "bind" that binds "h" to something that has a step that is neither a command string nor a table with an "id"');
  assert.match(explain([{ site: "*://a.test/*", bind: { h: Array(21).fill("x") } }])!, /binds "h" to something that has more than 20 steps$/);
  assert.match(explain([{ site: "*://a.test/*", bind: { "<a>": { id: "x" } } }])!, /^item 1 has a field "bind" that binds "<a>", which /);
});

// The first ten were the defaults before #85. The rest were written at each reader, or were what an absent value read as.
test("the defaults stay the same", () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    which_key_delay_ms: 300,
    toast_ms: 3000,
    toast_error_ms: 6000,
    which_key_repeat: true,
    which_key_border: "square",
    which_key_skip: [],
    hint_letters: "asdfghjkl",
    hint_key_line: true,
    hint_add: [],
    hint_remove: [],
    blur_on_load: false,
    editable_add: [],
    editable_remove: [],
    editable_remove_unsized: false,
    escape_to_page: false,
    scroll_selector: "",
    site_rules: [],
    default_site_rows_off: [],
    next_patterns: ["next", "more", "newer", ">", "\u203a", "\u2192", "\u00bb", "\u226b", ">>"],
    prev_patterns: ["prev", "previous", "older", "<", "\u2039", "\u2190", "\u00ab", "\u226a", "<<"],
    strip_tracking_params: ["utm_*", "fbclid", "gclid", "dclid", "msclkid", "mc_eid", "igshid", "yclid", "_hsenc", "_hsmi", "mkt_tok"],
    strip_tracking: true,
    layout_fallback: true,
    mode_indicator: "always",
    theme: "oasis_moonlight",
    light_intensity: 3,
    media_quality: "auto",
    editor_ext: "",
    search_prefixes: { here: "s", tab: "S" },
    container_prefixes: { reopen: "c", tab: "C" },
    default_engine: "duck",
    new_tab_page: "desertfox",
    bridge: false,
    bridge_share_tabs: false,
    host_auto_update: false,
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
  });
  assert.equal("home_page" in DEFAULT_SETTINGS, false, "page.home refuses without one");
  assert.equal("zoom" in DEFAULT_SETTINGS, false, "a default would override Firefox's zoom memory on every site");
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
  // `ignore_sites` became `site_rules`.
  delete properties.ignore_sites;
  properties.site_rules = (settings_schema().properties as Record<string, unknown>).site_rules;
  // Defaults that were written at the readers.
  properties.new_tab_page.default = "desertfox";
  properties.open_completion.default = ["bookmarks", "history"];
  properties.newtab_links.default = [];
  // A setting added after the fixture.
  properties.history_list_max = (settings_schema().properties as Record<string, unknown>).history_list_max;
  // `palette` became `theme`, and `desktop` joined its examples and description.
  delete properties.palette;
  properties.theme = JSON.parse(JSON.stringify((settings_schema().properties as Record<string, unknown>).theme));
  // Removed: no setting can turn the first-install Quick Start page off.
  delete properties.open_quick_start_on_install;
  // Settings added since the fixture was taken.
  for (const name of ["statusbar_widgets", "next_patterns", "prev_patterns", "bridge", "bridge_share_tabs", "host_auto_update", "hint_key_line", "which_key_repeat", "zoom", "blur_on_load", "editable_add", "editable_remove", "editable_remove_unsized", "escape_to_page", "scroll_selector", "hint_add", "hint_remove", "default_site_rows_off", "media_quality", "strip_tracking_params", "strip_tracking", "editor_ext", "layout_fallback", "which_key_skip", "toast_ms", "toast_error_ms"]) properties[name] = JSON.parse(JSON.stringify((settings_schema().properties as Record<string, unknown>)[name]));
  // #620 rewrote every description for a first-time reader.
  const described_now = settings_schema().properties as Record<string, { description: string }>;
  for (const [name, property] of Object.entries(properties as Record<string, { description?: string | undefined }>)) property.description = described_now[name]?.description;
  assert.deepEqual(JSON.parse(JSON.stringify(settings_schema())), JSON.parse(JSON.stringify(before)));
});
