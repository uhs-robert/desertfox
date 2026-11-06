// The `s/` group: engines tied to sites by `hosts`, letters from `[site_keys]`, and what a page sees of them.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { requirement_lookup, site_engine_for, with_site_engines } from "../src/background/availability.ts";
import { compile_config } from "../src/background/compile.ts";
import { pick_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { list_keys, without_unavailable } from "../src/background/list_keys.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import type { TreeBranch, TreeLeaf } from "../src/shared/prefix_tree.ts";
import { build_commands_file, registry } from "../src/shared/registry/index.ts";
import { build_config } from "../tools/build-config/build_config.ts";
import { ConfigErrors } from "../src/shared/config_build/errors.ts";

const commands = build_commands_file(registry).commands;

const ENGINES = `
[github]
label = "GitHub"
hosts = ["github.com", "www.github.com"]
url = "https://github.com/search?q={scope}{query}&type={type}"
scope = ""

[github.params.type]
default = "code"
children = true
values = { code = "code", issues = "issues", repos = "repositories" }

[github.repo]
label = "this repo"
scope = "repo:{repo} "
type = { only = ["code", "issues"] }

[gitlab]
label = "GitLab"
hosts = ["gitlab.com"]
url = "https://gitlab.com/search?search={query}"
`;

const KEYMAP = `
[site_keys]
i = ["github.issues", "gitlab"]
I = ["github.repo.issues"]
r = ["github.repos"]
`;

function config_dir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "desertfox-site-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

function problems_of(files: Record<string, string>): string {
  try {
    build_config(config_dir(files), commands);
  } catch (error) {
    if (error instanceof ConfigErrors) return error.problems.join("\n");
    throw error;
  }
  return assert.fail("expected the build to reject the config");
}

const built = () => {
  const stored = build_config(config_dir({ "search_engines.toml": ENGINES, "keymap.toml": KEYMAP }), commands);
  return pick_config(stored, undefined).config;
};

const REPO_PAGE = { url: "https://github.com/uhs-robert/desertfox/issues" };
const USER_PAGE = { url: "https://github.com/uhs-robert" };
const OTHER_PAGE = { url: "https://example.com/wiki" };
const ABOUT_PAGE = { url: "about:blank" };

function keys_on(page: { url: string } | undefined, prefix: "s" | "S"): string[] {
  const config = built();
  const { compiled } = compile_config({ config, default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: Object.keys(config.search_engines), containers: [] } });
  const shown = without_unavailable(compiled.modes.normal!, {
    page,
    requirement_of: requirement_lookup(config),
    site_engine_label_of: (invocation) => config.search_engines[site_engine_for(config.search_engines, invocation.site_search?.engines ?? [], page) ?? ""]?.label,
  });
  const group = (shown?.children[prefix] as TreeBranch | undefined)?.children["/"] as TreeBranch | undefined;
  return Object.keys(group?.children ?? {}).sort();
}

test("hosts is inherited by children and a child may replace it", () => {
  const engines = built().search_engines;
  assert.deepEqual(engines["github.repo.issues"]?.hosts, ["github.com", "www.github.com"]);
  assert.deepEqual(engines["github.issues"]?.hosts, ["github.com", "www.github.com"]);
  assert.deepEqual(engines.gitlab?.hosts, ["gitlab.com"]);
  assert.equal(engines.duck?.hosts, undefined);
  const replaced = build_config(config_dir({ "search_engines.toml": ENGINES.replace('scope = "repo:{repo} "', 'scope = "repo:{repo} "\nhosts = ["ghe.example"]') }), commands).search_engines;
  assert.deepEqual(replaced["github.repo"]?.hosts, ["ghe.example"]);
  assert.deepEqual(replaced["github.issues"]?.hosts, ["github.com", "www.github.com"]);
});

