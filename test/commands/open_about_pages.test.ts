import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { attach_browser_module, browser_module_call } from "../../src/background/browser_module_call.ts";
import { BROWSER_MODULE_HELLO_STORAGE_KEY, BROWSER_MODULE_STATUS_STORAGE_KEY } from "../../src/shared/browser_module_protocol.ts";
import type { ModuleArgs } from "../../src/shared/browser_module_protocol.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

// A matched module whose hello says firefox_pages, answering every request ok through the real call machinery.
const requests: { kind: string; args: ModuleArgs }[] = [];
const opened: string[] = [];
const session_values: Record<string, unknown> = {
  [BROWSER_MODULE_HELLO_STORAGE_KEY]: { v: 1, module_version: "1.0.0", firefox_pages: true },
  [BROWSER_MODULE_STATUS_STORAGE_KEY]: { result: "matched", module_version: "1.0.0", module_v: 1 },
};
const empty = async () => ({});
(globalThis as unknown as { browser: unknown }).browser = {
  storage: {
    local: { get: empty, set: empty, remove: empty },
    session: { get: async (key: string) => (key in session_values ? { [key]: session_values[key] } : {}), set: empty, remove: empty },
    onChanged: { addListener() {} },
  },
  tabs: {
    get: async () => ({ id: 1, windowId: 1, incognito: false, url: "https://example.com/" }),
    query: async () => [],
    update: async (_id: number, props: { url: string }) => void opened.push(props.url),
    create: async (props: { url: string }) => (opened.push(props.url), { id: 2 }),
  },
  windows: { create: async (props: { url: string }) => void opened.push(props.url), get: async () => ({ incognito: false }) },
  commands: { update: async () => undefined, reset: async () => undefined },
  contextualIdentities: { query: async () => [{ name: "Work", cookieStoreId: "firefox-container-1" }] },
  runtime: { onMessage: { addListener() {} }, getURL: (path: string) => `moz-extension://test/${path}` },
};
let next_id = 0;
attach_browser_module({
  send: async (kind, args, on_id) => {
    const id = `m${next_id++}`;
    requests.push({ kind, args });
    on_id?.(id);
    queueMicrotask(() => browser_module_call.hear({ v: 1, reply_to: id, ok: true }));
    return { ok: true, id };
  },
  withdraw: async () => undefined,
});

const open_url = async (args: Record<string, unknown>, from_page = false) => {
  requests.length = 0;
  opened.length = 0;
  const run = registry.get("open.url")!.run as (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
  await run({ tab_id: 1, window_id: 1, frame_id: 0, mode: "normal", ...(from_page && { from_page: true }) }, args);
};

test(":open with the address of a :firefox page opens it through the module, here or in a tab", async () => {
  await open_url({ url: "about:addons", where: "tab" });
  assert.deepEqual(requests, [{ kind: "firefox_page.open", args: { page: "addons", where: "tab", tab_id: 1 } }]);
  await open_url({ url: " ABOUT:Settings#privacy ", where: "here" });
  assert.deepEqual(requests, [{ kind: "firefox_page.open", args: { page: "settings-privacy", where: "here", tab_id: 1 } }]);
  assert.deepEqual(opened, []);
});

test("an about: address a page sent is mapped like a typed one", async () => {
  await open_url({ url: "about:addons", where: "tab" }, true);
  assert.deepEqual(requests, [{ kind: "firefox_page.open", args: { page: "addons", where: "tab", tab_id: 1 } }]);
  assert.deepEqual(opened, []);
});

test("a page that sent an unlisted about: address keeps the refusal and the :firefox hint", async () => {
  await assert.rejects(open_url({ url: "about:telemetry", where: "tab" }, true), /DesertFox does not open about: addresses\. Use :firefox to open Firefox's own pages/);
  assert.deepEqual(requests, []);
});

test("a mapped address refuses a container, a background tab, a window, and the passwords page here", async () => {
  await assert.rejects(open_url({ url: "about:config", where: "tab", container: "Work" }), /no container/);
  await assert.rejects(open_url({ url: "about:config", where: "background" }), /here or in a tab/);
  await assert.rejects(open_url({ url: "about:config", where: "window" }), /here or in a tab/);
  await assert.rejects(open_url({ url: "about:config", where: "tab", container: "Work" }, true), /no container/);
  await assert.rejects(open_url({ url: "about:logins", where: "here" }), (error: unknown) => error instanceof Error && error.name === "RuntimeRefusal");
  assert.deepEqual(requests, []);
  assert.deepEqual(opened, []);
});

test("another about: address keeps its refusal and names :firefox, and about:blank still opens", async () => {
  await assert.rejects(open_url({ url: "about:telemetry", where: "tab" }), /DesertFox does not open about: addresses\. Use :firefox to open Firefox's own pages/);
  await assert.rejects(open_url({ url: "about:reader?url=https://example.com/", where: "tab" }), (error: unknown) => error instanceof Error && !error.message.includes(":firefox"));
  await open_url({ url: "about:blank", where: "tab" });
  assert.deepEqual(opened, ["about:blank"]);
  assert.deepEqual(requests, []);
});
