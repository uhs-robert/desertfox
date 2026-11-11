import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { CONFIG_FORMAT_VERSION } from "../../src/shared/config.ts";
import { compile_config } from "../../src/background/compile.ts";
import { FILES_CONFIG_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { create_router } from "../../src/background/router.ts";
import type { TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { make_fake } from "../background/fakes.ts";
import { check_args } from "../../src/shared/registry/index.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

type Opened = { via: string; url: string | undefined };

// A stub that answers every storage read with nothing, so the config falls back to the defaults.
// The config loads once per process, so every test shares these settings.
const SETTINGS = { home_page: "example.com" };

function install_browser(opened: Opened[]): void {
  const empty = async () => ({});
  const storage_area = { get: async () => ({}), set: empty, remove: empty };
  const local_area = { ...storage_area, get: async (key: string) => (key === FILES_CONFIG_STORAGE_KEY ? { [key]: { config: { format_version: CONFIG_FORMAT_VERSION, settings: SETTINGS }, warnings: [] } } : {}) };
  (globalThis as unknown as { browser: unknown }).browser = {
    storage: { local: local_area, session: storage_area, onChanged: { addListener() {} } },
    tabs: {
      get: async () => { throw new Error("No tab"); },
      query: async () => [],
      update: async (_id: number, props: { url: string }) => opened.push({ via: "update", url: props.url }),
      create: async (props: { url?: string; active?: boolean }) => opened.push({ via: `tab_${props.active ? "active" : "background"}`, url: props.url }),
    },
    windows: { create: async (props: { url?: string }) => opened.push({ via: "create", url: props.url }) },
    commands: { update: async () => undefined, reset: async () => undefined },
    contextualIdentities: { query: async () => [] },
    runtime: { onMessage: { addListener() {} }, getURL: (path: string) => `moz-extension://test/${path}` },
  };
}

const run = (id: string, args: Record<string, unknown>) =>
  (registry.get(id)!.run as (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>)({ tab_id: 1, window_id: 1 }, args);

test("open.url opens a hinted mailto: link as it is", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  await run("open.url", { url: "mailto:a@b.example", where: "here" });
  assert.deepEqual(opened, [{ via: "update", url: "mailto:a@b.example" }]);
});

test("open.url gives a bare domain https", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  await run("open.url", { url: "www.google.com", where: "here" });
  assert.deepEqual(opened, [{ via: "update", url: "https://www.google.com" }]);
});

test("window.new gives a bare domain https and stays blank without a url", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  await run("window.new", { url: "google.com", private: false });
  await run("window.new", { url: "  ", private: false });
  assert.deepEqual(opened, [{ via: "create", url: "https://google.com" }, { via: "create", url: undefined }]);
});

test("page.home gives a bare home_page https", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  await run("page.home", { where: "here" });
  assert.deepEqual(opened, [{ via: "update", url: "https://example.com" }]);
});

const NEW_TAB_URL = "moz-extension://test/newtab.html?builtin";

test("bare open with no url fails the check with missing <url>, and -t -b -w pass it", () => {
  const open = registry.get("open.url")!;
  assert.deepEqual(check_args(open, {}), { ok: false, error: "missing <url>", missing_param: "url" });
  assert.deepEqual(check_args(open, { url: "", where: "here" }), { ok: false, error: "missing <url>", missing_param: "url" });
  assert.deepEqual(check_args(open, { url: "    " }), { ok: false, error: "missing <url>", missing_param: "url" });
  for (const where of ["tab", "background", "window"]) assert.deepEqual(check_args(open, { where }), { ok: true, args: { url: "", where } });
});

test("open -t with no url opens the new tab page in a new tab", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  await run("open.url", { url: "", where: "tab" });
  assert.deepEqual(opened, [{ via: "tab_active", url: NEW_TAB_URL }]);
});

test("open -b with no url opens the new tab page in a background tab", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  await run("open.url", { url: "", where: "background" });
  assert.deepEqual(opened, [{ via: "tab_background", url: NEW_TAB_URL }]);
});

test("open -w with no url opens the new tab page in a new window", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  await run("open.url", { url: "", where: "window" });
  assert.deepEqual(opened, [{ via: "create", url: NEW_TAB_URL }]);
});

test("open.url opens a blob: link as it is", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  await run("open.url", { url: "blob:https://a.example/1234", where: "here" });
  assert.deepEqual(opened, [{ via: "update", url: "blob:https://a.example/1234" }]);
});

test("open.url shows a notice when Firefox refuses an about: page, and does not search", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  (globalThis as unknown as { browser: { tabs: { update: unknown } } }).browser.tabs.update = async () => {
    throw new Error("Illegal URL: about:config");
  };
  await assert.rejects(run("open.url", { url: "about:config", where: "here" }), /Firefox does not let extensions open about:config/);
  assert.deepEqual(opened, []);
});

