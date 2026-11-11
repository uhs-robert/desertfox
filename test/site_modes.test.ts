import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { page_keymap_for } from "../src/background/page_keymap.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import "../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { badge_state } from "../src/content/badge_state.ts";
import { create_key_flow } from "../src/content/key_flow.ts";
import { create_mode_state } from "../src/content/mode_state.ts";
import { mode_label } from "../src/content/ui/mode_label.ts";
import { ConfigErrors } from "../src/shared/config_build/errors.ts";
import { compile_keymap, create_matcher } from "../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import type { CompiledKeymap, PageKeymap, TreeBranch } from "../src/shared/prefix_tree.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { build_commands_file } from "../src/shared/registry/index.ts";
import { SETTINGS_TABLE } from "../src/shared/settings_table.ts";
import { SETTING_SPECS } from "../src/shared/settings_schema.ts";
import { build_config } from "../tools/build-config/build_config.ts";

const resolve = () => ({ runs_in: "content" as const, label: "x", count: "ignore" as const });
const id = (name: string) => ({ id: name });
const KEYMAP = { normal: { l: id("n.l"), v: id("n.v"), q: id("macro.record"), "<Escape>": id("n.escape") } };
const SITE = "https://a.test/*";
const MODE_ROW = { site: SITE, modes: { visual: { label: "VISUAL", bind: { l: id("m.l"), h: id("m.h"), qx: id("m.qx") } } } };
const compile = (rows: unknown[]) => compile_keymap(KEYMAP, { site_rules: rows as never }, resolve);
const storage_of = (stored: unknown) => ({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: stored }) }) as never;
const ask = async (compiled: CompiledKeymap, address: string, recording?: string) => page_keymap_for(storage_of(compiled), [address], recording);

test("a mode reply holds its label and only the children that differ from the normal tree", async () => {
  const reply = (await ask(compile([MODE_ROW]).compiled, "https://a.test/"))!;
  const mode = reply.site_modes!["visual"]!;
  assert.equal(mode.label, "VISUAL");
  assert.deepEqual(Object.keys(mode.tree).sort(), ["h", "l", "q"]);
  assert.equal(reply.site_modes && (await ask(compile([MODE_ROW]).compiled, "https://b.test/"))?.site_modes, undefined);
});

test("mode binds go on after pass prunes the tree, so the reply keeps a mode key the key rule removed", async () => {
  const reply = (await ask(compile([{ ...MODE_ROW, pass: "l" }]).compiled, "https://a.test/"))!;
  assert.equal(reply.keymap.modes.normal?.children["l"], undefined);
  assert.ok(reply.site_modes!["visual"]!.tree["l"]);
});

test("the first row that has a mode decides it whole", async () => {
  const other = { site: SITE, modes: { visual: { label: "LATER", bind: { z: id("m.z") } } } };
  const reply = (await ask(compile([MODE_ROW, other]).compiled, "https://a.test/"))!;
  assert.equal(reply.site_modes!["visual"]!.label, "VISUAL");
  assert.equal(reply.site_modes!["visual"]!.tree["z"], undefined);
});

test("an all-off page gets no site modes", async () => {
  const reply = (await ask(compile([{ ...MODE_ROW, off: true }]).compiled, "https://a.test/"))!;
  assert.equal(reply.site_modes, undefined);
});

test("while a macro records, the stop key replaces the record key in the normal tree and in a mode tree that binds under it", async () => {
  const { compiled } = compile_config({
    config: { ...empty_config(), settings: { site_rules: [{ site: SITE, modes: { visual: { label: "V", bind: { l: { id: "tab.next" }, qz: { id: "tab.prev" } } } } }] } } as never,
    default_keymap: DEFAULT_KEYMAP,
    get_command: (command_id) => registry.get(command_id),
    enum_sources: {},
  });
  const reply = (await ask(compiled, "https://a.test/", "a"))!;
  const stop = (node: unknown) => (node as { steps: { invocation: { id: string } }[] }).steps[0]!.invocation.id;
  assert.equal(stop(reply.keymap.modes.normal!.children["q"]), "macro.stop");
  const mode_tree = reply.site_modes!["visual"]!.tree;
  assert.equal(stop(mode_tree["q"]), "macro.stop");
  assert.ok(mode_tree["l"]);
});

// What main.ts does: normal mode with the running mode's children laid over it.
function overlay(reply: PageKeymap, name: string | undefined): CompiledKeymap {
  const normal = reply.keymap.modes.normal as TreeBranch;
  const mode = name === undefined ? undefined : reply.site_modes![name];
  return { ...reply.keymap, modes: { ...reply.keymap.modes, normal: mode ? { ...normal, children: { ...normal.children, ...mode.tree } } : normal } } as CompiledKeymap;
}

