import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build_help_model, STYLE_VARIABLES } from "../src/help/model.ts";
import { parse_route } from "../src/help/route.ts";
import { DEFAULT_SETTINGS, effective_settings } from "../src/shared/config.ts";
import { ROLES } from "../src/shared/theme/roles.ts";
import { token_name } from "../src/shared/theme/tokens.ts";
import { compile_keymap } from "../src/shared/keys/compiler.ts";
import { build_commands_file, create_registry } from "../src/shared/registry/index.ts";

function sample() {
  const registry = create_registry();
  registry.define("scroll.lines", {
    name: "scroll", label: "Scroll Lines", intent: "Scroll by lines.", runs_in: "content",
    params: [{ name: "count", type: "int", default: 1 }],
    run: () => {},
  });
  registry.define("open.url", {
    name: "open", label: "Open URL", intent: "Open a URL.", runs_in: "background",
    params: [
      { name: "url", type: "string", default: { from: "clipboard" } },
      { name: "where", type: "enum", values: ["here", "tab"], default: "here" },
    ],
    run: () => {},
  });
  registry.define("help.open", { name: "help", label: "Help", intent: "Open help.", runs_in: "background", run: () => {} });
  const { compiled } = compile_keymap(
    { normal: { o: { id: "open.url", args: { where: "tab", url: "https://a.example" } }, j: { id: "scroll.lines", args: { count: 10 } }, gg: [{ id: "scroll.lines" }, { id: "help.open" }] }, browser: { "<A-j>": { id: "scroll.lines" } } },
    {},
    (id) => {
      const command = registry.get(id);
      return command && { runs_in: command.runs_in, label: command.label, count: "ignore" };
    },
  );
  return { commands: build_commands_file(registry).commands, compiled };
}

test("the model groups commands by id group and lists params", () => {
  const { commands, compiled } = sample();
  const model = build_help_model(commands, compiled, []);
  assert.deepEqual(model.groups.map((group) => group.name), ["help", "open", "scroll"]);
  const open = model.groups[1]!.commands[0]!;
  assert.equal(open.usage, "open --url=<url> [--tab]");
  assert.deepEqual(open.params, [
    { name: "url", type: "string", default: "from clipboard", values: "", flags: "--url=<url>" },
    { name: "where", type: "enum", default: "here", values: "here, tab", flags: "--tab" },
  ]);
});

test("keys come from the live compiled keymap, per mode, with args", () => {
  const { commands, compiled } = sample();
  const scroll = build_help_model(commands, compiled, []).groups[2]!.commands[0]!;
  assert.deepEqual(scroll.keys, [
    { mode: "normal", keys: "j", args: "10" },
    { mode: "normal", keys: "gg", args: "" },
    { mode: "browser", keys: "<A-j>", args: "" },
  ]);
});

test("a key row writes its args the way the command line does, in the long style", () => {
  const { commands, compiled } = sample();
  const open = build_help_model(commands, compiled, []).groups[1]!.commands[0]!;
  assert.deepEqual(open.keys, [{ mode: "normal", keys: "o", args: "--url=https://a.example --tab" }]);
});

test("a key row guards a query that starts with a configured engine name", () => {
  const registry = create_registry();
  registry.define("open.search", {
    name: "search", label: "Search", intent: "Search.", runs_in: "background",
    params: [{ name: "engine", type: "enum", values: { from: "search_engines" }, default: "" }, { name: "query", type: "string", main: true }],
    run: () => {},
  });
  const { compiled } = compile_keymap({ normal: { s: { id: "open.search", args: { query: "arch linux" } } } }, {}, (id) => {
    const command = registry.get(id);
    return command && { runs_in: command.runs_in, label: command.label, count: "ignore" };
  });
  const commands = build_commands_file(registry).commands;
  const row = (sources: { search_engines: string[] }) => build_help_model(commands, compiled, [], sources).groups[0]!.commands[0]!.keys[0]!.args;
  assert.equal(row({ search_engines: ["arch"] }), "-- arch linux");
  assert.equal(row({ search_engines: [] }), "arch linux");
});

test("warnings pass through and a missing keymap gives no keys", () => {
  const { commands } = sample();
  const model = build_help_model(commands, undefined, ["normal: skipped \"x\""]);
  assert.deepEqual(model.warnings, ["normal: skipped \"x\""]);
  assert.ok(model.groups.every((group) => group.commands.every((command) => command.keys.length === 0)));
});

test("a key row shows the binding prompt", () => {
  const { commands } = sample();
  const registry_compiled = compile_keymap(
    { normal: { o: { id: "open.url", prompt: { param: "url", prefill: { from: "current_url" } } } } },
    {},
    () => ({ runs_in: "background", label: "Open URL", count: "ignore" }),
  ).compiled;
  const model = build_help_model(commands, registry_compiled, []);
  const open = model.groups.find((group) => group.name === "open")!.commands[0]!;
  assert.deepEqual(open.keys, [{ mode: "normal", keys: "o", args: "prompts for url, prefilled from current_url" }]);
});

