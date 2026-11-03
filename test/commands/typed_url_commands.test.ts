import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { CONFIG_FORMAT_VERSION } from "../../src/shared/config.ts";
import { registry } from "../../src/shared/registry/index.ts";

type Opened = { via: string; url: string | undefined };

// A stub that answers every storage read with nothing, so the config falls back to the defaults.
// The config loads once per process, so every test shares these settings.
const SETTINGS = { home_page: "example.com" };

function install_browser(opened: Opened[]): void {
  const empty = async () => ({});
  const storage_area = { get: async () => ({}), set: empty, remove: empty };
  (globalThis as unknown as { browser: unknown }).browser = {
    storage: { managed: { get: async () => ({ format_version: CONFIG_FORMAT_VERSION, settings: SETTINGS }) }, local: storage_area, onChanged: { addListener() {} } },
    tabs: { query: async () => [], update: async (_id: number, props: { url: string }) => opened.push({ via: "update", url: props.url }) },
    windows: { create: async (props: { url?: string }) => opened.push({ via: "create", url: props.url }) },
    commands: { update: async () => undefined, reset: async () => undefined },
    contextualIdentities: { query: async () => [] },
    runtime: { onMessage: { addListener() {} } },
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
