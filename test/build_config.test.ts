import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";
import { ConfigErrors } from "../tools/build-config/errors.ts";
import { write_managed_storage, write_schemas } from "../tools/build-config/output.ts";
import { build_schemas } from "../tools/build-config/schemas.ts";
import { build_commands_file, create_registry } from "../src/shared/registry/index.ts";
import { parse_snippet } from "../tools/build-config/snippet.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "build-config");
const commands = read_commands_file(join(FIXTURES, "commands.json"));

function config_dir_with(files: Record<string, string>, base?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "oasisfox-config-"));
  if (base) cpSync(base, dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

function problems_of(dir: string): string[] {
  try {
    build_config(dir, commands);
  } catch (error) {
    if (error instanceof ConfigErrors) return error.problems;
    throw error;
  }
  assert.fail("expected the build to reject the config");
}

const full = () => build_config(join(FIXTURES, "full"), commands);

test("merge order: the .d file wins over the main file", () => {
  const normal = full().keymap.normal;
  assert.deepEqual(normal?.["D"], { id: "tab.close", args: { focus: "right" } });
  assert.deepEqual(full().search_engines["beta"], { url: "https://beta2.example/?q=%s", label: "Beta Two" });
});

test("a later .d file wins over an earlier one, in name order", () => {
  const dir = config_dir_with(
    {
      "keymap.d/20-b.toml": '[normal]\nJ = "tab.prev"',
      "keymap.d/10-a.toml": '[normal]\nJ = "tab.close"',
    },
    join(FIXTURES, "full"),
  );
  assert.deepEqual(build_config(dir, commands).keymap.normal?.["J"], { id: "tab.prev" });
});

test("a binding can start with an alias from command_aliases.toml", () => {
  const dir = config_dir_with({ "keymap.d/20-alias.toml": '[normal]\nJ = "nt"' }, join(FIXTURES, "full"));
  assert.deepEqual(build_config(dir, commands).keymap.normal?.["J"], { id: "tab.next" });
});

test("search_keys and container_keys stay as written, not expanded", () => {
  const keymap = full().keymap;
  assert.deepEqual(keymap.search_keys, { a: "alpha", b: "beta" });
  assert.deepEqual(keymap.container_keys, { x: "Work", y: "Home" });
  assert.equal(keymap.normal?.["sa"], undefined);
});

test("an empty generator key is rejected", () => {
  const dir = config_dir_with({ "keymap.toml": '[container_keys]\n"" = "Work"' });
  assert.match(problems_of(dir).join("\n"), /keymap\.container_keys has an empty key/);
});

test("an empty string in the keymap is stored as null to remove a default binding", () => {
  assert.equal(full().keymap.normal?.["K"], null);
  assert.deepEqual(full().keymap.normal?.["gz"], [{ id: "tab.next" }, { id: "tab.next" }]);
});

test("which_key_border must be square, round or chamfer", () => {
  const dir = config_dir_with({ "settings.toml": 'which_key_border = "wavy"' });
  assert.match(problems_of(dir).join("\n"), /settings\.toml: which_key_border: .*chamfer/);
});

test("mode_indicator must be always, not_normal or off", () => {
  const dir = config_dir_with({ "settings.toml": 'mode_indicator = "yes"' });
  assert.match(problems_of(dir).join("\n"), /settings\.toml: mode_indicator: .*not_normal/);
});

test("palette must name an oasis palette", () => {
  const dir = config_dir_with({ "settings.toml": 'palette = "neon"' });
  assert.match(problems_of(dir).join("\n"), /settings\.toml: palette: .*moonlight/);
});

test("settings, aliases, css and the format version come through", () => {
  const config = full();
  assert.equal(config.format_version, 2);
  assert.deepEqual(config.settings, { which_key_delay_ms: 150, hint_letters: "abcdef" });
  assert.deepEqual(config.command_aliases, { nt: "tab.next" });
  assert.equal(config.css, "body { color: red; }\n\n:root { --oasisfox-bg: black; }\n");
});

test("an unknown file is rejected with its path", () => {
  const dir = config_dir_with({ "keymapp.toml": "" });
  assert.match(problems_of(dir).join("\n"), /keymapp\.toml: unknown file/);
});

test("an unknown file inside a .d directory is rejected", () => {
  const dir = config_dir_with({ "keymap.d/notes.txt": "x" });
  assert.match(problems_of(dir).join("\n"), /notes\.txt: unknown file/);
});

test("an unknown keymap section is rejected", () => {
  const dir = config_dir_with({ "keymap.toml": "[norml]" });
  assert.match(problems_of(dir).join("\n"), /keymap\.toml: unknown keymap section "norml"/);
});

test("an unknown setting is rejected", () => {
  const dir = config_dir_with({ "settings.toml": "which_key_delay = 1" });
  assert.match(problems_of(dir).join("\n"), /settings\.toml: which_key_delay: unknown setting/);
});

test("a syntax error names file, line and column", () => {
  const dir = config_dir_with({ "settings.toml": 'which_key_delay_ms = 1\nhint_letters = \n' });
  assert.match(problems_of(dir).join("\n"), /settings\.toml:2:\d+:/);
});

test("a JSONC file is an error that names the TOML file to use", () => {
  const dir = config_dir_with({ "keymap.jsonc": "{}", "keymap.d/10-a.jsonc": "{}" });
  const text = problems_of(dir).join("\n");
  assert.match(text, /keymap\.jsonc: JSONC is no longer read, use .*keymap\.toml/);
  assert.match(text, /10-a\.jsonc: JSONC is no longer read, use .*10-a\.toml/);
});

test("bad bindings name the file and the key", () => {
  const dir = config_dir_with({
    "keymap.toml": [
      "[normal]",
      'a = "tab.nope"',
      'b = "tab.close up"',
      'c = "tab.close depth=1"',
      'd = "open.search engine=ghost"',
      'e = "open.url container=Work"',
      'f = "open.search engine=alpha depth=deep"',
      'g = { id = "tab.next" }',
      'h = "tab.next now"',
      'i = "tab.close left right"',
      'j = "open.url tab window"',
      "",
    ].join("\n"),
    "search_engines.toml": 'alpha = { url = "u%s", label = "A" }',
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /keymap\.toml: keymap normal "a": unknown command "tab\.nope"/);
  assert.match(text, /keymap normal "b": "up" is not a value, switch or param of tab.close/);
  assert.match(text, /keymap normal "c": unknown param "depth" for tab\.close/);
  assert.match(text, /keymap normal "d": engine expects one of duck, alpha/);
  assert.match(text, /keymap normal "f": depth expects a whole number/);
  assert.match(text, /keymap\.normal\["g"\] must be a command string/);
  assert.match(text, /keymap normal "h": "now" is not a value/);
  assert.match(text, /keymap normal "i": focus is set twice/);
  assert.match(text, /keymap normal "j": where is set twice/);
  assert.match(text, /keymap normal "e": container needs where tab, background or window/);
});

test("a search key naming a missing engine is an error", () => {
  const dir = config_dir_with({ "keymap.toml": '[search_keys]\nz = "ghost"' });
  assert.match(problems_of(dir).join("\n"), /search_keys "z": unknown search engine "ghost"/);
});

test("an alias must name a known command and a free name", () => {
  const dir = config_dir_with({ "command_aliases.toml": 'x = "tab.nope"\nsearch = "tab.next"' });
  const text = problems_of(dir).join("\n");
  assert.match(text, /command_aliases "x": unknown command id "tab\.nope"/);
  assert.match(text, /command_aliases "search": the name is already used/);
});

test("snippet header becomes a registry-shaped entry", () => {
  const snippet = full().snippets[0];
  assert.deepEqual(snippet?.params, [
    { name: "query", type: "string", main: true, default: { from: "selection" } },
    { name: "all", type: "bool" },
  ]);
  assert.equal(snippet?.id, "myapp.toggle_ids");
  assert.equal(snippet?.name, "ids");
  assert.deepEqual(snippet?.matches, ["https://app.example.com/*"]);
  assert.match(snippet?.code ?? "", /wrappedJSObject\.my_app\.toggle_ids\(args\.query\);\n$/);
});

test("snippet header errors name the file and line", () => {
  const problems: string[] = [];
  const text = "// id: a.b\n// label: L\n// intent: I\n// matches: *://*/*\n// param: q wat\n// color: red\n";
  assert.equal(parse_snippet("s.js", text, problems), undefined);
  assert.match(problems.join("\n"), /s\.js:5: "q" needs a type/);
  assert.match(problems.join("\n"), /s\.js:6: unknown header "color"/);
});

test("snippet header requires id, label, intent and matches", () => {
  const problems: string[] = [];
  parse_snippet("s.js", "// name: x\ncode();\n", problems);
  assert.equal(problems.length, 4);
});

test("snippet enum values and literal defaults parse", () => {
  const problems: string[] = [];
  const text = [
    "// id: a.b",
    "// label: L",
    "// intent: I",
    "// matches: *://*/*",
    "// param: mode enum values=x,y default=y",
    '// param: word string default="selection"',
    "// param: depth int default=2",
    "// param: target string main",
    "",
  ].join("\n");
  const entry = parse_snippet("s.js", text, problems);
  assert.deepEqual(problems, []);
  assert.deepEqual(entry?.params, [
    { name: "mode", type: "enum", values: ["x", "y"], default: "y" },
    { name: "word", type: "string", default: "selection" },
    { name: "depth", type: "int", default: 2 },
    { name: "target", type: "string", main: true },
  ]);
});

test("a snippet cannot use a group OasisFox uses", () => {
  const dir = config_dir_with({
    "snippets/a.js": "// id: tab.mine\n// label: L\n// intent: I\n// matches: *://*/*\n",
  });
  assert.match(problems_of(dir).join("\n"), /a\.js: id "tab\.mine" uses the group "tab"/);
});

test("bindings can run a snippet command and check its args", () => {
  const dir = config_dir_with(
    { "keymap.d/90-snippet.toml": '[normal]\ngi = "myapp.toggle_ids all=yes"' },
    join(FIXTURES, "full"),
  );
  assert.match(problems_of(dir).join("\n"), /all expects true or false/);
});

const MODES_SNIPPET = (modes_line: string) =>
  `// id: myapp.pick\n// label: L\n// intent: I\n// matches: *://*/*\n${modes_line}code();\n`;

test("a snippet with a modes header binds in the modes it lists", () => {
  const dir = config_dir_with({
    "snippets/pick.js": MODES_SNIPPET("// modes: normal, visual\n"),
    "keymap.d/90-pick.toml": '[visual]\nxv = "myapp.pick"\n[normal]\nxn = "myapp.pick"',
  });
  const config = build_config(dir, commands);
  assert.deepEqual(config.keymap.visual?.["xv"], { id: "myapp.pick" });
  assert.deepEqual(config.snippets[0]?.modes, ["normal", "visual"]);
});

test("a snippet without a modes header is still rejected in visual mode", () => {
  const dir = config_dir_with({
    "snippets/pick.js": MODES_SNIPPET(""),
    "keymap.d/90-pick.toml": '[visual]\nxv = "myapp.pick"',
  });
  assert.match(problems_of(dir).join("\n"), /myapp\.pick runs in normal mode, not visual/);
});

test("a snippet modes header rejects an unknown mode name", () => {
  const dir = config_dir_with({ "snippets/pick.js": MODES_SNIPPET("// modes: normal, vsual\n") });
  assert.match(problems_of(dir).join("\n"), /pick\.js: header "modes": unknown mode "vsual"/);
});

test("output is the managed storage document", () => {
  const out = join(mkdtempSync(join(tmpdir(), "oasisfox-out-")), "managed", "oasisfox@uhs-robert.json");
  write_managed_storage(out, full());
  const document = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(Object.keys(document), ["name", "description", "type", "data"]);
  assert.equal(document.name, "oasisfox@uhs-robert");
  assert.equal(document.type, "storage");
  assert.deepEqual(Object.keys(document.data).sort(), [
    "command_aliases", "css", "format_version", "keymap", "search_engines", "settings", "snippets",
  ]);
  assert.deepEqual(readdirSync(dirname(out)), ["oasisfox@uhs-robert.json"]);
});

test("one schema per data file offers command names", () => {
  const dir = mkdtempSync(join(tmpdir(), "oasisfox-schemas-"));
  write_schemas(dir, build_schemas(commands));
  assert.deepEqual(readdirSync(dir).sort(), [
    "command_aliases.schema.json", "keymap.schema.json", "search_engines.schema.json", "settings.schema.json",
  ]);
  const keymap_text = readFileSync(join(dir, "keymap.schema.json"), "utf8");
  assert.match(keymap_text, /"search"/);
  assert.match(keymap_text, /"tab\.close"/);
});

const SNIPPET_HEADER = "// label: L\n// intent: I\n// matches: *://*/*\n";

test("a binding that leaves out a required param is valid, it asks for the prompt", () => {
  const dir = config_dir_with({
    "keymap.toml": '[normal]\no = "open.url"\ns = "open.search"',
  });
  const normal = build_config(dir, commands).keymap.normal;
  assert.deepEqual(normal?.["o"], { id: "open.url" });
  assert.deepEqual(normal?.["s"], { id: "open.search" });
});

test("keymap keys are parsed, in every mode", () => {
  const dir = config_dir_with({
    "keymap.toml": '[normal]\n"a b" = "tab.next"\n[browser]\nj = "tab.next"\n"<A-j>" = "tab.next"',
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /keymap normal "a b"/);
  assert.match(text, /keymap browser "j": .*Ctrl or Alt/);
  assert.doesNotMatch(text, /"<A-j>"/);
});

test("generator keys must be one key", () => {
  const dir = config_dir_with({
    "keymap.toml": '[search_keys]\nab = "alpha"\n[container_keys]\n"c d" = "Work"',
    "search_engines.toml": 'alpha = { url = "u%s", label = "A" }',
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /search_keys "ab": must be one key/);
  assert.match(text, /container_keys "c d"/);
});

test("a search engine url needs the %s placeholder", () => {
  const dir = config_dir_with({ "search_engines.toml": 'alpha = { url = "https://a.example/", label = "A" }' });
  assert.match(problems_of(dir).join("\n"), /alpha: an engine is/);
});

test("a snippet name or alias that clashes with a built-in name is rejected", () => {
  const dir = config_dir_with({
    "snippets/a.js": `// id: myapp.one\n// name: search\n${SNIPPET_HEADER}`,
    "snippets/b.js": `// id: myapp.two\n// name: fine\n${SNIPPET_HEADER}`,
    "snippets/c.js": `// id: myapp.three\n// name: tab.next\n${SNIPPET_HEADER}`,
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /a\.js: command "myapp\.one": name: "search" is already used by "open\.search"/);
  assert.match(text, /c\.js: .*"tab\.next"/);
  assert.doesNotMatch(text, /b\.js/);
});

test("snippet params get the define-time checks", () => {
  const dir = config_dir_with({
    "snippets/a.js": `// id: myapp.one\n${SNIPPET_HEADER}// param: a string main\n// param: b string main\n`,
    "snippets/b.js": `// id: myapp.two\n${SNIPPET_HEADER}// param: n int main\n`,
    "snippets/c.js": `// id: myapp.three\n${SNIPPET_HEADER}// flag: --x bool\n`,
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /a\.js: .*only one param can be main/);
  assert.match(text, /b\.js: .*only a string param can be main/);
  assert.match(text, /c\.js:\d+: unknown header "flag"/);
});

test("contract: build_commands_file output feeds build-config", () => {
  const registry = create_registry();
  registry.define("tab.close", {
    label: "Close Tab",
    intent: "Close the current tab.",
    params: [{ name: "focus", type: "enum", values: ["right", "left"], default: "right" } as never],
    runs_in: "background",
    run: () => {},
  });
  const dir = mkdtempSync(join(tmpdir(), "oasisfox-contract-"));
  const commands_path = join(dir, "commands.json");
  writeFileSync(commands_path, JSON.stringify(build_commands_file(registry)));
  const config_dir = config_dir_with({ "keymap.toml": '[normal]\nD = "tab.close left"' });
  const config = build_config(config_dir, read_commands_file(commands_path));
  assert.deepEqual(config.keymap.normal?.["D"], { id: "tab.close", args: { focus: "left" } });
});

test("a binding in a mode the command does not allow is a problem", () => {
  const dir = config_dir_with({ "keymap.toml": '[ignore]\nx = "tab.close"' });
  assert.match(problems_of(dir).join("\n"), /tab\.close runs in normal mode, not ignore/);
});

test("a leading colon stores a prompt, and the @source becomes its prefill", () => {
  const dir = config_dir_with({
    "keymap.toml": '[normal]\ngO = ":open tab @current_url"\ngo = ":open"\ngp = "open @clipboard"\ngq = ":open url=@selection where=window"',
  });
  const normal = build_config(dir, commands).keymap.normal;
  assert.deepEqual(normal?.["gO"], {
    id: "open.url",
    args: { where: "tab" },
    prompt: { param: "url", prefill: { from: "current_url" } },
  });
  assert.deepEqual(normal?.["go"], { id: "open.url", prompt: { param: "url" } });
  assert.deepEqual(normal?.["gp"], { id: "open.url", args: { url: { from: "clipboard" } } });
  assert.deepEqual(normal?.["gq"], { id: "open.url", args: { where: "window" }, prompt: { param: "url", prefill: { from: "selection" } } });
});

test("a colon binding needs a command with a param, and a source needs a text param", () => {
  const dir = config_dir_with({ "keymap.toml": '[normal]\na = ":tab.next"\nb = "open.url where=@selection"\nc = ":nope"' });
  const text = problems_of(dir).join("\n");
  assert.match(text, /keymap normal "a": tab\.next has no param to type/);
  assert.match(text, /keymap normal "b": where expects text/);
  assert.match(text, /keymap normal "c": unknown command "nope"/);
});

test("an unbind marker later in the layers beats an earlier binding, and arrays must hold command strings", () => {
  const dir = config_dir_with({ "keymap.d/60-more.toml": '[normal]\nJ = ""\ngz = ["tab.next", 3]\ngy = []' }, join(FIXTURES, "full"));
  const text = problems_of(dir).join("\n");
  assert.match(text, /keymap\.normal\["gz"\] must be a command string/);
  assert.match(text, /keymap\.normal\["gy"\] must be a command string/);
});

test("a bare engine name picks the engine, and a query that starts with one draws a warning", () => {
  const dir = config_dir_with({
    "keymap.toml": [
      "[normal]",
      'a = "search alpha rust lifetimes"',
      'b = "search engine=beta alpha centauri"',
      'c = "search engine=beta query=\\"alpha centauri\\""',
    ].join("\n"),
    "search_engines.toml": 'alpha = { url = "a%s", label = "A" }\nbeta = { url = "b%s", label = "B" }',
  });
  const warnings: string[] = [];
  const normal = build_config(dir, commands, warnings).keymap.normal;
  assert.deepEqual(normal?.["a"], { id: "open.search", args: { engine: "alpha", query: "rust lifetimes" } });
  assert.deepEqual(normal?.["b"], { id: "open.search", args: { engine: "beta", query: "alpha centauri" } });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /keymap normal "b": query starts with "alpha", which is also a value of engine, write query="..."/);
});

test("a binding can be a table with run and label, and the label lands on the invocation", () => {
  const dir = config_dir_with(
    { "keymap.d/20-label.toml": '[normal]\nJ = { run = "tab.next", label = "Down a tab" }\nM = { run = ["tab.close left", "tab.prev"], label = "Close and step back" }\nL = { run = "tab.next" }' },
    join(FIXTURES, "full"),
  );
  const normal = build_config(dir, commands).keymap.normal;
  assert.deepEqual(normal?.["J"], { id: "tab.next", label: "Down a tab" });
  assert.deepEqual(normal?.["M"], [{ id: "tab.close", args: { focus: "left" }, label: "Close and step back" }, { id: "tab.prev" }]);
  assert.deepEqual(normal?.["L"], { id: "tab.next" });
});

test("a table binding with a bad label, an unknown field or a bad run is reported", () => {
  const problem_for = (binding: string) => problems_of(config_dir_with({ "keymap.d/20-bad.toml": `[normal]\nJ = ${binding}` }, join(FIXTURES, "full")));
  assert.match(problem_for('{ run = "tab.next", label = "" }').join("\n"), /normal "J": a label must not be empty/);
  assert.match(problem_for('{ run = "tab.next", name = "x" }').join("\n"), /keymap\.normal\["J"\] must be a command string/);
  assert.match(problem_for('{ label = "x" }').join("\n"), /keymap\.normal\["J"\] must be a command string/);
  assert.match(problem_for('{ run = "no.such.command", label = "x" }').join("\n"), /normal "J"/);
});

test("the keymap schema accepts the table form", () => {
  const schema = build_schemas(commands)["keymap"] as { properties: { normal: { additionalProperties: { anyOf: { type: string }[] } } } };
  assert.ok(schema.properties.normal.additionalProperties.anyOf.some((form) => form.type === "object"));
});

test("a table binding whose run is not a string or a list of strings is a config error, not a crash", () => {
  const dir = config_dir_with({ "keymap.d/20-bad.toml": '[normal]\nJ = { run = { run = "tab.next" } }\nM = { run = 3 }' }, join(FIXTURES, "full"));
  const text = problems_of(dir).join("\n");
  assert.match(text, /keymap\.normal\["J"\] must be a command string/);
  assert.match(text, /keymap\.normal\["M"\] must be a command string/);
});
