import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";
import { ConfigErrors } from "../src/shared/config_build/errors.ts";
import { write_schemas } from "../tools/build-config/output.ts";
import { fill_template } from "../src/shared/engines/index.ts";
import { build_schemas } from "../src/shared/config_build/schemas.ts";
import { build_commands_file, create_registry } from "../src/shared/registry/index.ts";
import { parse_snippet } from "../src/shared/config_build/snippet.ts";
import { make_tmp_dir } from "./support/tmp_dir.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "build-config");
const commands = read_commands_file(join(FIXTURES, "commands.json"));

function config_dir_with(files: Record<string, string>, base?: string): string {
  const dir = make_tmp_dir("desertfox-config-");
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
  assert.equal(full().search_engines["beta"]?.url, "https://beta2.example/?q={query}");
  assert.equal(full().search_engines["beta"]?.label, "Beta Two");
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

test("modifiers come through as written, and a modifier outside a group or with a bad shape is rejected", () => {
  const good = build_config(config_dir_with({ "keymap.toml": '[modifiers]\n";z" = { rapid = true, label = "Zippy" }' }), commands);
  assert.deepEqual(good.keymap.modifiers, { ";z": { rapid: true, label: "Zippy" } });
  const outside = problems_of(config_dir_with({ "keymap.toml": '[modifiers]\n"r" = { rapid = true }' })).join("\n");
  assert.match(outside, /must sit inside a group/);
  const shape = problems_of(config_dir_with({ "keymap.toml": '[modifiers]\n";r" = "rapid"' })).join("\n");
  assert.match(shape, /modifiers\[";r"\] must be a table of args/);
  const label = problems_of(config_dir_with({ "keymap.toml": '[modifiers]\n";r" = { rapid = true, label = 5 }' })).join("\n");
  assert.match(label, /a label must be a string/);
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

test("palette must name a theme, and the error lists the known names", () => {
  const dir = config_dir_with({ "settings.toml": 'palette = "neon"', "themes/mine.toml": LOCAL_THEME });
  assert.match(problems_of(dir).join("\n"), /settings\.toml: palette: no theme named "neon" \(known: mine, .*moonlight/);
});

test("cmdline_prompt takes 1 to 8 characters on one line", () => {
  for (const preset of ["caret", "colon"]) assert.equal(build_config(config_dir_with({ "settings.toml": `cmdline_prompt = "${preset}"` }), commands).settings.cmdline_prompt, preset);
  assert.equal(build_config(config_dir_with({ "settings.toml": 'cmdline_prompt = ">> "' }), commands).settings.cmdline_prompt, ">> ");
  const five_emoji = "\u{1F600}".repeat(5);
  assert.equal(build_config(config_dir_with({ "settings.toml": `cmdline_prompt = "${five_emoji}"` }), commands).settings.cmdline_prompt, five_emoji);
  for (const bad of ['""', '"123456789"', '"a\\nb"', "5"]) {
    assert.match(problems_of(config_dir_with({ "settings.toml": `cmdline_prompt = ${bad}` })).join("\n"), /settings\.toml: cmdline_prompt: /);
  }
});

test("a bare palette name such as moonlight is an error that lists the oasis_ names", () => {
  assert.match(problems_of(config_dir_with({ "settings.toml": 'palette = "moonlight"' })).join("\n"), /settings\.toml: palette: no theme named "moonlight" \(known: oasis_abyss, .*oasis_moonlight/);
});

test("light_intensity is a whole number from 1 to 5, and defaults to 3 by being absent", () => {
  assert.equal(build_config(config_dir_with({ "settings.toml": "light_intensity = 5" }), commands).settings.light_intensity, 5);
  for (const bad of ["0", "6", "2.5", '"3"']) {
    assert.match(problems_of(config_dir_with({ "settings.toml": `light_intensity = ${bad}` })).join("\n"), /settings\.toml: light_intensity: .*1 to 5/);
  }
});

test("a local theme that still uses the old role names is an error", () => {
  const dir = config_dir_with({ "themes/old.toml": '[dark]\nbg = "#000"\nfg = "#fff"\nmuted = "#888"\nprimary = "#fff"\naccent = "#fff"' });
  const problems = problems_of(dir).join("\n");
  assert.match(problems, /old\.toml: \[dark\] bg: unknown role \(valid: bg_core,/);
  assert.match(problems, /old\.toml: \[dark\] muted: unknown role/);
  assert.match(problems, /old\.toml: \[dark\]: missing required role bg_core/);
});

const LOCAL_THEME = '[dark]\nbg_core = "#101010"\nfg_core = "#eeeeee"\nprimary = "#88aaff"\naccent = "#ffcc66"\n';

test("palette picks a local theme from the config directory's themes folder", () => {
  const dir = config_dir_with({ "settings.toml": 'palette = "mine"', "themes/mine.toml": LOCAL_THEME });
  const config = build_config(dir, commands);
  assert.equal(config.local_theme?.name, "mine");
  assert.equal(config.local_theme?.colors.light.bg_core, "#101010");
  assert.equal(config.local_theme?.colors.dark.mode_normal, "#88aaff");
});

test("a local theme wins over a repo theme of the same name", () => {
  const dir = config_dir_with({ "settings.toml": 'palette = "shared"', "themes/shared.toml": LOCAL_THEME });
  assert.equal(build_config(dir, commands, [], ["shared"]).local_theme?.colors.dark.bg_core, "#101010");
});

test("a repo theme or an Oasis theme needs no local theme in the output", () => {
  const repo = config_dir_with({ "settings.toml": 'palette = "shared"' });
  assert.equal(build_config(repo, commands, [], ["shared"]).local_theme, undefined);
  const builtin = config_dir_with({ "settings.toml": 'palette = "oasis_cactus"', "themes/mine.toml": LOCAL_THEME });
  assert.equal(build_config(builtin, commands).local_theme, undefined);
});

test("every local theme file is checked, even one palette does not pick", () => {
  const dir = config_dir_with({ "themes/broken.toml": '[dark]\nbg_core = "#000"\nfg_core = "nope"\nprimary = "#fff"\naccent = "#fff"\nbg_mantel = "#111"', "themes/notes.txt": "x" });
  const problems = problems_of(dir).join("\n");
  assert.match(problems, /themes\/broken\.toml: \[dark\] fg_core: expected a color/);
  assert.match(problems, /themes\/broken\.toml: \[dark\] bg_mantel: unknown role \(valid: bg_core, bg_mantle,/);
  assert.match(problems, /themes\/notes\.txt: unknown file/);
});

test("settings, aliases, css and the format version come through", () => {
  const config = full();
  assert.equal(config.format_version, 2);
  assert.deepEqual(config.settings, { which_key_delay_ms: 150, hint_letters: "abcdef" });
  assert.deepEqual(config.command_aliases, { nt: "tab.next" });
  assert.equal(config.css, "body { color: red; }\n\n:root { --desertfox-bg-core: black; }\n");
});

test("quickmarks merge from the main file and the .d files, and the later file wins", () => {
  const dir = config_dir_with({ "quickmarks.toml": 'g = "https://github.com"\nw = "https://wiki.test"', "quickmarks.d/10-x.toml": 'g = "https://git.test"' }, join(FIXTURES, "full"));
  assert.deepEqual(build_config(dir, commands).quickmarks, { g: "https://git.test", w: "https://wiki.test" });
  assert.deepEqual(full().quickmarks, {});
});

test("a quickmark needs a one character key and a non-empty address", () => {
  const dir = config_dir_with({ "quickmarks.toml": 'gh = "https://github.com"\n"!" = "https://bang.test"\ne = ""\nn = 5\nok = "https://ok.test"\nfine = 1' }, join(FIXTURES, "full"));
  const text = problems_of(dir).join("\n");
  assert.match(text, /quickmarks\.toml: gh: a quickmark key is one letter or digit/);
  assert.match(text, /quickmarks\.toml: !: a quickmark key is one letter or digit/);
  assert.match(text, /quickmarks\.toml: e: a quickmark maps to an address string/);
  assert.match(text, /quickmarks\.toml: n: a quickmark maps to an address string/);
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

test("bad bindings name the file and the key", () => {
  const dir = config_dir_with({
    "keymap.toml": [
      "[normal]",
      'a = "tab.nope"',
      'b = "tab.close --up"',
      'c = "tab.close --depth=1"',
      'd = "open.search --engine=ghost"',
      'e = "open.url --container=Work"',
      'f = "open.search --engine=alpha --depth=deep"',
      'g = { id = "tab.next" }',
      'h = "tab.next now"',
      'i = "tab.close --left --right"',
      'j = "open.url --tab --window"',
      "",
    ].join("\n"),
    "search_engines.toml": 'alpha = { url = "u%s", label = "A" }',
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /keymap\.toml: keymap normal "a": unknown command "tab\.nope"/);
  assert.match(text, /keymap normal "b": unknown flag "--up" for tab\.close/);
  assert.match(text, /keymap normal "c": unknown param "depth" for tab\.close/);
  assert.match(text, /keymap normal "d": engine expects one of duck, site, alpha/);
  assert.match(text, /keymap normal "f": depth expects a whole number/);
  assert.match(text, /keymap\.normal\["g"\] must be a command string/);
  assert.match(text, /keymap normal "h": "now" is not a flag or subject/);
  assert.match(text, /keymap normal "i": focus is set twice/);
  assert.match(text, /keymap normal "j": where is set twice/);
  assert.match(text, /keymap normal "e": container needs where tab, background or window/);
});

test("a dropped command name is a config error, not a warning", () => {
  const dir = config_dir_with({ "keymap.toml": '[normal]\na = "tabclose"\nb = "search arch cats"' });
  const warnings: string[] = [];
  assert.throws(() => build_config(dir, commands, warnings), (error: unknown) => error instanceof ConfigErrors && /keymap normal "a": unknown command "tabclose"/.test(error.problems.join("\n")));
  assert.deepEqual(warnings, []);
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

test("a snippet cannot use a group DesertFox uses", () => {
  const dir = config_dir_with({
    "snippets/a.js": "// id: tab.mine\n// label: L\n// intent: I\n// matches: *://*/*\n",
  });
  assert.match(problems_of(dir).join("\n"), /a\.js: id "tab\.mine" uses the group "tab"/);
});

test("bindings can run a snippet command and check its args", () => {
  const dir = config_dir_with(
    { "keymap.d/90-snippet.toml": '[normal]\ngi = "myapp.toggle_ids --all=yes"' },
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

test("one schema per data file offers command names", (t) => {
  const dir = make_tmp_dir("desertfox-schemas-", t);
  write_schemas(dir, build_schemas(commands));
  assert.deepEqual(readdirSync(dir).sort(), [
    "command_aliases.schema.json", "keymap.schema.json", "quickmarks.schema.json", "search_engines.schema.json", "settings.schema.json",
  ]);
  const keymap_text = readFileSync(join(dir, "keymap.schema.json"), "utf8");
  assert.match(keymap_text, /"search"/);
  assert.match(keymap_text, /"tab\.close"/);
});

const SNIPPET_HEADER = "// label: L\n// intent: I\n// matches: *://*/*\n";

test("a binding that leaves out a required param without a prompt is a problem, a defaulted param is fine", () => {
  const dir = config_dir_with({
    "keymap.toml": '[normal]\no = "open.url"\ns = "open.search"\nw = ":open"',
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /keymap normal "o": missing <url>/);
  assert.doesNotMatch(text, /keymap normal "[sw]"/);
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

test("a search engine url needs a query slot", () => {
  const dir = config_dir_with({ "search_engines.toml": 'alpha = { url = "https://a.example/", label = "A" }' });
  assert.match(problems_of(dir).join("\n"), /engine "alpha" has no \{query\} in its url/);
});

const GITHUB_TREE = [
  "[github]",
  'label = "GitHub"',
  'url = "https://github.com/search?q={scope}{query}&type={type}"',
  'scope = ""',
  "[github.params.type]",
  'default = "code"',
  "children = true",
  'values = { code = "code", issues = "issues", prs = "pullrequests" }',
  "[github.repo]",
  'label = "this repo"',
  'scope = "repo:{repo} "',
  'type = { only = ["code", "issues"] }',
].join("\n");

const engines_of = (toml: string) => build_config(config_dir_with({ "search_engines.toml": toml }), commands).search_engines;

test("an engine tree builds a flat map keyed by the dotted name", () => {
  const engines = engines_of(GITHUB_TREE);
  assert.deepEqual(Object.keys(engines).sort(), ["github", "github.code", "github.issues", "github.prs", "github.repo", "github.repo.code", "github.repo.issues"]);
  assert.equal(engines["github.repo.issues"]?.url, "https://github.com/search?q=repo:{repo} {query}&type=issues");
  assert.equal(engines["github.repo.issues"]?.label, "GitHub: this repo: issues");
  assert.deepEqual(engines["github.repo.issues"]?.slots, ["repo"]);
});

test("a flat legacy engine fills to the URL it gave before", () => {
  const engines = engines_of('q = { url = "https://a.example/s?q=a+%s&x=1#f", label = "Q" }');
  assert.deepEqual(fill_template(engines["q"]!.url, { query: "a b&c" }), { ok: true, url: "https://a.example/s?q=a+a%20b%26c&x=1#f" });
});

test("an unknown slot in an engine url is an error", () => {
  assert.match(problems_of(config_dir_with({ "search_engines.toml": 'a = { url = "u?{query}{nope}", label = "A" }' })).join("\n"), /engine "a" uses the unknown slot \{nope\}/);
});

test("a param that no url uses is an error", () => {
  const toml = ['[a]', 'label = "A"', 'url = "u?{query}"', "[a.params.type]", 'values = { x = "x" }'].join("\n");
  assert.match(problems_of(config_dir_with({ "search_engines.toml": toml })).join("\n"), /param "type" is not used by any url under it/);
});

test("a value outside the declared list is an error, in a child and in only", () => {
  const assigned = GITHUB_TREE.replace('type = { only = ["code", "issues"] }', 'type = "nope"');
  assert.match(problems_of(config_dir_with({ "search_engines.toml": assigned })).join("\n"), /type = "nope" is outside the declared list/);
  const narrowed = GITHUB_TREE.replace('["code", "issues"]', '["code", "ghost"]');
  assert.match(problems_of(config_dir_with({ "search_engines.toml": narrowed })).join("\n"), /type\.only names ghost, outside the declared list/);
});

test("a fallback to a missing engine is an error", () => {
  const dir = config_dir_with({ "search_engines.toml": 'a = { url = "u?{query}{repo}", label = "A", fallback = "ghost" }' });
  assert.match(problems_of(dir).join("\n"), /engine "a" has fallback "ghost", which is not an engine/);
});

test("fallbacks that loop are an error", () => {
  const toml = 'a = { url = "u?{query}", label = "A", fallback = "b" }\nb = { url = "v?{query}", label = "B", fallback = "a" }';
  assert.match(problems_of(config_dir_with({ "search_engines.toml": toml })).join("\n"), /fallbacks loop: a -> b -> a/);
});

test("the default engine cannot need a page slot", () => {
  const dir = config_dir_with({
    "search_engines.toml": 'a = { url = "u?{query}{repo}", label = "A" }',
    "settings.toml": 'default_engine = "a"',
  });
  assert.match(problems_of(dir).join("\n"), /default_engine "a" needs the page slot \{repo\}/);
});

test("a child named like a field is rejected as reserved", () => {
  const toml = ['[a]', 'label = "A"', 'url = "u?{query}"', "[a.fallback]", 'url = "v?{query}"'].join("\n");
  assert.match(problems_of(config_dir_with({ "search_engines.toml": toml })).join("\n"), /child name "fallback" is reserved/);
});

test("a later file replaces the table at one dotted path and leaves the parent", () => {
  const dir = config_dir_with({
    "search_engines.toml": GITHUB_TREE,
    "search_engines.d/10-mine.toml": ["[github.repo]", 'label = "my repo"', 'scope = "repo:{repo} lang:ts "'].join("\n"),
  });
  const engines = build_config(dir, commands).search_engines;
  assert.equal(engines["github.repo"]?.label, "GitHub: my repo");
  assert.equal(engines["github.repo"]?.url, "https://github.com/search?q=repo:{repo} lang:ts {query}&type=code");
  assert.equal(engines["github.issues"]?.url, "https://github.com/search?q={query}&type=issues");
  // The narrowing lived in the replaced table, so all values are generated now.
  assert.ok(engines["github.repo.prs"]);
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

test("snippet short= gives a bool or valued param a letter and an enum a value-to-letter map", () => {
  const problems: string[] = [];
  const header = "// id: a.b\n// label: L\n// intent: I\n// matches: *://*/*\n";
  const entry = parse_snippet("s.js", `${header}// param: all bool short=a\n// param: where enum values=here,tab,window default=here short=tab:t,window:w\n`, problems);
  assert.deepEqual(problems, []);
  assert.deepEqual(entry?.params, [
    { name: "all", type: "bool", short: "a" },
    { name: "where", type: "enum", values: ["here", "tab", "window"], default: "here", short: { tab: "t", window: "w" } },
  ]);
  parse_snippet("s.js", `${header}// param: where enum values=here,tab short=tab\n`, problems);
  assert.match(problems.join("\n"), /short "tab" on "where" must be value:letter/);
});

test("a snippet short letter gets the define-time checks", () => {
  const header = "// label: L\n// intent: I\n// matches: *://*/*\n";
  const dir = config_dir_with({
    "snippets/a.js": `// id: myapp.one\n${header}// param: a bool short=h\n`,
    "snippets/b.js": `// id: myapp.two\n${header}// param: a bool short=x\n// param: b bool short=x\n`,
  });
  const text = problems_of(dir).join("\n");
  assert.match(text, /a\.js: .*"h" is reserved/);
  assert.match(text, /b\.js: .*-x is also used/);
});

test("an engine name that starts with a dash draws a warning", () => {
  const dir = config_dir_with({ "search_engines.toml": '"-odd" = { url = "o%s", label = "Odd" }\nfine = { url = "f%s", label = "Fine" }' });
  const warnings: string[] = [];
  build_config(dir, commands, warnings);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /engine "-odd" starts with "-".*--engine=-odd/);
});

test("contract: build_commands_file output feeds build-config", (t) => {
  const registry = create_registry();
  registry.define("tab.close", {
    label: "Close Tab",
    intent: "Close the current tab.",
    params: [{ name: "focus", type: "enum", values: ["right", "left"], default: "right" } as never],
    runs_in: "background",
    run: () => {},
  });
  const dir = make_tmp_dir("desertfox-contract-", t);
  const commands_path = join(dir, "commands.json");
  writeFileSync(commands_path, JSON.stringify(build_commands_file(registry)));
  const config_dir = config_dir_with({ "keymap.toml": '[normal]\nD = "tab.close --left"' });
  const config = build_config(config_dir, read_commands_file(commands_path));
  assert.deepEqual(config.keymap.normal?.["D"], { id: "tab.close", args: { focus: "left" } });
});

test("a binding in a mode the command does not allow is a problem", () => {
  const dir = config_dir_with({ "keymap.toml": '[ignore]\nx = "tab.close"' });
  assert.match(problems_of(dir).join("\n"), /tab\.close runs in normal mode, not ignore/);
});

test("a leading colon stores a prompt, and the @source becomes its prefill", () => {
  const dir = config_dir_with({
    "keymap.toml": '[normal]\ngO = ":open --tab @current_url"\ngo = ":open"\ngp = "open @clipboard"\ngq = ":open --url=@selection --where=window"',
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
  const dir = config_dir_with({ "keymap.toml": '[normal]\na = ":tab.next"\nb = "open.url --where=@selection"\nc = ":nope"' });
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

test("the first bare word picks the engine, --engine= does too and -- stops the detection", () => {
  const dir = config_dir_with({
    "keymap.toml": [
      "[normal]",
      'a = "search alpha rust lifetimes"',
      'b = "search --engine=beta alpha centauri"',
      'c = "search -- alpha centauri"',
    ].join("\n"),
    "search_engines.toml": 'alpha = { url = "a%s", label = "A" }\nbeta = { url = "b%s", label = "B" }',
  });
  const warnings: string[] = [];
  const normal = build_config(dir, commands, warnings).keymap.normal;
  assert.deepEqual(normal?.["a"], { id: "open.search", args: { engine: "alpha", query: "rust lifetimes" } });
  assert.deepEqual(normal?.["b"], { id: "open.search", args: { engine: "beta", query: "alpha centauri" } });
  assert.deepEqual(normal?.["c"], { id: "open.search", args: { query: "alpha centauri" } });
  assert.deepEqual(warnings, []);
});

test("a binding can be a table with run and label, and the label lands on the invocation", () => {
  const dir = config_dir_with(
    { "keymap.d/20-label.toml": '[normal]\nJ = { run = "tab.next", label = "Down a tab" }\nM = { run = ["tab.close --left", "tab.prev"], label = "Close and step back" }\nL = { run = "tab.next" }' },
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

test("a snippet header requires names page slots, and an unknown name is an error", () => {
  const ok = config_dir_with({ "snippets/a.js": `// id: myapp.one\n// requires: repo, subreddit\n${SNIPPET_HEADER}` });
  assert.deepEqual(build_config(ok, commands).snippets[0]?.requires, ["repo", "subreddit"]);
  const bad = config_dir_with({ "snippets/a.js": `// id: myapp.one\n// requires: repo, ghost, query, title\n${SNIPPET_HEADER}` });
  assert.match(problems_of(bad).join("\n"), /unknown slot "ghost, query, title" in requires/);
});

test("an open_completion list with a repeated source is an error", () => {
  const dir = config_dir_with({ "settings.toml": 'open_completion = ["history", "history"]' });
  assert.match(problems_of(dir).join("\n"), /settings\.toml: open_completion: .*no repeat/);
});

test("a key bound to open -t with no url builds, the conditional url default fills it", () => {
  const dir = config_dir_with({ "keymap.toml": '[normal]\nt = "open -t"\nT = "open -w"' });
  const normal = build_config(dir, commands).keymap.normal;
  assert.deepEqual(normal?.["t"], { id: "open.url", args: { where: "tab" } });
  assert.deepEqual(normal?.["T"], { id: "open.url", args: { where: "window" } });
});

test("a keymap table accepts an intent and rejects an empty or non-string one", () => {
  const toml = (intent: string) => ({ "keymap.toml": `[normal]\nJ = { run = "tab.next", intent = ${intent} }` });
  const good = build_config(config_dir_with(toml('"Go to the next tab."')), commands);
  assert.equal((good.keymap.normal?.["J"] as { intent?: string }).intent, "Go to the next tab.");
  assert.match(problems_of(config_dir_with(toml('""'))).join("\n"), /an intent must not be empty/);
  assert.match(problems_of(config_dir_with(toml("5"))).join("\n"), /must be a command string/);
});

test("a keymap table with a list run puts the intent on the first command", () => {
  const dir = config_dir_with({ "keymap.toml": '[normal]\nJ = { run = ["tab.next", "tab.next"], intent = "Skip a tab." }' });
  const binding = build_config(dir, commands).keymap.normal?.["J"] as { id: string; intent?: string }[];
  assert.deepEqual(binding.map((step) => step.intent), ["Skip a tab.", undefined]);
});

test("the editor schema rejects the same label and intent text as the build", () => {
  const schema = build_schemas(commands)["keymap"] as { properties: { normal: { additionalProperties: { anyOf: { properties?: Record<string, { pattern: string }> }[] } } } };
  const table = schema.properties.normal.additionalProperties.anyOf[2]!.properties!;
  for (const field of ["label", "intent"]) {
    const pattern = new RegExp(table[field]!.pattern, "u");
    assert.equal(pattern.test("Fine text"), true);
    for (const bad of [" ", "\t", "a\nb", "a\u007Fb", "a\u0085b"]) assert.equal(pattern.test(bad), false, `${field} ${JSON.stringify(bad)}`);
  }
});

test("a site row bind is checked like a keymap binding", () => {
  const dir = config_dir_with({ "settings.toml": ['[[site_rules]]', 'site = "https://a.test/*"', 'bind = { j = { id = "tab.nope" }, k = { id = "tab.close", args = { depth = "x" } }, l = { id = "tab.next" } }', ""].join("\n") });
  const problems = problems_of(dir);
  assert.ok(problems.some((problem) => problem.includes('bind "j" of "https://a.test/*"') && problem.includes("tab.nope")), problems.join("\n"));
  assert.ok(problems.some((problem) => problem.includes('bind "k"')), problems.join("\n"));
  assert.equal(problems.some((problem) => problem.includes('bind "l"')), false);
});

test("a site row bind that waits for a key press is refused", () => {
  const key_command = { id: "mark.add", label: "Add mark", intent: "Save a mark under the next key.", params: [{ name: "slot", type: "key" }], runs_in: "content" };
  const dir = config_dir_with({ "settings.toml": ['[[site_rules]]', 'site = "https://a.test/*"', 'bind = { j = { id = "mark.add" }, k = { id = "mark.add", args = { slot = "a" } } }', ""].join("\n") });
  let problems: string[] = [];
  try {
    build_config(dir, [...commands, key_command] as never);
  } catch (error) {
    problems = (error as ConfigErrors).problems;
  }
  assert.ok(problems.some((problem) => problem.includes('bind "j"') && problem.includes("cannot wait for a key press")), problems.join("\n"));
  assert.equal(problems.some((problem) => problem.includes('bind "k"')), false, problems.join("\n"));
});

test("a binding may leave out the count param in a mode with counts, and a Firefox shortcut may not", (t) => {
  const registry = create_registry();
  registry.define("demo.jump", {
    label: "Jump",
    intent: "Jump to the percent the count gives.",
    params: [{ name: "times", type: "int", min: 1 }],
    count: { param: "times" },
    runs_in: "background",
    run: () => {},
  });
  const dir = make_tmp_dir("desertfox-count-", t);
  const commands_path = join(dir, "commands.json");
  writeFileSync(commands_path, JSON.stringify(build_commands_file(registry)));
  const config_dir = config_dir_with({ "keymap.toml": '[normal]\n"%" = "demo.jump"\n[browser]\n"<A-j>" = "demo.jump"' });
  let problems: string[] = [];
  try {
    build_config(config_dir, read_commands_file(commands_path));
  } catch (error) {
    if (!(error instanceof ConfigErrors)) throw error;
    problems = error.problems;
  }
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0]!, /keymap browser "<A-j>": missing <times>/);
});
