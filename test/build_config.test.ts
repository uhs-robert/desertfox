import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { design_registry } from "./registry/fixtures.ts";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";
import { ConfigErrors } from "../tools/build-config/errors.ts";
import { write_managed_storage, write_schemas } from "../tools/build-config/output.ts";
import { build_schemas } from "../tools/build-config/schemas.ts";
import { build_commands_file } from "../src/shared/registry/index.ts";
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
    "search_engines.jsonc": '{ "alpha": { "url": "u%s", "label": "A" } }',
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /keymap\.jsonc: keymap normal "a": unknown command id "tab\.nope"/);
  assert.match(text, /keymap normal "b": focus expects one of right, left/);
  assert.match(text, /keymap normal "c": tab\.close: unknown arg "depth"/);
  assert.match(text, /keymap normal "d": focus expects text/);
  assert.match(text, /keymap normal "e": engine expects one of alpha/);
  assert.match(text, /keymap normal "g": .*depth/);
  assert.match(text, /keymap normal "h": count must be a positive integer/);
  assert.match(text, /keymap normal "f": --container needs --where/);
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
  assert.match(problems_of(dir).join("\n"), /--all expects true or false/);
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

const SNIPPET_HEADER = "// label: L\n// intent: I\n// matches: *://*/*\n";

test("a binding that leaves out a required param is valid, it asks for the prompt", () => {
  const dir = config_dir_with({
    "keymap.jsonc": '{ "normal": { "o": { "id": "open.url" }, "s": { "id": "open.search" } } }',
  });
  assert.doesNotThrow(() => build_config(dir, commands));
});

test("keymap keys are parsed, in every mode", () => {
  const dir = config_dir_with({
    "keymap.jsonc": JSON.stringify({
      normal: { "a b": { id: "tab.next" } },
      browser: { j: { id: "tab.next" }, "<A-j>": { id: "tab.next" } },
    }),
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /keymap normal "a b"/);
  assert.match(text, /keymap browser "j": .*Ctrl or Alt/);
  assert.doesNotMatch(text, /"<A-j>"/);
});

test("generator keys must be one key", () => {
  const dir = config_dir_with({
    "keymap.jsonc": '{ "search_keys": { "ab": "alpha" }, "container_keys": { "c d": "Work" } }',
    "search_engines.jsonc": '{ "alpha": { "url": "u%s", "label": "A" } }',
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /search_keys "ab": must be one key/);
  assert.match(text, /container_keys "c d"/);
});

test("a search engine url needs the %s placeholder", () => {
  const dir = config_dir_with({ "search_engines.jsonc": '{ "alpha": { "url": "https://a.example/", "label": "A" } }' });
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

test("snippet flags get the define-time checks", () => {
  const dir = config_dir_with({
    "snippets/a.js": `// id: myapp.one\n${SNIPPET_HEADER}// flag: --help bool\n`,
    "snippets/b.js": `// id: myapp.two\n${SNIPPET_HEADER}// flag: --x -q bool\n// flag: --y -q bool\n`,
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /a\.js: .*--help is reserved/);
  assert.match(text, /b\.js: .*-q is already used/);
});

test("contract: build_commands_file output feeds build-config", () => {
  const dir = mkdtempSync(join(tmpdir(), "oasisfox-contract-"));
  const commands_path = join(dir, "commands.json");
  writeFileSync(commands_path, JSON.stringify(build_commands_file(design_registry())));
  const config_dir = config_dir_with({
    "keymap.jsonc": '{ "normal": { "sa": { "id": "open.search", "args": { "engine": "alpha", "where": "new_tab", "container": "Work" } }, "D": { "id": "tab.close", "args": { "focus": "left" } } } }',
    "search_engines.jsonc": '{ "alpha": { "url": "u%s", "label": "A" } }',
  });
  const config = build_config(config_dir, read_commands_file(commands_path));
  assert.deepEqual(Object.keys(config.keymap.normal ?? {}), ["sa", "D"]);
});

test("a valid prompt passes and reaches the merged keymap", () => {
  const dir = config_dir_with({
    "keymap.jsonc": JSON.stringify({
      normal: { O: { id: "open.url", args: { where: "new_tab" }, prompt: { param: "url", prefill: { from: "current_url" } } } },
    }),
  });
  assert.deepEqual(build_config(dir, commands).keymap.normal?.["O"], {
    id: "open.url",
    args: { where: "new_tab" },
    prompt: { param: "url", prefill: { from: "current_url" } },
  });
});

test("a prompt is checked against the command", () => {
  const dir = config_dir_with({
    "keymap.jsonc": JSON.stringify({
      normal: {
        a: { id: "open.url", prompt: { param: "link" } },
        b: { id: "open.url", prompt: { param: "url", prefill: { from: "history" } } },
        c: { id: "open.url", prompt: { param: "where", prefill: { from: "clipboard" } } },
        d: { id: "open.url", prompt: "url" },
        e: { id: "open.url", prompt: { param: "url", extra: 1 } },
        f: { id: "open.url", prompt: {} },
      },
    }),
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /keymap normal "a": prompt: param "link" is not a param of open\.url \(params: url, where, container\)/);
  assert.match(text, /keymap normal "b": prompt: prefill must be/);
  assert.match(text, /keymap normal "c": prompt: prefill needs a string param, "where" is enum/);
  assert.match(text, /keymap normal "d": prompt must be an object/);
  assert.match(text, /keymap normal "e": prompt: unknown field "extra"/);
  assert.match(text, /keymap normal "f": prompt: param undefined is not a param/);
});

test("the keymap schema offers prompt with the command's param names", () => {
  const keymap_text = JSON.stringify(build_schemas(commands).keymap);
  assert.match(keymap_text, /"prompt":\{[^}]*"param":\{"enum":\["url","where","container"\]\}/);
});

test("a binding in a mode the command does not allow is a problem", () => {
  const dir = config_dir_with({ "keymap.jsonc": '{ "ignore": { "x": { "id": "tab.close" } } }' });
  assert.match(problems_of(dir).join("\n"), /tab\.close runs in normal mode, not ignore/);
});

test("a built-in binding matches exactly one branch of the keymap schema", () => {
  const schema = build_schemas(commands).keymap as { properties: { normal: { additionalProperties: { anyOf: { oneOf?: { properties?: { id: Record<string, unknown> } }[] }[] } } } };
  const branches = schema.properties.normal.additionalProperties.anyOf[1]!.oneOf!;
  const id_matches = (branch: { properties?: { id: Record<string, unknown> } }, id: string): boolean => {
    const rule = branch.properties!.id as { const?: string; pattern?: string; not?: { enum: string[] } };
    if (rule.const !== undefined) return rule.const === id;
    return new RegExp(rule.pattern!).test(id) && !rule.not!.enum.includes(id);
  };
  assert.equal(branches.filter((branch) => id_matches(branch, "tab.close")).length, 1);
  assert.equal(branches.filter((branch) => id_matches(branch, "site.custom")).length, 1);
});