test("the build refuses a bad hosts list", () => {
  for (const hosts of ['"github.com"', "[]", '["https://github.com"]', '["*.github.com"]', '["GitHub.com"]', "[1]"]) {
    assert.match(problems_of({ "search_engines.toml": `[a]\nurl = "https://a.example/?q={query}"\nhosts = ${hosts}` }), /hosts must be a non-empty list of host names/, hosts);
  }
});

test("the build refuses hosts on a node with no url on it or above it", () => {
  assert.match(problems_of({ "search_engines.toml": '[a]\nhosts = ["a.example"]\n[a.b]\nurl = "https://a.example/?q={query}"' }), /hosts on "a" belong to no engine/);
});

test("the build refuses a site key that is a sequence, the reserved letter, an unknown engine or two engines on one site", () => {
  const refused = (site_keys: string) => problems_of({ "search_engines.toml": ENGINES, "keymap.toml": `[site_keys]\n${site_keys}` });
  assert.match(refused('"ab" = ["gitlab"]'), /site_keys "ab": must be one key/);
  assert.match(refused('"/" = ["gitlab"]'), /site_keys "\/": "\/" is reserved/);
  assert.match(refused('x = ["ghost"]'), /site_keys "x": unknown search engine "ghost"/);
  assert.match(refused('x = ["github.issues", "github.repo.issues"]'), /"github.issues" and "github.repo.issues" fit the same site/);
  assert.match(refused('x = ["gitlab", "duck"]'), /"gitlab" and "duck" fit the same site/);
  assert.match(refused("x = []"), /must be a non-empty list of engine names/);
});

test("an engine with no hosts overlaps nothing it is not listed with, and disjoint hosts share a letter", () => {
  assert.doesNotThrow(() => built());
});

test("s/ on a GitHub repo page lists GitHub-wide and repo engines, plus the site search", () => {
  assert.deepEqual(keys_on(REPO_PAGE, "s"), ["/", "I", "i", "r"]);
});

test("s/ on a GitHub user page lists GitHub-wide engines only, plus the site search", () => {
  assert.deepEqual(keys_on(USER_PAGE, "s"), ["/", "i", "r"]);
});

test("s/ on an unrelated site lists only the site search", () => {
  assert.deepEqual(keys_on(OTHER_PAGE, "s"), ["/"]);
});

test("s// shows on every site that has an address and hides where the page has no host", () => {
  for (const page of [REPO_PAGE, USER_PAGE, OTHER_PAGE, { url: "https://gitlab.com/a/b" }]) assert.ok(keys_on(page, "s").includes("/"), page.url);
  assert.deepEqual(keys_on(ABOUT_PAGE, "s"), []);
});

test("S/ holds the same members as s/", () => {
  assert.deepEqual(keys_on(REPO_PAGE, "S"), keys_on(REPO_PAGE, "s"));
});

test("a letter runs the engine of the page's site", () => {
  const engines = built().search_engines;
  const run = (page: { url: string } | undefined, letter: string, prefix: "s" | "S") => {
    const config = built();
    const { compiled } = compile_config({ config, default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: Object.keys(config.search_engines), containers: [] } });
    const leaf = ((compiled.modes.normal!.children[prefix] as TreeBranch).children["/"] as TreeBranch).children[letter] as TreeLeaf;
    return with_site_engines([leaf.steps[0]!.invocation], engines, page);
  };
  const invocation = (page: { url: string } | undefined, letter: string, prefix: "s" | "S") => {
    const settled = run(page, letter, prefix);
    assert.ok("invocations" in settled, `${letter} on ${page?.url} refused`);
    return settled.invocations[0]!;
  };
  assert.equal(invocation(REPO_PAGE, "i", "s").args?.engine, "github.issues");
  assert.equal(invocation({ url: "https://gitlab.com/a/b" }, "i", "s").args?.engine, "gitlab");
  assert.equal(invocation(REPO_PAGE, "I", "s").args?.engine, "github.repo.issues");
  assert.deepEqual(run(OTHER_PAGE, "i", "s"), { unfit_letter: "i" }, "a page that fits none refuses");
  const tab = invocation(REPO_PAGE, "i", "S");
  assert.equal(tab.args?.where, "tab");
  assert.equal("site_search" in tab, false);
  assert.equal(invocation(OTHER_PAGE, "/", "s").args?.engine, "site");
});

