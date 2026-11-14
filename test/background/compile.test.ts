import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { make_fake } from "./fakes.ts";
import type { TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { load_theme } from "../../src/shared/theme/load.ts";
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
    "mode.set": { label: "Mode", intent: "x", params: [{ name: "mode", type: "enum" as const, values: ["normal", "ignore"] }], runs_in: "content" },
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
    "mode.set": { label: "Mode", intent: "x", params: [{ name: "mode", type: "enum" as const, values: ["normal", "ignore"], default: "normal" }], runs_in: "content" },
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
    "mode.leave": { label: "Leave", intent: "x", runs_in: "content", modes: ["normal", "ignore"] },
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

test("the theme picks the stored theme: local theme, Oasis theme with its light intensity, or oasis_moonlight with a warning", () => {
  const { registry } = make_fake(commands);
  const compile = (config: ReturnType<typeof empty_config>) =>
    compile_config({ config, default_keymap: {}, get_command: (id) => registry.get(id), enum_sources: { search_engines: [], containers: [] } });
  const colors = derive_roles({ bg_core: "#101010", fg_core: "#eeeeee", primary: "#88aaff", accent: "#ffcc66" }, "dark");
  const local = compile({ ...empty_config(), settings: { theme: "mine" }, local_themes: { mine: { dark: colors, light: colors } } });
  assert.equal(local.theme.dark.mode_normal, "#88aaff");
  assert.deepEqual(local.warnings, []);
  assert.equal("mode_colors" in local.compiled, false);
  const functional = compile({ ...empty_config(), settings: { theme: "mine" }, local_themes: { mine: { dark: { ...colors, accent: "rgb(255, 0, 0)" }, light: colors } } });
  assert.equal(functional.theme.dark.accent, "#ff0000");
  // A hand-edited config can hold any light_intensity. The keymap must still compile.
  for (const bad of [0, 6, 2.5, "3"]) {
    const edited = compile({ ...empty_config(), settings: { light_intensity: bad as never } });
    assert.deepEqual(edited.theme.light, load_theme("oasis_moonlight", 3)!.light);
    assert.deepEqual(edited.warnings, [`settings: light_intensity ${JSON.stringify(bad)} is not 1 to 5, using 3`]);
  }
  const moonlight = load_theme("oasis_moonlight", 5)!;
  assert.deepEqual(compile({ ...empty_config(), settings: { theme: "oasis_moonlight", light_intensity: 5 } }).theme, { dark: moonlight.dark, light: moonlight.light });
  const unknown = compile({ ...empty_config(), settings: { theme: "moonlight" } });
  assert.deepEqual(unknown.theme.dark, load_theme("oasis_moonlight", 3)!.dark);
  assert.deepEqual(unknown.warnings, ['settings: theme "moonlight" names no theme, using oasis_moonlight']);
  const broken = compile({ ...empty_config(), settings: { theme: "mine" }, local_themes: { mine: { dark: { ...moonlight.dark, accent: "red" }, light: moonlight.light } } });
  assert.deepEqual(broken.theme.dark, load_theme("oasis_moonlight", 3)!.dark);
  assert.deepEqual(broken.warnings, ['settings: theme "mine" is a local theme with a problem: [dark] accent is "red", not a color as #rgb, #rrggbb, rgb(), rgba() with alpha 1, or hsl(), using oasis_moonlight']);
});

test("theme desktop shows the pushed theme, else oasis_moonlight, and leaves light_intensity alone", () => {
  const { registry } = make_fake(commands);
  const compile = (settings: Record<string, unknown>, desktop_theme?: string) =>
    compile_config({ config: { ...empty_config(), settings }, desktop_theme, default_keymap: {}, get_command: (id) => registry.get(id), enum_sources: { search_engines: [], containers: [] } });
  assert.deepEqual(compile({ theme: "desktop" }).theme, compile({ theme: "oasis_moonlight" }).theme);
  assert.deepEqual(compile({ theme: "desktop" }).warnings, []);
  assert.deepEqual(compile({ theme: "desktop" }, "oasis_dune").theme, compile({ theme: "oasis_dune" }).theme);
  assert.deepEqual(compile({ theme: "desktop", light_intensity: 5 }, "oasis_dune").theme, compile({ theme: "oasis_dune", light_intensity: 5 }).theme);
  // A name set by hand stops the sync: the pushed theme is ignored.
  assert.deepEqual(compile({ theme: "oasis_rose" }, "oasis_dune").theme, compile({ theme: "oasis_rose" }).theme);
  assert.deepEqual(compile({}, "oasis_dune").theme, compile({ theme: "oasis_moonlight" }).theme);
});

test("a content command that moves the view is marked, so a first press goes to the router and a line edge does not", () => {
  const { registry } = make_fake({
    "scroll.to": { label: "To", intent: "x", params: [{ name: "percent", type: "float" as const }, { name: "axis", type: "enum" as const, values: ["x", "y"], default: "y" }], runs_in: "content", jumps: (args) => args.axis !== "x" },
    "scroll.by": { label: "By", intent: "x", runs_in: "content" },
    "page.follow": { label: "Follow", intent: "x", params: [{ name: "where", type: "enum" as const, values: ["here", "tab"], default: "here" }], runs_in: "content", jumps: (args) => args.where === "here" },
  });
  const { compiled } = compile_config({
    config: { ...empty_config(), keymap: { normal: { a: { id: "scroll.to", args: { percent: 0 } }, e: { id: "scroll.to", args: { percent: 0, axis: "x" } }, b: { id: "scroll.by" }, c: { id: "page.follow" }, d: { id: "page.follow", args: { where: "tab" } } } } },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  const step_of = (key: string) => (compiled.modes.normal!.children[key] as TreeLeaf).steps[0]!;
  assert.deepEqual(["a", "b", "c", "d", "e"].map((key) => step_of(key).jump === true), [true, false, true, false, false]);
  assert.deepEqual(["a", "c"].map((key) => step_of(key).runs_in), ["content", "content"]);
});

test("a jump bound without its count param is marked too, so the keys after a typed 50 and the key wait", () => {
  const { registry } = make_fake({
    "scroll.to": { label: "To", intent: "x", params: [{ name: "percent", type: "float" as const }], count: { param: "percent" }, runs_in: "content", jumps: true },
  });
  const { compiled } = compile_config({
    config: { ...empty_config(), keymap: { normal: { a: { id: "scroll.to" } } } },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  const step = (compiled.modes.normal!.children.a as TreeLeaf).steps[0]!;
  assert.equal(step.runs_in, "background");
  assert.equal(step.jump, true);
});
