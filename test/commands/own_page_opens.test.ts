import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { CONFIG_FORMAT_VERSION } from "../../src/shared/config.ts";
import { FILES_CONFIG_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

// The config loads once per process, so this file holds the tests that need the built-in page as the home page.
const SETTINGS = { home_page: "desertfox" };
const OWN_PAGE = "moz-extension://test/home.html#grant";

function install_browser(opened: string[], clipboard_text: string): void {
  const empty = async () => ({});
  const storage_area = { get: async () => ({}), set: empty, remove: empty };
  const local_area = { ...storage_area, get: async (key: string) => (key === FILES_CONFIG_STORAGE_KEY ? { [key]: { config: { format_version: CONFIG_FORMAT_VERSION, settings: SETTINGS }, warnings: [] } } : {}) };
  (globalThis as unknown as { browser: unknown }).browser = {
    storage: { local: local_area, session: storage_area, onChanged: { addListener() {} } },
    tabs: {
      get: async () => ({ id: 1, windowId: 1, incognito: false }),
      query: async () => [],
      update: async (_id: number, props: { url: string }) => void opened.push(props.url),
      create: async (props: { url: string }) => (opened.push(props.url), { id: 2 }),
    },
    windows: { create: async (props: { url: string }) => void opened.push(props.url), get: async () => ({ incognito: false }) },
    commands: { update: async () => undefined, reset: async () => undefined },
    contextualIdentities: { query: async () => [] },
    runtime: { onMessage: { addListener() {} }, getURL: (path: string) => `moz-extension://test/${path}` },
  };
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { readText: async () => clipboard_text } }, configurable: true });
}

const run_from = (id: string, args: Record<string, unknown>, from_page: boolean) =>
  (registry.get(id)!.run as (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>)({ tab_id: 1, window_id: 1, frame_id: 0, mode: "normal", ...(from_page && { from_page: true }) }, args);

test("page.home opens the built-in page from a page key", async () => {
  const opened: string[] = [];
  install_browser(opened, "");
  await run_from("page.home", { where: "tab" }, true);
  assert.equal(opened.length, 1);
  assert.match(opened[0]!, /^moz-extension:\/\/test\/newtab\.html/);
});

// A page can write the clipboard, so an extension sender (a Firefox shortcut, a macro step) gets no pass either.
test("open.clipboard never opens the extension's own page, whoever sent the request", async () => {
  const opened: string[] = [];
  install_browser(opened, OWN_PAGE);
  for (const from_page of [false, true]) {
    await assert.rejects(run_from("open.clipboard", { where: "tab", register: "" }, from_page), /A page cannot open DesertFox's own pages/, String(from_page));
  }
  assert.deepEqual(opened, []);
});