test("the site engine is the default engine with the site term, and a user entry replaces it", () => {
  assert.equal(built().search_engines.site?.url, "https://duckduckgo.com/?q=site:{host}+{query}");
  const google = pick_config(build_config(config_dir({ "search_engines.toml": 'google = { url = "https://www.google.com/search?q=%s", label = "Google" }', "settings.toml": 'default_engine = "google"' }), commands), undefined).config;
  assert.equal(google.search_engines.site?.url, "https://www.google.com/search?q=site:{host}+{query}");
  const own = pick_config(build_config(config_dir({ "search_engines.toml": 'site = { url = "https://x.example/?q={host}+{query}", label = "Mine" }' }), commands), undefined).config;
  assert.equal(own.search_engines.site?.label, "Mine");
});

test("which-key lists the stored tree through list_keys with the page fit", async () => {
  const config = built();
  const { compiled } = compile_config({ config, default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: Object.keys(config.search_engines), containers: [] } });
  const storage = { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: compiled }) } as never;
  const availability = { page: OTHER_PAGE, requirement_of: requirement_lookup(config), site_engine_label_of: () => "Site" };
  const panel = await list_keys(storage, (id) => registry.get(id), { mode: "normal", prefix: ["s", "/"] }, availability);
  assert.deepEqual(panel.title, ["+Search here", "+Site search"]);
});

const normal_children_on = (page: { url: string } | undefined, site_engine_label_of: boolean) => {
  const config = built();
  const { compiled } = compile_config({ config, default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: Object.keys(config.search_engines), containers: [] } });
  const shown = without_unavailable(compiled.modes.normal!, {
    page,
    requirement_of: requirement_lookup(config),
    ...(site_engine_label_of ? { site_engine_label_of: (invocation) => config.search_engines[site_engine_for(config.search_engines, invocation.site_search?.engines ?? [], page) ?? ""]?.label } : {}),
  });
  return ((shown?.children.s as TreeBranch | undefined)?.children["/"] as TreeBranch | undefined)?.children ?? {};
};

test("a letter shared by several sites reads the label of the engine the page selects", () => {
  const label_on = (page: { url: string }) => (normal_children_on(page, true).i as TreeLeaf).label;
  assert.equal(label_on({ url: "https://gitlab.com/a/b" }), "GitLab");
  assert.equal(label_on(REPO_PAGE), "GitHub: issues");
});

test("a site key is hidden when nothing says which engine the page selects", () => {
  assert.deepEqual(Object.keys(normal_children_on(REPO_PAGE, false)), []);
});

test("the build refuses a search_keys letter / that s// would shadow, unless both generated keys are unbound", () => {
  const files = (normal: string) => ({ "search_engines.toml": ENGINES, "keymap.toml": `[search_keys]\n"/" = "gitlab"\n${normal}` });
  assert.match(problems_of(files("")), /search_keys "\/": "\/" is the key of the current site search/);
  assert.match(problems_of(files('[normal]\n"s//" = ""')), /search_keys "\/"/);
  assert.doesNotThrow(() => build_config(config_dir(files('[normal]\n"s//" = ""\n"S//" = ""')), commands));
});

test("a default engine that needs a page slot makes the site engine use DuckDuckGo, and the load warns", () => {
  const needs_page = { url: "https://x.example/?q={query}&r={repo}", label: "X", slots: ["repo"] };
  const raw = { format_version: 2, settings: { default_engine: "x" }, search_engines: { x: needs_page } };
  const loaded = pick_config(raw, undefined);
  assert.equal(loaded.config.search_engines.site?.url, "https://duckduckgo.com/?q=site:{host}+{query}");
  assert.ok(loaded.warnings.some((warning) => /default_engine "x" needs a page slot/.test(warning)));
});
