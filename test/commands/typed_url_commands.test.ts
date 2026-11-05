import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { CONFIG_FORMAT_VERSION } from "../../src/shared/config.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { create_router } from "../../src/background/router.ts";
import type { TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { make_fake } from "../background/fakes.ts";
import { check_args, registry } from "../../src/shared/registry/index.ts";

type Opened = { via: string; url: string | undefined };

// A stub that answers every storage read with nothing, so the config falls back to the defaults.
// The config loads once per process, so every test shares these settings.
const SETTINGS = { home_page: "example.com" };

function install_browser(opened: Opened[]): void {
  const empty = async () => ({});
  const storage_area = { get: async () => ({}), set: empty, remove: empty };
  (globalThis as unknown as { browser: unknown }).browser = {
    storage: { managed: { get: async () => ({ format_version: CONFIG_FORMAT_VERSION, settings: SETTINGS }) }, local: storage_area, session: storage_area, onChanged: { addListener() {} } },
    tabs: {
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

test("bare open with no url is refused and opens nothing", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  const checked = check_args(registry.get("open.url")!, {});
  assert.equal(checked.ok, true);
  await assert.rejects(run("open.url", checked.ok ? checked.args : {}), /missing <url>/);
  assert.deepEqual(opened, []);
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

test("bare open with a blank url is refused and opens nothing", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  await assert.rejects(run("open.url", { url: "   ", where: "here" }), /missing <url>/);
  assert.deepEqual(opened, []);
});

test("open -t with a blank url opens the new tab page", async () => {
  const opened: Opened[] = [];
  install_browser(opened);
  await run("open.url", { url: "   ", where: "tab" });
  assert.deepEqual(opened, [{ via: "tab_active", url: NEW_TAB_URL }]);
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

test("a binding that omits the url compiles to a prompting step, with no default filled in", () => {
  const keymap = { normal: { o: { id: "open.url" }, e: { id: "open.url", args: { container: "Work", where: "tab" } } } };
  const { compiled } = compile_config({
    config: { ...empty_config(), keymap },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: ["Work"] },
  });
  const children = compiled.modes.normal!.children as unknown as Record<string, TreeLeaf>;
  assert.equal(children.o!.steps[0]!.invocation.args, undefined);
  assert.equal(children.o!.steps[0]!.runs_in, "background");
  assert.equal(children.e!.steps[0]!.invocation.args?.url, undefined);
});

test("a binding that omits the url opens the command line instead of the new tab page", async () => {
  for (const invocation of [{ id: "open.url" }, { id: "open.url", args: { container: "Work", where: "tab" } }]) {
    const { deps, log } = make_fake({});
    await create_router({ ...deps, get_command: (id) => registry.get(id), get_enum_sources: async () => ({ search_engines: [], containers: ["Work"] }) }).run({
      invocations: [invocation],
      mode: "normal",
      may_prompt: true,
    });
    assert.equal(log.length, 1);
    assert.match(log[0]!, /^cmdline 7 0 open /);
  }
});
