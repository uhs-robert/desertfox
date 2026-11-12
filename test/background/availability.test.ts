import assert from "node:assert/strict";
import { test } from "node:test";
import { available_engine_names, engine_requirement, is_available, requirement_lookup } from "../../src/background/availability.ts";
import { list_keys, without_unavailable } from "../../src/background/list_keys.ts";
import type { PageAvailability } from "../../src/background/list_keys.ts";
import type { SearchEngine } from "../../src/shared/config.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch, TreeNode } from "../../src/shared/prefix_tree.ts";

const REPO_PAGE = { url: "https://github.com/octo/cat/issues" };
const OTHER_PAGE = { url: "https://example.com/" };

const engines: Record<string, SearchEngine> = {
  duck: { url: "https://duck.example/?q={query}", label: "Duck" },
  "github.repo": { url: "https://github.com/search?q=repo:{repo} {query}", label: "GitHub: this repo", slots: ["repo"] },
  "reddit.sub": { url: "https://r.example/r/{subreddit}?q={query}", label: "this subreddit", slots: ["subreddit"], fallback: "duck" },
  named: { url: "https://x.example/{host|title}?q={query}", label: "Named", slots: ["host|title"] },
};

const search_leaf = (engine: string): TreeNode => ({ kind: "leaf", steps: [{ invocation: { id: "open.search", args: { engine } }, runs_in: "background", count_rule: "ignore" }] });
const other_leaf: TreeNode = { kind: "leaf", steps: [{ invocation: { id: "tab.next" }, runs_in: "background", count_rule: "ignore" }] };
const branch = (children: Record<string, TreeNode>): TreeBranch => ({ kind: "branch", children });

const availability = (page: { url: string } | undefined): PageAvailability => ({
  page,
  requirement_of: requirement_lookup({ search_engines: engines, snippets: [], settings: { default_engine: "duck" } }),
});

test("a requirement is met when the page fills every slot, and an alternative list needs one", () => {
  assert.equal(is_available(["repo"], REPO_PAGE), true);
  assert.equal(is_available(["repo"], OTHER_PAGE), false);
  assert.equal(is_available(["repo"], undefined), false);
  assert.equal(is_available(["host|title"], OTHER_PAGE), true);
  assert.equal(is_available(["host|title"], { url: "about:blank" }), false);
  assert.equal(is_available(["host|title"], { url: "about:blank", title: "T" }), true);
  assert.equal(is_available([], undefined), true);
});

test("an engine with a fallback asks nothing of the page", () => {
  assert.deepEqual(engine_requirement(engines["reddit.sub"]!), []);
  assert.deepEqual(engine_requirement(engines["github.repo"]!), ["repo"]);
});

test("available_engine_names lists the engines the page can run", () => {
  assert.deepEqual(available_engine_names(engines, OTHER_PAGE), ["duck", "reddit.sub", "named"]);
  assert.deepEqual(available_engine_names(engines, REPO_PAGE), ["duck", "github.repo", "reddit.sub", "named"]);
});

const root = branch({
  s: branch({ c: search_leaf("github.repo"), d: search_leaf("duck"), r: search_leaf("reddit.sub") }),
  g: branch({ i: search_leaf("github.repo") }),
  t: other_leaf,
});

test("a key whose engine needs a slot the page lacks is hidden, a fallback key never is", () => {
  const off = without_unavailable(root, availability(OTHER_PAGE))!;
  assert.deepEqual(Object.keys((off.children.s as TreeBranch).children), ["d", "r"]);
  const on = without_unavailable(root, availability(REPO_PAGE))!;
  assert.deepEqual(Object.keys((on.children.s as TreeBranch).children), ["c", "d", "r"]);
});

test("a group with no available key is hidden", () => {
  const off = without_unavailable(root, availability(OTHER_PAGE))!;
  assert.deepEqual(Object.keys(off.children), ["s", "t"]);
  assert.equal(without_unavailable(branch({ g: branch({ i: search_leaf("github.repo") }) }), availability(OTHER_PAGE)), undefined);
});

test("a search with no engine named checks the default engine", () => {
  const lookup = requirement_lookup({ search_engines: engines, snippets: [], settings: { default_engine: "github.repo" } });
  assert.deepEqual(lookup({ id: "open.search", args: { engine: "" } }), ["repo"]);
  assert.deepEqual(lookup({ id: "open.search" }), ["repo"]);
});

test("a snippet requirement comes from its requires list", () => {
  const snippet = { id: "app.x", label: "X", intent: "x", matches: ["*://*/*"], code: "", requires: ["repo"] };
  const lookup = requirement_lookup({ search_engines: engines, snippets: [snippet], settings: {} });
  assert.deepEqual(lookup({ id: "app.x" }), ["repo"]);
  assert.deepEqual(lookup({ id: "tab.next" }), []);
});

test("list_keys filters the panel by the page it is given", async () => {
  const keymap: CompiledKeymap = { format_version: COMPILED_KEYMAP_VERSION, modes: { normal: root }, mode_indicator: "always", which_key_delay_ms: 300, toast_ms: 3000, toast_error_ms: 6000 };
  const storage = { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) } as never;
  const keys = async (page: { url: string }) => (await list_keys(storage, () => undefined, { mode: "normal", prefix: ["s"] }, { availability: availability(page) })).rows.map((row) => row.keys);
  assert.deepEqual(await keys(OTHER_PAGE), ["d", "r"]);
  assert.deepEqual(await keys(REPO_PAGE), ["c", "d", "r"]);
  const top = (await list_keys(storage, () => undefined, { mode: "normal", prefix: [] }, { availability: availability(OTHER_PAGE) })).rows.map((row) => row.keys);
  assert.deepEqual(top, ["t", "s"]);
});