test("mode.site run during a replay keeps key order: the keys behind it run under the mode", async () => {
  const reply = (await ask(compile([MODE_ROW]).compiled, "https://a.test/"))!;
  const state = create_mode_state();
  const ran: string[] = [];
  let enter: () => void = () => {};
  const flow = create_key_flow({
    in_editable_field_: () => false,
    escape_to_page_: () => false,
    get_mode_: state.get_mode_,
    take_pass_next_: state.take_pass_next_,
    // `n.v` stands for mode.site visual, which runs synchronously inside the key flow.
    run_leaf_: (leaf) => {
      const name = String(leaf.steps[0]?.invocation.id);
      ran.push(name);
      if (name === "n.v") enter();
    },
    leave_insert_: () => {},
    is_loading_: () => false,
    loading_sink_bundles_: () => [],
    sink_of_: () => undefined,
    on_prefix_: () => {},
  });
  enter = () => flow.set_matcher_(create_matcher(overlay(reply, "visual")));
  for (const token of ["l", "v", "l", "l", "h"]) assert.equal(flow.handle_token_(token), "cancel");
  assert.deepEqual(ran, []);
  flow.set_matcher_(create_matcher(overlay(reply, undefined)));
  assert.deepEqual(ran, ["n.l", "n.v", "m.l", "m.l", "m.h"]);
  // Ending the mode puts the normal meaning back.
  flow.set_matcher_(create_matcher(overlay(reply, undefined)));
  flow.handle_token_("l");
  assert.equal(ran.at(-1), "n.l");
});

test("the badge shows a site label only in normal mode, and even where the setting hides normal", () => {
  assert.deepEqual(badge_state("normal", false, "not_normal", undefined, "VISUAL"), { mode: "normal", pass_next: false, setting: "not_normal", recording: undefined, site_label: "VISUAL" });
  assert.equal(badge_state("normal", false, "not_normal", undefined), undefined);
  assert.equal(badge_state("normal", false, "off", undefined, "VISUAL"), undefined);
  assert.equal(badge_state("hint", false, "always", undefined, "VISUAL"), undefined);
  assert.equal(badge_state("insert", false, "not_normal", undefined, "VISUAL")?.site_label, undefined);
  assert.equal(mode_label("normal", false, "not_normal", undefined, "VISUAL"), "VISUAL");
  assert.equal(mode_label("normal", false, "always", undefined, "VISUAL"), "VISUAL");
  assert.equal(mode_label("normal", true, "always", undefined, "VISUAL"), "PASS");
  assert.equal(mode_label("normal", false, "always", "a", "VISUAL"), "VISUAL recording @a");
});

test("mode.site is a content command with one main name param, and `.` does not repeat it", () => {
  const command = registry.get("mode.site")!;
  assert.equal(command.runs_in, "content");
  assert.equal(command.params?.[0]?.main, true);
  assert.equal(command.repeatable, false);
});

test("the modes column accepts a mode table and refuses a bad one", () => {
  const spec = SETTING_SPECS.site_rules;
  const ok = (modes: unknown) => spec.check([{ site: SITE, modes }]);
  assert.equal(ok({ visual: { label: "VISUAL", bind: { l: "tab.next" } } }), true);
  assert.equal(ok({ off: { label: "X", bind: { l: "tab.next" } } }), false);
  assert.equal(ok({ Visual: { label: "X", bind: { l: "tab.next" } } }), false);
  assert.equal(ok({ visual: { bind: { l: "tab.next" } } }), false);
  assert.equal(ok({ visual: { label: "X", bind: {} } }), false);
  assert.equal(ok({ visual: { label: "X", bind: { l: "tab.next" }, extra: 1 } }), false);
  assert.equal(ok({}), false);
  assert.match(String(spec.explain?.([{ site: SITE, modes: { visual: { label: "X", bind: { "": "tab.next" } } } }])), /mode "visual" with a "bind"/);
  assert.ok(SETTINGS_TABLE.site_rules.fields.modes);
});

const commands = build_commands_file(registry).commands;
function build_text(rows: string) {
  const dir = mkdtempSync(join(tmpdir(), "desertfox-modes-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.toml"), rows);
  return build_config(dir, commands);
}

test("the config build resolves mode binds like bind and names a bad step by mode", () => {
  const good = build_text(`[[site_rules]]\nsite = "${SITE}"\nmodes.visual = { label = "VISUAL", bind = { l = "tab.next", x = ["tab.prev", "mode.site off"] } }\n`);
  const row = good.settings.site_rules?.[0] as unknown as { modes: { visual: { bind: Record<string, unknown> } } };
  assert.deepEqual(row.modes.visual.bind["l"], { id: "tab.next" });
  assert.deepEqual(row.modes.visual.bind["x"], [{ id: "tab.prev" }, { id: "mode.site", args: { name: "off" } }]);
  assert.throws(() => build_text(`[[site_rules]]\nsite = "${SITE}"\nmodes.visual = { label = "V", bind = { l = "no.such" } }\n`), (error) => error instanceof ConfigErrors && /mode "visual" bind "l"/.test(error.problems.join("\n")));
});

test("compile keeps good mode binds, drops bad ones with a warning, and warns on a mode no row defines", () => {
  const { compiled, warnings } = compile_config({
    config: { ...empty_config(), settings: { site_rules: [{ site: SITE, bind: { v: { id: "mode.site", args: { name: "visual" } }, w: { id: "mode.site", args: { name: "ghost" } } }, modes: { visual: { label: "V", bind: { l: { id: "tab.next" }, m: { id: "tab.next", args: { bogus: 1 } } } } } }] } } as never,
    default_keymap: DEFAULT_KEYMAP,
    get_command: (command_id) => registry.get(command_id),
    enum_sources: {},
  });
  const mode = compiled.site_rules![0]!.modes!["visual"]!;
  assert.deepEqual(Object.keys(mode.bind), ["l"]);
  assert.ok(warnings.some((text) => /mode "visual" skipped bind "m" of "https:\/\/a.test\/\*"/.test(text)), warnings.join("\n"));
  assert.ok(warnings.some((text) => /starts the site mode "ghost"/.test(text)));
  assert.equal(warnings.some((text) => /"visual", which no site row/.test(text)), false);
});