test("help.html loads the content script after help.js", () => {
  const html = readFileSync(new URL("../src/help/help.html", import.meta.url), "utf8");
  const help = html.indexOf('<script src="help.js"></script>');
  const content = html.indexOf('<script src="content.js"></script>');
  assert.ok(help >= 0 && content > help);
  assert.ok(html.indexOf('<script src="ui.js"></script>') > content, "the badge and toast bundle loads by tag, because executeScript is refused here");
});

test("the Engines section lists the tree parents first, with needs, fallback and origins", () => {
  const { commands } = sample();
  const engines = {
    "github.repo.code": { url: "u{repo}{query}", label: "GitHub: this repo: code", slots: ["repo"], origins: { url: "f.toml [github]", scope: "f.toml [github.repo]" } },
    github: { url: "u{query}", label: "GitHub" },
    "github.repos": { url: "u{query}", label: "GitHub: repos" },
    "github.repo": { url: "u{repo}{query}", label: "GitHub: this repo", slots: ["repo"], fallback: "github" },
    duck: { url: "d{query}", label: "DuckDuckGo" },
  };
  const search = create_registry();
  search.define("open.search", { name: "search", label: "Search", intent: "Search.", runs_in: "background", params: [{ name: "engine", type: "string" }], run: () => {} });
  const { compiled } = compile_keymap({ normal: { sd: { id: "open.search", args: { engine: "duck" } }, ",,": { id: "open.search", args: { engine: "duck" } }, sg: { id: "open.search", args: { engine: "github" } } } }, {}, (id) => {
    const command = search.get(id);
    return command && { runs_in: command.runs_in, label: command.label, count: "ignore" };
  });
  const rows = build_help_model(commands, compiled, [], {}, engines).engines;
  assert.deepEqual(rows.find((row) => row.name === "duck")!.keys, ["sd", ",,"]);
  assert.deepEqual(rows.find((row) => row.name === "github")!.keys, ["sg"]);
  assert.deepEqual(rows.find((row) => row.name === "github.repo")!.keys, []);
  assert.equal(rows.find((row) => row.name === "github.repo.code")!.host, "u{repo}{query}");
  assert.equal(build_help_model(commands, undefined, [], {}, { a: { url: "https://www.example.com/s?q={query}", label: "A" } }).engines[0]!.host, "www.example.com");
  assert.deepEqual(rows.find((row) => row.name === "github.repo.code")!.files, ["f.toml"]);
  assert.deepEqual(rows.map((row) => row.name), ["duck", "github", "github.repo", "github.repo.code", "github.repos"]);
  const code = rows.find((row) => row.name === "github.repo.code")!;
  assert.equal(code.needs, "{repo}");
  assert.deepEqual(code.origins, ["url: f.toml [github]", "scope: f.toml [github.repo]"]);
  assert.equal(rows.find((row) => row.name === "github.repo")!.fallback, "github");
  assert.equal(rows.find((row) => row.name === "duck")!.needs, "");
});

test("the route parser maps hashes to pages and keeps engine links", () => {
  assert.deepEqual(parse_route(""), { page: "home" });
  assert.deepEqual(parse_route("#/commands"), { page: "commands" });
  assert.deepEqual(parse_route("#/styling"), { page: "styling" });
  assert.deepEqual(parse_route("#/search-engines"), { page: "search-engines" });
  assert.deepEqual(parse_route("#engine=github.code"), { page: "search-engines", engine: "github.code" });
  assert.deepEqual(parse_route("#engine=a%20b"), { page: "search-engines", engine: "a b" });
  assert.deepEqual(parse_route("#/nope"), { page: "home" });
  assert.deepEqual(parse_route("#%E0%A4%A"), { page: "home" });
});

test("the styling page lists every theme role as a variable", () => {
  const names = STYLE_VARIABLES.map((variable) => variable.name);
  for (const role of ROLES) assert.ok(names.includes(token_name(role)), role);
  assert.ok(names.includes("--oasisfox-secondary"));
  assert.ok(names.includes("--oasisfox-font") && names.includes("--oasisfox-radius"));
});

test("the model carries the settings and config source for the home page", () => {
  const { commands, compiled } = sample();
  const status = { source: "managed" as const, settings: { ...DEFAULT_SETTINGS, palette: "x" }, managed_file_hint: "" };
  const model = build_help_model(commands, compiled, [], {}, {}, status);
  assert.equal(model.config_source, "Managed storage file");
  assert.deepEqual(model.settings.find((row) => row.name === "palette"), { name: "palette", value: '"x"' });
  assert.equal(build_help_model(commands, compiled, []).config_source, "Unknown, the background has not written a status yet");
});

test("effective settings keep the default prefix a config leaves out", () => {
  const settings = effective_settings({ search_prefixes: { tab: "T" } as { here: string; tab: string }, palette: "x" });
  assert.deepEqual(settings.search_prefixes, { here: DEFAULT_SETTINGS.search_prefixes.here, tab: "T" });
  assert.deepEqual(settings.container_prefixes, DEFAULT_SETTINGS.container_prefixes);
  assert.equal(settings.palette, "x");
  assert.equal(settings.hint_letters, DEFAULT_SETTINGS.hint_letters);
});
