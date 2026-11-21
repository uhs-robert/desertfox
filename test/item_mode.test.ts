// Item mode: its mode state, its keys, the matcher and the setting that starts it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { item_start_for } from "../src/background/page_keymap.ts";
import { with_item_landings } from "../src/background/item_landings.ts";
import { create_mode_state, fullscreen_step } from "../src/content/mode_state.ts";
import type { Mode } from "../src/shared/command.ts";
import { MODES } from "../src/shared/command.ts";
import { create_matcher } from "../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { check_args } from "../src/shared/registry/check_args.ts";
import { mode_label } from "../src/content/ui/mode_label.ts";

const compiled_with = (settings: Record<string, unknown> = {}) => {
  const { compiled, warnings } = compile_config({ config: { ...empty_config(), settings: settings as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
  assert.deepEqual(warnings, []);
  return compiled;
};

test("the item step takes a frame in normal or media mode into item mode and only item mode out, and media mode keeps its own step", () => {
  for (const mode of MODES) {
    assert.equal(fullscreen_step(mode, true, "item"), mode === "normal" || mode === "media" ? "item" : undefined, `enter from ${mode}`);
    assert.equal(fullscreen_step(mode, false, "item"), mode === "item" || mode === "item_visual" ? "normal" : undefined, `leave from ${mode}`);
  }
  // A step off for item mode leaves a frame in media mode alone, and the other way round.
  assert.equal(fullscreen_step("media", false, "item"), undefined);
  assert.equal(fullscreen_step("item", false), undefined);
});

test("a media step of another frame takes a frame in item mode, and Escape in media mode that began there goes back to item mode", () => {
  assert.equal(fullscreen_step("item", true, "media"), "media");
  assert.equal(fullscreen_step("item", true, "item"), undefined);
  assert.equal(fullscreen_step("media", true, "item"), "item", "the step back to item reaches a frame still in media mode");
  assert.equal(fullscreen_step("insert", true, "media"), undefined);
  const state = create_mode_state();
  state.set_mode_("item");
  state.set_mode_("media");
  state.set_mode_("cmdline");
  state.escape();
  assert.equal(state.get_mode_(), "media");
  state.escape();
  assert.equal(state.get_mode_(), "item");
  state.escape();
  assert.equal(state.get_mode_(), "normal");
  state.set_mode_("media");
  state.escape();
  assert.equal(state.get_mode_(), "normal", "media from normal goes back to normal");
});

// A frame applies a step the way main.ts media_step does: on a step on it takes the mode the step brings, on a step off it ends the held mode.
const apply_step = (state: ReturnType<typeof create_mode_state>, on: boolean, held: Mode) => {
  const next = on ? fullscreen_step(state.get_mode_(), true, held) : state.media_ended_(undefined, held);
  if (next) state.set_mode_(next);
};

test("a sibling frame ends in item mode when the item step and the media step off arrive in either order", () => {
  for (const item_first of [true, false]) {
    const sibling = create_mode_state();
    sibling.set_mode_("item");
    apply_step(sibling, true, "media");
    assert.equal(sibling.get_mode_(), "media");
    if (item_first) {
      apply_step(sibling, true, "item");
      apply_step(sibling, false, "media");
    } else {
      apply_step(sibling, false, "media");
      apply_step(sibling, true, "item");
    }
    assert.equal(sibling.get_mode_(), "item", item_first ? "item step first" : "media step off first");
  }
});

test("Escape reports as the frame's own change and nothing else does", () => {
  const state = create_mode_state();
  const seen: boolean[] = [];
  state.listen(() => seen.push(state.is_escaping_()));
  state.set_mode_("item");
  state.set_mode_("media");
  state.escape();
  assert.deepEqual(seen, [false, false, true]);
  assert.equal(state.is_escaping_(), false);
});

test("main.ts clears the step flag of a report that Escape causes", () => {
  const text = readFileSync("src/content/main.ts", "utf8");
  assert.match(text, /if \(\(mode !== "media" && mode !== "item"\) \|\| page_mode\.is_escaping_\(\)\) media_by_step = false;/);
});

test("an own fullscreen from item mode starts media mode and its end goes to normal mode", () => {
  const state = create_mode_state();
  state.set_mode_("item");
  const next = fullscreen_step(state.get_mode_(), true, "media");
  assert.equal(next, "media");
  state.set_mode_(next!);
  assert.equal(state.media_ended_(true, undefined), "normal");
});

test("a field that ends media mode drops the item origin, so a later media mode from normal ends in normal", () => {
  const state = create_mode_state();
  state.set_mode_("item");
  state.set_mode_("media");
  state.focus_entered_editable_();
  assert.equal(state.get_mode_(), "insert");
  state.focus_left_editable_();
  assert.equal(state.get_mode_(), "normal");
  state.set_mode_("media");
  state.escape();
  assert.equal(state.get_mode_(), "normal");
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

test("the item section holds the item keys and, of normal mode, only the tab, page scroll, command line, help, hint, find, follow, jump, gi, media, insert, caret, visual, find repeat, ignore and pass-next keys", () => {
  const item = compiled_with().modes.item!;
  for (const key of ["j", "k", "h", "l", "G", "I", "<Escape>", "<C-[>", "J", "K", "<C-d>", "<C-u>", "<C-f>", "<C-b>", ":", "<F1>", "?", "<A-?>", "f", "F", "/", "<C-o>", "<C-i>", "H", "L", "i", "v", "V", "n", "N", "*", "#", "A", "<S-Escape>", "<C-v>", ","]) assert.ok(item.children[key], key);
  assert.deepEqual(Object.keys((item.children["g"] as { children: object }).children).sort(), ["?", "T", "V", "g", "i", "t"], "the g group holds gg, gt, gT, g?, gi and gV");
  for (const group of ["]", "["]) assert.deepEqual(Object.keys((item.children[group] as { children: object }).children), [group], `${group}${group} alone`);
  const semicolons = (branch: { children: Record<string, unknown> }, prefix: string): string[] => Object.entries(branch.children).flatMap(([key, node]) => ((node as { kind: string }).kind === "branch" ? semicolons(node as never, prefix + key) : [prefix + key]));
  assert.deepEqual(semicolons(item.children[";"] as never, ";").sort(), semicolons(compiled_with().modes.normal!.children[";"] as never, ";").filter((key) => key !== ";fF" && key !== ";fe").sort(), "the ; family but the normal-only keys");
  assert.deepEqual(Object.keys((item.children["a"] as { children: object }).children).sort(), ["P", "S", "V", "a", "f", "h", "l", "m", "p", "r", "s", "v"], "the a media group");
  for (const key of ["o", "t", "x", "d"]) assert.equal(item.children[key], undefined, `${key} goes to the page`);
});

const step_ids = (node: unknown): string[] => (node as { steps: { invocation: { id: string } }[] }).steps.map((step) => step.invocation.id);

test("Space toggles the current item's checkbox and Enter opens its link", () => {
  const item = compiled_with().modes.item!;
  const action = (key: string) => (item.children[key] as { steps: { invocation: { id: string; args: Record<string, unknown> }; bundle?: string }[] }).steps[0]!;
  assert.deepEqual([action("<Space>").invocation.id, action("<Space>").invocation.args["action"], action("<Space>").bundle], ["page.item_action", "toggle", "item_act"]);
  assert.deepEqual([action("<Enter>").invocation.id, action("<Enter>").invocation.args["action"]], ["page.item_action", "open"]);
  assert.equal(compiled_with().modes.normal!.children["<Space>"], undefined, "normal mode keeps Space for the page");
});

test("Tab and Shift-Tab of item mode step the focus inside the item, and normal mode keeps them for the page", () => {
  const item = compiled_with().modes.item!;
  const action = (key: string) => (item.children[key] as { steps: { invocation: { id: string; args: Record<string, unknown> }; bundle?: string }[] }).steps[0]!;
  assert.deepEqual([action("<Tab>").invocation.id, action("<Tab>").invocation.args["direction"], action("<Tab>").bundle], ["page.item_focus", "next", "item_act"]);
  assert.deepEqual([action("<S-Tab>").invocation.id, action("<S-Tab>").invocation.args["direction"]], ["page.item_focus", "prev"]);
  assert.equal(compiled_with().modes.normal!.children["<Tab>"], undefined);
});

// The item section copies the hint keys as they are: the hints rank the item at run time, by mode.
test("hint keys of item mode are the normal-mode steps, and ;fF and ;fe stay out of it", () => {
  const compiled = compiled_with();
  const leaves = (node: { kind: string; children?: Record<string, unknown> }, prefix: string): [string, { steps: { invocation: { id: string; args?: Record<string, unknown> } }[] }][] =>
    node.kind === "branch" ? Object.entries(node.children!).flatMap(([key, child]) => leaves(child as never, prefix + key)) : [[prefix, node as never]];
  const hint_keys = leaves(compiled.modes.item as never, "").filter(([, leaf]) => leaf.steps.some((step) => step.invocation.id === "hint.run" && step.invocation.args?.["filter"] !== "lists"));
  assert.ok(hint_keys.length > 40, `${hint_keys.length} hint keys`);
  for (const [key, leaf] of hint_keys) for (const step of leaf.steps.filter((step) => step.invocation.id === "hint.run")) assert.equal(step.invocation.args?.["scope"], undefined, key);
  const typed = (key: string) => String(leaves(compiled.modes.item as never, "").find(([found]) => found === key)?.[1].steps[0]?.invocation.args?.["text"]);
  assert.deepEqual([typed(";;"), typed(";u")], ["hint ", "hint --custom "], "the typed hint commands are the normal ones");
  assert.ok(hint_keys.some(([key]) => key === ";Bl"), ";Bl is a hint key of item mode");
  for (const key of [";fF", ";fe"]) assert.ok(!hint_keys.some(([found]) => found === key), `${key} is not an item key`);
});

test("I hints the lists and lands on the pick, in normal mode and in item mode, and ;j is gone", () => {
  const compiled = compiled_with();
  for (const mode of ["normal", "item"] as const) assert.deepEqual(step_ids(compiled.modes[mode]!.children["I"]), ["hint.run", "page.item"], mode);
  const hint_step = (compiled.modes.normal!.children["I"] as { steps: { invocation: { args: Record<string, unknown> } }[] }).steps[0]!.invocation;
  assert.deepEqual([hint_step.args["filter"], hint_step.args["action"], hint_step.args["items"]], ["lists", "enter_item", ""]);
  for (const mode of ["normal", "media", "item"] as const) assert.equal(((compiled.modes[mode]!.children[";"] as { children: Record<string, unknown> }).children)["j"], undefined, `${mode} has no ;j`);
});

test("H and L keep history back and forward in item mode", () => {
  const compiled = compiled_with();
  for (const [key, id] of [["H", "page.back"], ["L", "page.forward"]] as const) assert.deepEqual(step_ids(compiled.modes.item!.children[key]), [id], key);
});

test("zt, zz and zb in item mode go back to the current item and then scroll it", () => {
  const compiled = compiled_with();
  for (const key of ["zt", "zz", "zb"]) assert.deepEqual(step_ids((compiled.modes.item!.children["z"] as { children: Record<string, unknown> }).children[key.slice(1)]), ["page.item", "scroll.align"], key);
});

test("a row with an item selector and no } or { gets guarded section jumps, and its own } and { stay", () => {
  const down = { id: "page.item", args: { selector: "li.hit", direction: "down" } };
  const plain = with_item_landings({ site: "https://example.org/*", keymap: { item: { j: down } } } as never).keymap?.["item"] as Record<string, { when_present?: string; args?: Record<string, unknown> }>;
  for (const [key, direction] of [["}", "next_section"], ["{", "prev_section"]] as const) assert.deepEqual([plain[key]?.when_present, plain[key]?.args], ["li.hit", { selector: "li.hit", direction }], key);
  const rich = with_item_landings({ site: "https://example.org/*", keymap: { item: { j: { id: "page.item", args: { selector: "li.hit", link: "a.t", hover: true, direction: "down" } } } } } as never).keymap?.["item"] as Record<string, { args?: Record<string, unknown> }>;
  assert.deepEqual(rich["}"]?.args, { selector: "li.hit", link: "a.t", hover: true, direction: "next_section" }, "the row's link and hover stay");
  const own = { id: "page.tree", args: { action: "next" }, when_present: "tr.c" };
  const kept = with_item_landings({ site: "https://example.org/*", keymap: { item: { j: down, "}": own } } } as never).keymap?.["item"] as Record<string, unknown>;
  assert.equal(kept["}"], own);
  assert.equal((kept["{"] as { args?: Record<string, unknown> }).args?.["direction"], "prev_section");
});

test("a row with an item selector gets I and zt, zz and zb for its own items, a user row too, and its own binds win", () => {
  const google = compiled_with().site_rules?.find((rule) => rule.origin === "default" && rule.name === "google")!;
  const selector = "#search div.MjjYud:has(a > h3)";
  const landing = (bind: { leaf: { when_present?: string; steps: { invocation: { id: string; args?: Record<string, unknown> } }[] } } | undefined) => bind?.leaf.steps.map((step) => [step.invocation.id, step.invocation.args?.["selector"]]);
  assert.deepEqual(landing(google.bind?.["I"]), [["hint.run", undefined], ["page.item", selector]]);
  assert.equal(google.bind?.["I"]?.leaf.when_present, selector);
  assert.equal(google.bind?.["I"]?.leaf.steps[0]?.invocation.args?.["items"], selector);
  // Normal mode offers the row alone so `I` starts at once. Item mode offers the other lists too.
  assert.equal(google.bind?.["I"]?.leaf.steps[0]?.invocation.args?.["row_only"], true);
  assert.equal(google.keymap?.["item"]?.["I"]?.leaf.steps[0]?.invocation.args?.["row_only"], false);
  for (const key of ["zt", "zz", "zb"]) assert.deepEqual(landing(google.keymap?.["item"]?.[key]), [["page.item", selector], ["scroll.align", undefined]], key);
  assert.deepEqual(landing(google.keymap?.["item"]?.["I"]), [["hint.run", undefined], ["page.item", selector]]);

  const row = { site: "https://example.org/*", keymap: { item: { j: { id: "page.item", args: { selector: "li.hit", direction: "down" } }, zz: { id: "page.item", args: { selector: "li.mine", direction: "current" } } } } };
  const user = compiled_with({ site_rules: [row] }).site_rules?.find((rule) => rule.origin === "user")!;
  assert.equal(user.bind?.["I"]?.leaf.when_present, "li.hit");
  assert.deepEqual(landing(user.keymap?.["item"]?.["zz"]), [["page.item", "li.mine"]], "the row's own zz stays");
  assert.deepEqual(landing(user.keymap?.["item"]?.["zt"]), [["page.item", "li.hit"], ["scroll.align", undefined]]);

  const own_pick = { ...row, bind: { I: { id: "scroll.align", args: { position: "top" } } } };
  assert.equal(compiled_with({ site_rules: [own_pick] }).site_rules?.find((rule) => rule.origin === "user")!.bind?.["I"]?.leaf.steps[0]?.invocation.id, "scroll.align");
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
  assert.deepEqual(["j", "k", "h", "l"].map((key) => first_step("item", key)), ["page.item", "page.item", "page.tree", "page.tree"]);
  assert.deepEqual(["h", "l"].map((key) => (compiled.modes.item!.children[key] as { otherwise?: { steps: { invocation: { id: string } }[] } }).otherwise?.steps[0]?.invocation.id), ["page.item", "page.item"], "the item moves stay behind the tree guard");
  assert.equal(compiled.site_rules?.some((rule) => rule.origin === "default" && rule.name === "item_navigator"), false, "no row of the setting remains");
});

test("the matcher reads counts in item mode and takes a quote as an ordinary key", () => {
  const matcher = create_matcher(compiled_with());
  assert.equal(matcher.feed("item", "3").kind_, "pending");
  const counted = matcher.feed("item", "j");
  assert.equal(counted.kind_ === "match" && counted.count, 3);
  assert.equal(matcher.feed("item", '"').kind_, "no_match", "no register in item mode");
});

test("visual item mode: Escape goes to item mode, the second to normal, and a field ends it", () => {
  const state = create_mode_state();
  state.set_mode_("item");
  state.set_mode_("item_visual");
  state.escape();
  assert.equal(state.get_mode_(), "item");
  state.escape();
  assert.equal(state.get_mode_(), "normal");
  state.set_mode_("item_visual");
  state.focus_entered_editable_();
  assert.equal(state.get_mode_(), "insert");
});

test("the badge says VISUAL in visual item mode", () => {
  assert.equal(mode_label("item_visual", false, "always"), "VISUAL");
});

test("the badge of visual item mode carries the size of the range, and no other mode does", () => {
  assert.equal(mode_label("item_visual", false, "always", undefined, undefined, 3), "VISUAL 3");
  assert.equal(mode_label("item_visual", false, "always", undefined, undefined, undefined), "VISUAL");
  assert.equal(mode_label("item", false, "always", undefined, undefined, 3), "ITEM");
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

test("a resumed page starts wherever it has a list, unless its site row sets item_navigator to false", async () => {
  const compiled = compiled_with({ item_navigator: false, site_rules: [{ site: "https://off.test/*", item_navigator: false }, { site: "https://shipped.test/*", item_navigator: "shipped" }, { site: "https://pass.test/*", pass: "j k" }] });
  const resumes = async (address: string) => (await item_start_for(stored(compiled), address, { resume: true })) !== undefined;
  assert.equal(await resumes("https://a.test/"), true);
  assert.equal(await resumes("https://shipped.test/"), true);
  assert.equal(await resumes("https://off.test/"), false);
  assert.equal(await resumes("https://pass.test/"), false, "a row that claims j or k keeps them");
  assert.equal(await starts_item_mode(stored(compiled), "https://a.test/"), false);
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

test("the start carries the item selectors of every item key and guarded choice the rows bind, and none on a page the finder reads", async () => {
  const compiled = compiled_with({ item_navigator: true });
  assert.deepEqual(await item_start_for(stored(compiled), "https://news.ycombinator.com/"), { selectors: ["tr.athing"] });
  assert.deepEqual(await item_start_for(stored(compiled), "https://drive.google.com/drive/my-drive"), { selectors: ['[role="grid"] [role="gridcell"][data-id], [role="grid"] [role="row"][data-id]', '[role="grid"] [role="gridcell"][data-id]'] });
  assert.deepEqual(await item_start_for(stored(compiled), "https://a.test/"), { selectors: [] });
  const step = (selector: string) => ({ id: "page.item", args: { selector, direction: "down" }, when_present: selector });
  const choices = compiled_with({ item_navigator: true, site_rules: [{ site: "https://a.test/*", keymap: { item: { j: [[step(".grid .tile")], [step("tr.result")]] } } }] });
  assert.deepEqual(await item_start_for(stored(choices), "https://a.test/"), { selectors: [".grid .tile, tr.result", ".grid .tile", "tr.result"] }, "the derived I adds the union of the choices");
  // A user key on j that is not a move leaves the selectors of the row's other item keys.
  const remapped = compiled_with({ item_navigator: true, site_rules: [{ site: "https://news.ycombinator.com/*", keymap: { item: { j: { id: "tab.next" } } } }] });
  assert.deepEqual(await item_start_for(stored(remapped), "https://news.ycombinator.com/"), { selectors: ["tr.athing"] });
});


test("each global value starts the shipped sites and the other list pages as it says", async () => {
  const shipped_site = "https://news.ycombinator.com/";
  const other_site = "https://a.test/";
  const expected = [["shipped", true, false], [true, true, true], [false, false, false], [undefined, true, false]] as const;
  for (const [global, on_shipped, on_other] of expected) {
    const compiled = compiled_with(global === undefined ? {} : { item_navigator: global });
    assert.equal(await starts_item_mode(stored(compiled), shipped_site), on_shipped, `${global} on a shipped site`);
    assert.equal(await starts_item_mode(stored(compiled), other_site), on_other, `${global} elsewhere`);
  }
});

test("a user row beats the global value on a shipped site and elsewhere, and a row of shipped follows the global value", async () => {
  const hn = "https://news.ycombinator.com/";
  const rows = (global: "shipped" | boolean, site: string, value: "shipped" | boolean) => compiled_with({ item_navigator: global, site_rules: [{ site, item_navigator: value }] });
  assert.equal(await starts_item_mode(stored(rows("shipped", "https://news.ycombinator.com/*", false)), hn), false);
  assert.equal(await starts_item_mode(stored(rows(true, "https://news.ycombinator.com/*", false)), hn), false);
  assert.equal(await starts_item_mode(stored(rows(false, "https://news.ycombinator.com/*", true)), hn), true);
  assert.equal(await starts_item_mode(stored(rows(false, "https://a.test/*", true)), "https://a.test/"), true);
  assert.equal(await starts_item_mode(stored(rows(true, "https://a.test/*", false)), "https://a.test/"), false);
  assert.equal(await starts_item_mode(stored(rows("shipped", "https://a.test/*", "shipped")), "https://a.test/"), true);
  assert.equal(await starts_item_mode(stored(rows(false, "https://a.test/*", "shipped")), "https://a.test/"), false);
});

test("every shipped item row marks its sites as shipped, the rows that give j and k to the site stay off, and a row switched off takes its mark along", async () => {
  const shipped = compiled_with();
  for (const address of ["https://www.google.com/search?q=a", "https://www.reddit.com/r/a/", "https://drive.google.com/drive/my-drive", "https://duckduckgo.com/?q=a"]) assert.notEqual(await item_start_for(stored(shipped), address), undefined, address);
  for (const address of ["https://kagi.com/search?q=a", "https://search.brave.com/search?q=a", "https://www.google.com/maps/place/a"]) assert.equal(await item_start_for(stored(shipped), address), undefined, address);
  assert.equal(await item_start_for(stored(compiled_with({ default_site_rows_off: ["hackernews"] })), "https://news.ycombinator.com/"), undefined);
  // A Reddit thread page keeps item mode off: the user presses I.
  for (const { name, row } of DEFAULT_SITE_ROWS) assert.equal((row as { item_navigator?: unknown }).item_navigator, row.keymap?.item === undefined ? undefined : name === "reddit_thread" ? false : "shipped", name);
  for (const address of ["https://www.reddit.com/r/a/comments/1/title/", "https://reddit.com/r/a/comments/1/title/"]) assert.equal(await item_start_for(stored(shipped), address), undefined, address);
});

test("a row whose j chooses between selectors gets an I for the union of them, whatever shape the choices take", () => {
  const step = (selector: string) => ({ id: "page.item", args: { selector, direction: "down" } });
  const shapes = {
    "choice lists of step lists": [[{ ...step(".grid_card"), when_present: ".grid_card" }], [step(".file_row")]],
    "run tables": [{ run: step(".grid_card"), when_present: ".grid_card" }, { run: step(".file_row") }],
    "one step": [step(".grid_card, .file_row")],
  };
  for (const [name, j] of Object.entries(shapes)) {
    const row = with_item_landings({ site: "https://example.org/*", keymap: { item: { j } } } as never);
    assert.equal((row.bind?.["I"] as { when_present?: string }[] | undefined)?.[0]?.when_present, ".grid_card, .file_row", name);
    assert.equal(((row.bind?.["I"] as unknown as { args: { items: string } }[])[0]!).args.items, ".grid_card, .file_row", name);
  }
});

test("row_only is an argument of the lists filter alone", () => {
  const hint = registry.get("hint.run")!;
  assert.equal(check_args(hint, { filter: "lists", items: "li", row_only: true }).ok, true);
  assert.equal(check_args(hint, { filter: "links", row_only: true }).ok, false);
});
