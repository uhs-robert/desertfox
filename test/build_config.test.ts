import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";
import { ConfigErrors } from "../tools/build-config/errors.ts";
import { write_managed_storage, write_schemas } from "../tools/build-config/output.ts";
import { build_schemas } from "../tools/build-config/schemas.ts";
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
      "keymap.d/20-b.jsonc": '{ "normal": { "J": { "id": "tab.prev" } } }',
      "keymap.d/10-a.jsonc": '{ "normal": { "J": { "id": "tab.close" } } }',
    },
    join(FIXTURES, "full"),
  );
  assert.deepEqual(build_config(dir, commands).keymap.normal?.["J"], { id: "tab.prev" });
});

test("search_keys and container_keys stay as written, not expanded", () => {
  const keymap = full().keymap;
  assert.deepEqual(keymap.search_keys, { a: "alpha", b: "beta" });
  assert.deepEqual(keymap.container_keys, { x: "Work", y: "Home" });
  assert.equal(keymap.normal?.["sa"], undefined);
});

test("an empty generator key is rejected", () => {
  const dir = config_dir_with({ "keymap.jsonc": '{ "container_keys": { "": "Work" } }' });
  assert.match(problems_of(dir).join("\n"), /keymap\.container_keys has an empty key/);
});

test("null in the keymap stays in the output to remove a default binding", () => {
  assert.equal(full().keymap.normal?.["K"], null);
  assert.deepEqual(full().keymap.normal?.["gz"], [{ id: "tab.next" }, { id: "tab.next" }]);
});

test("settings, aliases, css and the format version come through", () => {
  const config = full();
  assert.equal(config.format_version, 1);
  assert.deepEqual(config.settings, { which_key_delay_ms: 150, hint_letters: "abcdef" });
  assert.deepEqual(config.command_aliases, { nt: "tab.next" });
  assert.equal(config.css, "body { color: red; }\n\n:root { --oasisfox-bg: black; }\n");
});

test("an unknown file is rejected with its path", () => {
  const dir = config_dir_with({ "keymapp.jsonc": "{}" });
  assert.match(problems_of(dir).join("\n"), /keymapp\.jsonc: unknown file/);
});

test("an unknown file inside a .d directory is rejected", () => {
  const dir = config_dir_with({ "keymap.d/notes.txt": "x" });
  assert.match(problems_of(dir).join("\n"), /notes\.txt: unknown file/);
});

test("an unknown keymap section is rejected", () => {
  const dir = config_dir_with({ "keymap.jsonc": '{ "norml": {} }' });
  assert.match(problems_of(dir).join("\n"), /keymap\.jsonc: unknown keymap section "norml"/);
});

test("an unknown setting is rejected", () => {
  const dir = config_dir_with({ "settings.jsonc": '{ "which_key_delay": 1 }' });
  assert.match(problems_of(dir).join("\n"), /settings\.jsonc: which_key_delay: unknown setting/);
});

test("a syntax error names file and line", () => {
  const dir = config_dir_with({ "settings.jsonc": '{\n  "hint_letters": \n}' });
  assert.match(problems_of(dir).join("\n"), /settings\.jsonc:\d+:/);
});

test("bad bindings name the file and the key", () => {
  const dir = config_dir_with({
    "keymap.jsonc": JSON.stringify({
      normal: {
        a: { id: "tab.nope" },
        b: { id: "tab.close", args: { focus: "up" } },
        c: { id: "tab.close", args: { depth: 1 } },
        d: { id: "tab.close", args: { focus: 3 } },
        e: { id: "open.search", args: { engine: "ghost" } },
        f: { id: "open.url", args: { container: "Work" } },
        g: { id: "open.search", args: { engine: "alpha", depth: "deep" } },
        h: { id: "tab.next", count: 0 },
      },
    }),
    "search_engines.jsonc": '{ "alpha": { "url": "u", "label": "A" } }',
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /keymap\.jsonc: keymap normal "a": unknown command id "tab\.nope"/);
  assert.match(text, /keymap normal "b": tab\.close: "focus" must be one of right, left/);
  assert.match(text, /keymap normal "c": tab\.close has no param "depth"/);
  assert.match(text, /keymap normal "d": tab\.close: "focus" must be a string/);
  assert.match(text, /keymap normal "e": .*search engine "ghost"/);
  assert.match(text, /keymap normal "f": open\.url: "container" is valid only when where is new_tab or background/);
  assert.match(text, /keymap normal "g": open\.search: "depth" must be an integer/);
  assert.match(text, /keymap normal "h": count must be a positive integer/);
});

test("a search key naming a missing engine is an error", () => {
  const dir = config_dir_with({ "keymap.jsonc": '{ "search_keys": { "z": "ghost" } }' });
  assert.match(problems_of(dir).join("\n"), /search_keys "z": unknown search engine "ghost"/);
});

test("an alias must name a known command and a free name", () => {
  const dir = config_dir_with({ "command_aliases.jsonc": '{ "x": "tab.nope", "search": "tab.next" }' });
  const text = problems_of(dir).join("\n");
  assert.match(text, /command_aliases "x": unknown command id "tab\.nope"/);
  assert.match(text, /command_aliases "search": the name is already used/);
});

test("snippet header becomes a registry-shaped entry", () => {
  const snippet = full().snippets[0];
  assert.deepEqual(snippet?.params, [
    { name: "query", type: "string", default: { from: "selection" } },
    { name: "all", type: "bool", flag: { short: "a" } },
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
    "// flag: --depth -d int default=2",
    "",
  ].join("\n");
  const entry = parse_snippet("s.js", text, problems);
  assert.deepEqual(problems, []);
  assert.deepEqual(entry?.params, [
    { name: "mode", type: "enum", values: ["x", "y"], default: "y" },
    { name: "word", type: "string", default: "selection" },
    { name: "depth", type: "int", default: 2, flag: { short: "d" } },
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
    { "keymap.d/90-snippet.jsonc": '{ "normal": { "gi": { "id": "myapp.toggle_ids", "args": { "all": "yes" } } } }' },
    join(FIXTURES, "full"),
  );
  assert.match(problems_of(dir).join("\n"), /"all" must be true or false/);
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

test("one schema per data file lists command ids and params", () => {
  const dir = mkdtempSync(join(tmpdir(), "oasisfox-schemas-"));
  write_schemas(dir, build_schemas(commands));
  assert.deepEqual(readdirSync(dir).sort(), [
    "command_aliases.schema.json", "keymap.schema.json", "search_engines.schema.json", "settings.schema.json",
  ]);
  const keymap_text = readFileSync(join(dir, "keymap.schema.json"), "utf8");
  assert.match(keymap_text, /"const": "tab\.close"/);
  assert.match(keymap_text, /"right"/);
});
