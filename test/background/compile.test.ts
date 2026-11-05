import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { make_fake } from "./fakes.ts";
import type { TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { palette_mode_colors } from "../../src/shared/mode_colors.ts";
import { derive_roles } from "../../src/shared/theme/derive.ts";

const commands = {
  "tab.close": {
    label: "Close",
    intent: "x",
    params: [{ name: "focus", type: "enum" as const, values: ["right", "left"], default: "right" }],
    runs_in: "background" as const,
    run: () => {},
  },
  "open.search": {
    label: "Search",
    intent: "x",
    params: [
      { name: "engine", type: "enum" as const, values: { from: "search_engines" as const } },
      { name: "where", type: "enum" as const, values: ["here", "tab"], default: "here" },
    ],
    runs_in: "background" as const,
    run: () => {},
  },
  "open.url": { label: "Open", intent: "x", params: [{ name: "url", type: "string" as const }], runs_in: "background" as const, run: () => {} },
};

test("bad args warn and skip, defaults are filled, prompt bindings stay", () => {
  const { registry } = make_fake(commands);
  const config = { ...empty_config(), keymap: { normal: { D: { id: "tab.close" }, X: { id: "tab.close", args: { focus: "up" } }, o: { id: "open.url", prompt: { param: "url" } } }, search_keys: { a: "arch", z: "nope" } } };
  const { compiled, warnings } = compile_config({
    config,
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: ["arch"], containers: [] },
  });
  const children = compiled.modes.normal!.children;
  assert.deepEqual((children.D as TreeLeaf).steps[0]!.invocation.args, { focus: "right" });
  assert.equal(children.X, undefined);
  assert.ok(children.o);
  assert.ok((children.s as { children: object }).children);
  assert.equal(warnings.filter((w) => w.includes("nope")).length, 2);
  assert.equal(warnings.filter((w) => w.includes("focus")).length, 1);
});

test("a binding that lacks a required param and sets no prompt warns and is skipped", () => {
  const { registry } = make_fake({
    "mode.set": { label: "Mode", intent: "x", params: [{ name: "mode", type: "enum" as const, values: ["normal", "ignore"] }], runs_in: "content", run: () => {} },
  });
  const { compiled, warnings } = compile_config({
    config: { ...empty_config(), keymap: { normal: { i: { id: "mode.set" }, j: { id: "mode.set", prompt: { param: "mode" } } } } },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  assert.equal(compiled.modes.normal!.children.i, undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /skipped "i"/);
  assert.equal((compiled.modes.normal!.children.j as TreeLeaf).steps[0]!.runs_in, "background");
});

test("a prompt leaf goes to the background so the router can refuse it", () => {
  const { registry } = make_fake({
    "mode.set": { label: "Mode", intent: "x", params: [{ name: "mode", type: "enum" as const, values: ["normal", "ignore"], default: "normal" }], runs_in: "content", run: () => {} },
  });
  const { compiled, warnings } = compile_config({
    config: { ...empty_config(), keymap: { normal: { i: { id: "mode.set", prompt: { param: "mode" } } } } },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  const step = (compiled.modes.normal!.children.i as TreeLeaf).steps[0]!;
  assert.equal(step.runs_in, "background");
  assert.deepEqual(step.invocation.prompt, { param: "mode" });
  assert.deepEqual(warnings, []);
});

test("a prompt naming a missing param warns and skips", () => {
  const { registry } = make_fake(commands);
  const { compiled, warnings } = compile_config({
    config: { ...empty_config(), keymap: { normal: { o: { id: "open.url", prompt: { param: "link" } } } } },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  assert.equal(compiled.modes.normal, undefined);
  assert.match(warnings[0]!, /prompt names "link"/);
});

test("a binding in a mode the command does not allow is warned about and skipped", () => {
  const { registry } = make_fake({
    "tab.close": { label: "Close", intent: "x", runs_in: "background", run: () => {} },
    "mode.leave": { label: "Leave", intent: "x", runs_in: "content", modes: ["normal", "ignore"], run: () => {} },
  });
  const { compiled, warnings } = compile_config({
    config: empty_config(),
    default_keymap: { normal: { D: { id: "tab.close" } }, ignore: { D: { id: "tab.close" }, L: { id: "mode.leave" } }, browser: { "<A-j>": { id: "tab.close" } } },
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  assert.ok(compiled.modes.normal!.children.D);
  assert.deepEqual(Object.keys(compiled.modes.ignore!.children), ["L"]);
  assert.ok(compiled.modes.browser!.children["<A-j>"]);
  assert.equal(warnings.filter((w) => w.includes("ignore") && w.includes("tab.close")).length, 1);
});

test("the palette picks the badge colors: local theme, Oasis theme with its light intensity, or oasis_moonlight with a warning", () => {
  const { registry } = make_fake(commands);
  const compile = (config: ReturnType<typeof empty_config>) =>
    compile_config({ config, default_keymap: {}, get_command: (id) => registry.get(id), enum_sources: { search_engines: [], containers: [] } });
  const colors = derive_roles({ bg_core: "#101010", fg_core: "#eeeeee", primary: "#88aaff", accent: "#ffcc66" }, "dark");
  const local = compile({ ...empty_config(), settings: { palette: "mine" }, local_theme: { name: "mine", colors: { dark: colors, light: colors } } });
  assert.deepEqual(local.compiled.mode_colors?.normal.dark, ["#88aaff", "#101010"]);
  assert.deepEqual(local.warnings, []);
  assert.deepEqual(compile({ ...empty_config(), settings: { palette: "oasis_cactus" } }).compiled.mode_colors, palette_mode_colors("oasis_cactus", 3));
  const intense = compile({ ...empty_config(), settings: { palette: "oasis_moonlight", light_intensity: 5 } }).compiled.mode_colors;
  assert.deepEqual(intense, palette_mode_colors("oasis_moonlight", 5));
  assert.notDeepEqual(intense?.normal.light, palette_mode_colors("oasis_moonlight", 3)?.normal.light);
  // A hand-edited managed config can hold any light_intensity. The keymap must still compile.
  for (const bad of [0, 6, 2.5, "3"]) {
    const edited = compile({ ...empty_config(), settings: { light_intensity: bad as never } });
    assert.deepEqual(edited.compiled.mode_colors, palette_mode_colors("oasis_moonlight", 3));
    assert.deepEqual(edited.warnings, [`settings: light_intensity ${JSON.stringify(bad)} is not 1 to 5, using 3`]);
  }
  const unknown = compile({ ...empty_config(), settings: { palette: "moonlight" } });
  assert.deepEqual(unknown.compiled.mode_colors, palette_mode_colors("oasis_moonlight", 3));
  assert.deepEqual(unknown.warnings, ['settings: palette "moonlight" names no theme, using oasis_moonlight']);
});
