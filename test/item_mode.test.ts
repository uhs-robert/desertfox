// Item mode: its mode state, its keys, the matcher and the setting that starts it.

import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { item_start_wanted } from "../src/background/page_keymap.ts";
import { create_mode_state, fullscreen_step } from "../src/content/mode_state.ts";
import type { Mode } from "../src/shared/command.ts";
import { MODES } from "../src/shared/command.ts";
import { create_matcher } from "../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { mode_label } from "../src/content/ui/mode_label.ts";

const compiled_with = (settings: Record<string, unknown> = {}) => {
  const { compiled, warnings } = compile_config({ config: { ...empty_config(), settings: settings as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
  assert.deepEqual(warnings, []);
  return compiled;
};

test("the item step takes only a frame in normal mode into item mode and only item mode out, and media mode keeps its own step", () => {
  for (const mode of MODES) {
    assert.equal(fullscreen_step(mode, true, "item"), mode === "normal" ? "item" : undefined, `enter from ${mode}`);
    assert.equal(fullscreen_step(mode, false, "item"), mode === "item" ? "normal" : undefined, `leave from ${mode}`);
  }
  // A step off for item mode leaves a frame in media mode alone, and the other way round.
  assert.equal(fullscreen_step("media", false, "item"), undefined);
  assert.equal(fullscreen_step("item", false), undefined);
});

test("item mode follows the focus into a field and ends there, as media mode does", () => {
  const state = create_mode_state();
  state.set_mode_("item");
  state.focus_entered_editable_();
  assert.equal(state.get_mode_(), "insert");
  state.focus_left_editable_();
  assert.equal(state.get_mode_(), "normal", "leaving the field goes to normal, and the tab hold has ended by then");
});

test("a step ends item mode in a frame in item mode and leaves a frame in a field alone", () => {
  const state = create_mode_state();
  state.set_mode_("item");
  assert.equal(state.media_ended_(undefined, "item"), "normal");
  state.set_mode_("insert");
  assert.equal(state.media_ended_(undefined, "item"), undefined);
});

test("Escape ends item mode, and hint and command line mode return to it", () => {
  const state = create_mode_state();
  const from = (start: Mode, via: Mode[]): Mode => {
    state.set_mode_(start);
    for (const mode of via) state.set_mode_(mode);
    state.escape();
    return state.get_mode_();
  };
  assert.equal(from("item", []), "normal");
  assert.equal(from("item", ["cmdline"]), "item");
  assert.equal(from("item", ["hint"]), "item");
  assert.equal(from("item", ["hint", "cmdline"]), "item");
  assert.equal(from("normal", ["cmdline"]), "normal");
});

test("a step that ended the mode while a line was open sends the line back to normal", () => {
  const state = create_mode_state();
  state.set_mode_("item");
  state.set_mode_("cmdline");
  assert.equal(state.media_ended_(undefined, "item"), undefined, "a frame with a line open stays in it");
  state.escape();
  assert.equal(state.get_mode_(), "normal");
});

test("the item section holds the item keys and, of normal mode, only the tab, page scroll, command line and help keys", () => {
  const item = compiled_with().modes.item!;
  for (const key of ["j", "k", "h", "l", "G", "I", "<Escape>", "<C-[>", "J", "K", "<C-d>", "<C-u>", "<C-f>", "<C-b>", ":", "<F1>", "?", "<A-?>"]) assert.ok(item.children[key], key);
  assert.deepEqual(Object.keys((item.children["g"] as { children: object }).children).sort(), ["?", "T", "g", "t"], "the g group holds gg, gt, gT and g?");
  for (const key of ["f", ";", "/", "o", "t", "<Space>", "]", "x"]) assert.equal(item.children[key], undefined, `${key} goes to the page`);
  assert.deepEqual(DEFAULT_KEYMAP.normal?.I, { id: "mode.set", args: { mode: "item" }, label: "Item mode" });
});

test("every item key runs a command that allows item mode, and compiling the default keymap warns of nothing", () => {
  for (const [key, binding] of Object.entries(DEFAULT_KEYMAP.item ?? {})) {
    for (const step of [binding].flat() as { id: string }[]) assert.ok((registry.get(step.id)?.modes ?? ["normal"]).includes("item"), `${key} -> ${step.id}`);
  }
  assert.ok(compiled_with().modes.item);
});

test("normal mode j and k scroll again with the setting on, and item mode walks the items", () => {
  const compiled = compiled_with({ item_navigator: true });
  const first_step = (mode: "normal" | "item", key: string) => (compiled.modes[mode]!.children[key] as { steps: { invocation: { id: string } }[] }).steps[0]!.invocation.id;
  assert.deepEqual(["j", "k", "h", "l"].map((key) => first_step("normal", key)), ["scroll.lines", "scroll.lines", "scroll.pixels", "scroll.pixels"]);
  assert.deepEqual(["j", "k", "h", "l"].map((key) => first_step("item", key)), ["page.item", "page.item", "page.item", "page.item"]);
  assert.equal(compiled.site_rules?.some((rule) => rule.origin === "default" && rule.name === "item_navigator"), false, "no row of the setting remains");
});

test("the matcher reads counts in item mode and takes a quote as an ordinary key", () => {
  const matcher = create_matcher(compiled_with());
  assert.equal(matcher.feed("item", "3").kind_, "pending");
  const counted = matcher.feed("item", "j");
  assert.equal(counted.kind_ === "match" && counted.count, 3);
  assert.equal(matcher.feed("item", '"').kind_, "no_match", "no register in item mode");
});

test("the badge says ITEM", () => {
  assert.equal(mode_label("item", false, "always"), "ITEM");
});

const stored = (compiled: unknown) => ({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: compiled }) }) as never;

test("a loaded page starts in item mode where the setting is on for its address, and a site row decides first", async () => {
  const off = compiled_with();
  const on = compiled_with({ item_navigator: true });
  const row_on = compiled_with({ site_rules: [{ site: "https://a.test/*", item_navigator: true }] });
  const row_off = compiled_with({ item_navigator: true, site_rules: [{ site: "https://a.test/*", item_navigator: false }] });
  assert.equal(await item_start_wanted(stored(off), "https://a.test/"), false);
  assert.equal(await item_start_wanted(stored(on), "https://a.test/"), true);
  assert.equal(await item_start_wanted(stored(row_on), "https://a.test/"), true);
  assert.equal(await item_start_wanted(stored(row_on), "https://b.test/"), false);
  assert.equal(await item_start_wanted(stored(row_off), "https://a.test/"), false);
  assert.equal(await item_start_wanted(stored(row_off), "https://b.test/"), true);
  assert.equal(await item_start_wanted(stored(undefined), "https://a.test/"), false);
});

test("a page that a row turns all off does not start in item mode", async () => {
  const compiled = compiled_with({ item_navigator: true, site_rules: [{ site: "https://a.test/*", off: true }] });
  assert.equal(await item_start_wanted(stored(compiled), "https://a.test/"), false);
});