test("open.url passes other errors on an about: page through unchanged", async () => {
  install_browser([]);
  (globalThis as unknown as { browser: { tabs: { update: unknown } } }).browser.tabs.update = async () => {
    throw new Error("No tab with id 1");
  };
  await assert.rejects(run("open.url", { url: "about:config", where: "here" }), /No tab with id 1/);
});

test("a binding with an explicit url prompt compiles to a prompting step, with no default filled in", () => {
  const keymap = { normal: { o: { id: "open.url", prompt: { param: "url" } }, e: { id: "open.url", args: { container: "Work", where: "tab" }, prompt: { param: "url" } } } };
  const { compiled } = compile_config({
    config: { ...empty_config(), keymap },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: ["Work"] },
  });
  const children = compiled.modes.normal!.children as unknown as Record<string, TreeLeaf>;
  assert.deepEqual(children.o!.steps[0]!.invocation.prompt, { param: "url" });
  assert.equal(children.o!.steps[0]!.runs_in, "background");
  assert.deepEqual(children.e!.steps[0]!.invocation.prompt, { param: "url" });
});

test("a compiled binding with an explicit url prompt opens the command line instead of the new tab page", async () => {
  const keymap = { normal: { o: { id: "open.url", prompt: { param: "url" } }, e: { id: "open.url", args: { container: "Work", where: "tab" }, prompt: { param: "url" } } } };
  const { compiled } = compile_config({ config: { ...empty_config(), keymap }, default_keymap: {}, get_command: (id) => registry.get(id), enum_sources: { search_engines: [], containers: ["Work"] } });
  const children = compiled.modes.normal!.children as unknown as Record<string, TreeLeaf>;
  for (const key of ["o", "e"]) {
    const { deps, log } = make_fake({});
    await create_router({ ...deps, get_command: (id) => registry.get(id), get_enum_sources: async () => ({ search_engines: [], containers: ["Work"] }) }).run({
      invocations: [children[key]!.steps[0]!.invocation],
      mode: "normal",
      may_prompt: true,
    });
    assert.equal(log.length, 1);
    assert.match(log[0]!, /^cmdline 7 0 open /);
  }
});

// The command line submits `{ id, args }` with the typed flags and no url, through the router.
async function submit_typed(args: Record<string, unknown>) {
  const { deps, log } = make_fake({});
  const result = await create_router({ ...deps, get_command: (id) => registry.get(id) }).run({ invocations: [{ id: "open.url", args }], mode: "normal", may_prompt: true });
  return { result, log };
}

test("typed open -t with no url runs and opens the new tab page, not the command line", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  const { log } = await submit_typed({ where: "tab" });
  assert.deepEqual(log, []);
  assert.deepEqual(opened, [{ via: "tab_active", url: NEW_TAB_URL }]);
});

test("typed bare open is refused and opens nothing", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  const { log } = await submit_typed({});
  assert.equal(log.length, 1);
  assert.match(log[0]!, /^refuse 7 .*missing <url>/);
  assert.deepEqual(opened, []);
});

test("a binding with a bad fixed arg still warns and is skipped", () => {
  const { compiled, warnings } = compile_config({
    config: { ...empty_config(), keymap: { normal: { o: { id: "open.url", args: { where: "nowhere" } } } } },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  assert.equal(compiled.modes.normal?.children.o, undefined);
  assert.equal(warnings.length, 1);
});

test("a binding with no url and no prompt warns and is skipped, with a prompt it stays", () => {
  const { compiled, warnings } = compile_config({
    config: { ...empty_config(), keymap: { normal: { gx: { id: "open.url" }, gy: { id: "open.url", prompt: { param: "url" } }, gt: { id: "open.url", args: { where: "tab" } } } } },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  const g = compiled.modes.normal!.children.g as unknown as { children: Record<string, unknown> };
  assert.equal(g.children.x, undefined);
  assert.ok(g.children.y && g.children.t);
  assert.equal(warnings.filter((warning) => warning.includes("missing <url>")).length, 1);
});

test("the router refuses a bare open and opens nothing", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  const { log } = await submit_typed({});
  assert.match(log[0]!, /^refuse 7 .*missing <url>/);
  assert.deepEqual(opened, []);
});

test("typed open -t with only spaces opens the new tab page, in the current tab it is refused", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  const { log } = await submit_typed({ url: "    ", where: "tab" });
  assert.deepEqual(log, []);
  assert.deepEqual(opened, [{ via: "tab_active", url: NEW_TAB_URL }]);
  const refused = await submit_typed({ url: "    " });
  assert.match(refused.log[0]!, /^refuse 7 .*missing <url>/);
});
