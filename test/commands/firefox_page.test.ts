import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { NativeHostError } from "../../src/background/native_client.ts";
import type { NativeFailure } from "../../src/background/native_client.ts";
import { FIREFOX_PAGE_ADDRESSES, FIREFOX_PAGES, HOST_PAGE_NOTICE, make_open_firefox_page_handler } from "../../src/commands/firefox_page.ts";
import type { FirefoxPageDeps } from "../../src/commands/firefox_page.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const CTX: CommandContext = { tab_id: 1, window_id: 1, frame_id: 0, mode: "normal" };

function host_page_table(): Record<string, string> {
  const source = readFileSync(new URL("../../host/desertfox-host", import.meta.url), "utf8");
  const block = /^FIREFOX_PAGES = \{\n([\s\S]*?)\n\}$/m.exec(source);
  assert.ok(block, "FIREFOX_PAGES not found in host/desertfox-host");
  return Object.fromEntries([...block[1]!.matchAll(/^ {4}"(\w+)": "([^"]+)",$/gm)].map((match) => [match[1]!, match[2]!]));
}

test("the extension's page table equals the host's, key and address", () => {
  assert.deepEqual(host_page_table(), { ...FIREFOX_PAGE_ADDRESSES });
});

test("the command takes exactly the page keys and refuses anything else", () => {
  const def = registry.get("browser.open_firefox_page");
  assert.ok(def);
  assert.equal(def.bridge, false);
  for (const page of FIREFOX_PAGES) assert.deepEqual(check_args(def, { page }), { ok: true, args: { page } });
  for (const page of ["about:config", "Settings", "settings --profile", ""]) {
    assert.equal(check_args(def, { page }).ok, false, `accepted ${page}`);
  }
});

function make(failure?: NativeFailure | "other", over: Partial<FirefoxPageDeps> = {}) {
  const log = { opened: [] as string[], clipboard: [] as string[], toasts: [] as string[], notice_stored: false };
  const deps: FirefoxPageDeps = {
    open_page: async (page) => {
      log.opened.push(page);
      if (failure === "other") throw new Error("boom");
      if (failure !== undefined) throw new NativeHostError(failure, `host says ${failure}`);
    },
    write_clipboard: async (text) => void log.clipboard.push(text),
    notice_shown: async () => log.notice_stored,
    mark_notice_shown: async () => void (log.notice_stored = true),
    toast: async (_ctx, message) => void log.toasts.push(message),
    ...over,
  };
  return { run: make_open_firefox_page_handler(deps), log };
}

test("with the host the page opens and nothing is copied", async () => {
  const { run, log } = make();
  await run(CTX, { page: "config" });
  assert.deepEqual(log.opened, ["config"]);
  assert.deepEqual(log.clipboard, []);
  assert.deepEqual(log.toasts, []);
});

for (const failure of ["host_missing", "no_permission"] as const) {
  test(`without the host (${failure}) the address is copied and the host notice shows once`, async () => {
    const { run, log } = make(failure);
    await run(CTX, { page: "settings" });
    await run(CTX, { page: "memory" });
    assert.deepEqual(log.clipboard, ["about:preferences", "about:memory"]);
    assert.deepEqual(log.toasts, [`Copied about:preferences. Press Ctrl+L, then paste. ${HOST_PAGE_NOTICE}`, "Copied about:memory. Press Ctrl+L, then paste."]);
    assert.equal(log.notice_stored, true);
    assert.match(HOST_PAGE_NOTICE, /:native\.install/);
  });
}

test("a stored notice flag keeps the first no-host message short", async () => {
  const { run, log } = make("host_missing", { notice_shown: async () => true });
  await run(CTX, { page: "debugging" });
  assert.deepEqual(log.clipboard, ["about:debugging#/runtime/this-firefox"]);
  assert.deepEqual(log.toasts, ["Copied about:debugging#/runtime/this-firefox. Press Ctrl+L, then paste."]);
});

for (const failure of ["host_failed", "host_outdated", "bad_reply"] as const) {
  test(`a host that answers (${failure}) refuses with its message and copies nothing`, async () => {
    const { run, log } = make(failure);
    await assert.rejects(run(CTX, { page: "settings" }), (error: unknown) => error instanceof RuntimeRefusal && error.message === `host says ${failure}`);
    assert.deepEqual(log.clipboard, []);
    assert.equal(log.notice_stored, false);
  });
}

test("an error that is not the host's passes through", async () => {
  const { run } = make("other");
  await assert.rejects(run(CTX, { page: "settings" }), (error: unknown) => !(error instanceof RuntimeRefusal) && error instanceof Error && error.message === "boom");
});

test("a failed copy refuses with the address and stores no notice", async () => {
  const { run, log } = make("host_missing", { write_clipboard: async () => Promise.reject(new Error("denied")) });
  await assert.rejects(run(CTX, { page: "addons" }), (error: unknown) => error instanceof RuntimeRefusal && /about:addons/.test(error.message));
  assert.equal(log.notice_stored, false);
  assert.deepEqual(log.toasts, []);
});
