import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { CONFIG_FORMAT_VERSION } from "../../src/shared/config.ts";
import { runs_with_empty } from "../../src/background/availability.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { create_router } from "../../src/background/router.ts";
import { no_repeat_memory } from "../../src/background/repeat_memory.ts";
import { get_config } from "../../src/background/startup.ts";
import { current_page } from "../../src/commands/open_target.ts";
import type { BoundInvocation } from "../../src/shared/invocation.ts";
import type { TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { parse_command_line } from "../../src/shared/registry/index.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { parse_binding } from "../../src/shared/registry/parse_binding.ts";
import { build_config, read_commands_file } from "../../tools/build-config/build_config.ts";

const ENGINES = `
duck = { url = "https://duck.example/?q=%s", label = "Duck" }
[github]
label = "GitHub"
url = "https://github.com/search?q={scope}{query}&type={type}"
scope = ""
[github.params.type]
default = "code"
children = true
values = { code = "code", issues = "issues" }
[github.repo]
label = "this repo"
scope = "repo:{repo} "
[reddit]
label = "Reddit"
url = "https://www.reddit.com/search/?q={query}"
[reddit.sub]
label = "this subreddit"
url = "https://www.reddit.com/r/{subreddit}/search/?q={query}&restrict_sr=1"
fallback = "reddit"
[archive]
label = "Archive"
url = "https://web.archive.org/web/{query|url:raw}"
[repoq]
label = "Repo or query"
url = "https://r.example/{query|repo}"
[repot]
label = "Repo then title"
url = "https://r.example/{repo}/?q={query|title}"
fallback = "duck"
`;

// The resolved engines come from the real config build, so the test drives what a user would store.
function stored_engines() {
  const dir = mkdtempSync(join(tmpdir(), "desertfox-engines-"));
  writeFileSync(join(dir, "search_engines.toml"), ENGINES);
  const commands = read_commands_file(join(import.meta.dirname, "..", "fixtures", "build-config", "commands.json"));
  return build_config(dir, commands).search_engines;
}

type Opened = { url: string };
let page: { url: string; title?: string } | undefined;
const opened: Opened[] = [];

(globalThis as unknown as { browser: unknown }).browser = {
  storage: {
    managed: { get: async () => ({ format_version: CONFIG_FORMAT_VERSION, search_engines: stored_engines(), settings: { default_engine: "duck" } }) },
    local: { get: async () => ({}), set: async () => ({}), remove: async () => ({}) },
    session: { get: async () => ({}), set: async () => ({}) },
    onChanged: { addListener() {} },
  },
  tabs: { query: async () => [], get: async () => page, update: async (_id: number, props: { url: string }) => opened.push({ url: props.url }) },
  commands: { update: async () => undefined, reset: async () => undefined },
  contextualIdentities: { query: async () => [] },
  runtime: { onMessage: { addListener() {} } },
};

const search = (args: Record<string, unknown>) =>
  (registry.get("open.search")!.run as (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>)({ tab_id: 1, window_id: 1 }, { where: "here", ...args });

const last_url = () => opened.at(-1)?.url;

test("a dotted engine name on the command line reaches the engine", () => {
  const sources = { search_engines: Object.keys(stored_engines()), containers: [] };
  const result = parse_command_line(registry, "search github.repo.issues foo", sources);
  assert.equal(result.kind, "invocation", JSON.stringify(result));
  if (result.kind === "invocation") assert.deepEqual(result.invocation.args, { engine: "github.repo.issues", query: "foo" });
});

test("a repo engine puts the repo and the query together in q=", async () => {
  page = { url: "https://github.com/octo/cat/issues/3" };
  await search({ engine: "github.repo.issues", query: "bug & fix" });
  assert.equal(last_url(), "https://github.com/search?q=repo:octo%2Fcat%20bug%20%26%20fix&type=issues");
});

test("a repo engine off a repo page shows the slot message", async () => {
  page = { url: "https://example.com/" };
  await assert.rejects(search({ engine: "github.repo.issues", query: "x" }), /not in a GitHub repository/);
});

test("an engine with a fallback uses it when the slot cannot fill", async () => {
  page = { url: "https://www.reddit.com/r/rust/comments/1" };
  await search({ engine: "reddit.sub", query: "async" });
  assert.equal(last_url(), "https://www.reddit.com/r/rust/search/?q=async&restrict_sr=1");
  page = { url: "https://example.com/" };
  await search({ engine: "reddit.sub", query: "async" });
  assert.equal(last_url(), "https://www.reddit.com/search/?q=async");
});

test("the query-or-page slot takes the page address when there is no query, raw in the path", async () => {
  page = { url: "https://example.com/a?b=1" };
  await search({ engine: "archive", query: "" });
  assert.equal(last_url(), "https://web.archive.org/web/https://example.com/a?b=1");
  await search({ engine: "archive", query: "https://other.example/" });
  assert.equal(last_url(), "https://web.archive.org/web/https://other.example/");
});

test("a percent-s engine from a flat entry still searches", async () => {
  page = undefined;
  await search({ engine: "duck", query: "a b" });
  assert.equal(last_url(), "https://duck.example/?q=a%20b");
});

test("an engine that needs the page refuses when the tab cannot be read", async () => {
  page = undefined;
  await assert.rejects(search({ engine: "github.repo", query: "x" }), /not in a GitHub repository/);
});

// A config key as the router gets it: parsed, then compiled, which stores the defaults in the key.
function compiled_key(text: string): BoundInvocation {
  const sources = { search_engines: Object.keys(stored_engines()), containers: [] };
  const parsed = parse_binding(registry, text, sources);
  assert.equal(parsed.kind, "binding", JSON.stringify(parsed));
  if (parsed.kind !== "binding") throw new Error(text);
  const config = { ...empty_config(), keymap: { normal: { k: parsed.binding } } };
  const { compiled, warnings } = compile_config({ config, default_keymap: {}, get_command: (id) => registry.get(id), enum_sources: sources });
  assert.deepEqual(warnings, []);
  return (compiled.modes.normal!.children.k as TreeLeaf).steps[0]!.invocation;
}

async function press(text: string, selection: string): Promise<{ lines: string[]; refusals: string[] }> {
  const lines: string[] = [];
  const refusals: string[] = [];
  const router = create_router({
    get_command: (id) => registry.get(id),
    get_enum_sources: async () => ({ search_engines: Object.keys(stored_engines()), containers: [] }),
    active_tab: async () => ({ tab_id: 1, window_id: 1, url: page?.url }),
    has_content_script: async () => true,
    ask_selection: async () => selection,
    runs_with_empty: async (id, args, param) => runs_with_empty(await get_config(), id, args, param, page),
    read_clipboard: async () => "",
    has_permission: async () => true,
    send_to_tab: async () => undefined,
    open_cmdline: async (_tab, _frame, line) => void lines.push(line),
    show_refusal: async (_tab, refusal) => void refusals.push(refusal.message),
    repeat_memory: no_repeat_memory,
  });
  await router.run({ invocations: [compiled_key(text)], mode: "normal", may_prompt: true });
  return { lines, refusals };
}

test("a key on a query-or-page engine searches the page with nothing selected, and the selection when there is one", async () => {
  page = { url: "https://example.com/a" };
  opened.length = 0;
  assert.deepEqual(await press("search archive @selection", ""), { lines: [], refusals: [] });
  assert.equal(last_url(), "https://web.archive.org/web/https://example.com/a");
  assert.deepEqual(await press("search archive @selection", "https://other.example/"), { lines: [], refusals: [] });
  assert.equal(last_url(), "https://web.archive.org/web/https://other.example/");
});

test("a key on an engine that needs the query opens the command line with nothing selected, and searches a selection", async () => {
  page = { url: "https://example.com/a" };
  opened.length = 0;
  assert.deepEqual(await press("search duck @selection", ""), { lines: ["search duck "], refusals: [] });
  assert.equal(opened.length, 0);
  await press("search duck @selection", "a b");
  assert.equal(last_url(), "https://duck.example/?q=a%20b");
});

test("a key that names no engine opens the command line with nothing selected, and searches the default engine", async () => {
  page = { url: "https://example.com/a" };
  opened.length = 0;
  assert.deepEqual(await press("search @selection", ""), { lines: ["search "], refusals: [] });
  assert.equal(opened.length, 0);
  await press("search @selection", "a b");
  assert.equal(last_url(), "https://duck.example/?q=a%20b");
});

test("a key on another command with an empty selection still opens the command line", async () => {
  page = { url: "https://example.com/a" };
  assert.deepEqual(await press("open @selection", ""), { lines: ["open "], refusals: [] });
});

test("a key on a query-or-repo engine off a repo page opens the command line, and searches the repo on one", async () => {
  page = { url: "https://example.com/a" };
  opened.length = 0;
  assert.deepEqual(await press("search repoq @selection", ""), { lines: ["search repoq "], refusals: [] });
  assert.equal(opened.length, 0);
  page = { url: "https://github.com/octo/cat" };
  assert.deepEqual(await press("search repoq @selection", ""), { lines: [], refusals: [] });
  assert.equal(last_url(), "https://r.example/octo%2Fcat");
});

test("a key whose fallback needs the query opens the command line when the page sends it to the fallback", async () => {
  page = { url: "https://example.com/a", title: "A" };
  opened.length = 0;
  assert.deepEqual(await press("search repot @selection", ""), { lines: ["search repot "], refusals: [] });
  assert.equal(opened.length, 0);
  page = { url: "https://github.com/octo/cat", title: "Cat" };
  assert.deepEqual(await press("search repot @selection", ""), { lines: [], refusals: [] });
  assert.equal(last_url(), "https://r.example/octo%2Fcat/?q=Cat");
});

test("with no tab there is no page, so a query-only search still runs", async () => {
  assert.equal(await current_page({ tab_id: undefined, window_id: undefined, frame_id: 0, mode: "normal" }), undefined);
});
