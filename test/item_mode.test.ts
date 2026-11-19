// Item mode: its mode state, its keys, the matcher and the setting that starts it.

import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { item_start_for } from "../src/background/page_keymap.ts";
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

test("the item section holds the item keys and, of normal mode, only the tab, page scroll, command line, help, hint, find, follow, jump and gi keys", () => {
  const item = compiled_with().modes.item!;
  for (const key of ["j", "k", "h", "l", "G", "I", "<Escape>", "<C-[>", "J", "K", "<C-d>", "<C-u>", "<C-f>", "<C-b>", ":", "<F1>", "?", "<A-?>", "f", "F", "/", "<C-o>", "<C-i>"]) assert.ok(item.children[key], key);
  assert.deepEqual(Object.keys((item.children["g"] as { children: object }).children).sort(), ["?", "T", "g", "i", "t"], "the g group holds gg, gt, gT, g? and gi");
  for (const group of ["]", "["]) assert.deepEqual(Object.keys((item.children[group] as { children: object }).children), [group], `${group}${group} alone`);
  const semicolons = (branch: { children: Record<string, unknown> }, prefix: string): string[] => Object.entries(branch.children).flatMap(([key, node]) => ((node as { kind: string }).kind === "branch" ? semicolons(node as never, prefix + key) : [prefix + key]));
  assert.deepEqual(semicolons(item.children[";"] as never, ";").sort(), semicolons(compiled_with().modes.normal!.children[";"] as never, ";").sort(), "the whole ; family");
  for (const key of ["o", "t", "<Space>", "x", "d"]) assert.equal(item.children[key], undefined, `${key} goes to the page`);
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
const starts_item_mode = async (storage: never, address: string) => (await item_start_for(storage, address)) !== undefined;

test("a loaded page starts in item mode where the setting is on for its address, and a site row decides first", async () => {
  const off = compiled_with();
  const on = compiled_with({ item_navigator: true });
  const row_on = compiled_with({ site_rules: [{ site: "https://a.test/*", item_navigator: true }] });
  const row_off = compiled_with({ item_navigator: true, site_rules: [{ site: "https://a.test/*", item_navigator: false }] });
  assert.equal(await starts_item_mode(stored(off), "https://a.test/"), false);
  assert.equal(await starts_item_mode(stored(on), "https://a.test/"), true);
  assert.equal(await starts_item_mode(stored(row_on), "https://a.test/"), true);
  assert.equal(await starts_item_mode(stored(row_on), "https://b.test/"), false);
  assert.equal(await starts_item_mode(stored(row_off), "https://a.test/"), false);
  assert.equal(await starts_item_mode(stored(row_off), "https://b.test/"), true);
  assert.equal(await starts_item_mode(stored(undefined), "https://a.test/"), false);
});

test("a page that a row turns all off does not start in item mode", async () => {
  const compiled = compiled_with({ item_navigator: true, site_rules: [{ site: "https://a.test/*", off: true }] });
  assert.equal(await starts_item_mode(stored(compiled), "https://a.test/"), false);
});

test("a page whose row passes or binds j or k in normal mode keeps them for the site and does not start in item mode", async () => {
  const compiled = compiled_with({
    item_navigator: true,
    site_rules: [
      { site: "https://pass.test/*", pass: "j k" },
      { site: "https://only.test/*", only: "f" },
      { site: "https://only_jk.test/*", only: "j k" },
      { site: "https://bind.test/*", bind: { k: { id: "page.send_key", args: { key: "ArrowUp", key_code: 38 } } } },
      { site: "https://other.test/*", pass: "x", bind: { h: { id: "page.send_key", args: { key: "ArrowLeft", key_code: 37 } } } },
    ],
  });
  assert.equal(await starts_item_mode(stored(compiled), "https://pass.test/"), false);
  assert.equal(await starts_item_mode(stored(compiled), "https://only.test/"), false, "an only rule gives every unlisted key to the page");
  assert.equal(await starts_item_mode(stored(compiled), "https://only_jk.test/"), true);
  assert.equal(await starts_item_mode(stored(compiled), "https://bind.test/"), false);
  assert.equal(await starts_item_mode(stored(compiled), "https://other.test/"), true);
  for (const address of ["https://kagi.com/search?q=a", "https://search.brave.com/search?q=a"]) assert.equal(await starts_item_mode(stored(compiled), address), false, address);
});

test("the start carries the item selector of the row whose item keys apply, and none on a page the finder reads", async () => {
  const compiled = compiled_with({ item_navigator: true });
  assert.deepEqual(await item_start_for(stored(compiled), "https://news.ycombinator.com/"), { selector: "tr.athing" });
  assert.deepEqual(await item_start_for(stored(compiled), "https://drive.google.com/drive/my-drive"), { selector: '[role="grid"] [role="gridcell"][data-id], [role="grid"] [role="row"][data-id]' });
  assert.deepEqual(await item_start_for(stored(compiled), "https://a.test/"), {});
});

test("the shipped item rows start their pages in item mode with the setting off, the rows that give j and k to the site do not, and a user row turns a site off", async () => {
  const shipped = compiled_with();
  for (const address of ["https://www.google.com/search?q=a", "https://news.ycombinator.com/", "https://www.reddit.com/r/a/", "https://drive.google.com/drive/my-drive", "https://duckduckgo.com/?q=a"]) assert.notEqual(await item_start_for(stored(shipped), address), undefined, address);
  for (const address of ["https://kagi.com/search?q=a", "https://search.brave.com/search?q=a", "https://www.google.com/maps/place/a", "https://a.test/"]) assert.equal(await item_start_for(stored(shipped), address), undefined, address);
  const turned_off = compiled_with({ site_rules: [{ site: "https://news.ycombinator.com/*", item_navigator: false }] });
  assert.equal(await item_start_for(stored(turned_off), "https://news.ycombinator.com/"), undefined);
  assert.equal(await item_start_for(stored(compiled_with({ default_site_rows_off: ["hackernews"] })), "https://news.ycombinator.com/"), undefined);
  for (const { name, row } of DEFAULT_SITE_ROWS) assert.equal("item_navigator" in row, row.keymap?.item !== undefined, name);
});
