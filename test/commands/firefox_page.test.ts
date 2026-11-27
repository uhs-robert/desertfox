import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { create_module_call, NEEDS_MODULE } from "../../src/background/browser_module_call.ts";
import type { CallResult } from "../../src/background/browser_module_call.ts";
import { NativeHostError } from "../../src/background/native_client.ts";
import type { NativeFailure } from "../../src/background/native_client.ts";
import { HOST_PAGE_NOTICE, make_open_firefox_page_handler } from "../../src/commands/firefox_page.ts";
import type { FirefoxPageArgs, FirefoxPageDeps } from "../../src/commands/firefox_page.ts";
import { FIREFOX_PAGE_ADDRESSES, FIREFOX_PAGES, firefox_page_at, MODULE_FIREFOX_PAGES } from "../../src/shared/firefox_pages.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const CTX: CommandContext = { tab_id: 1, window_id: 1, frame_id: 0, mode: "normal" };

function host_page_table(): Record<string, string> {
  const source = readFileSync(new URL("../../host/desertfox-host", import.meta.url), "utf8");
  const block = /^FIREFOX_PAGES = \{\n([\s\S]*?)\n\}$/m.exec(source);
  assert.ok(block, "FIREFOX_PAGES not found in host/desertfox-host");
  return Object.fromEntries([...block[1]!.matchAll(/^ {4}"([\w-]+)": "([^"]+)",$/gm)].map((match) => [match[1]!, match[2]!]));
}

test("the extension's page table equals the host's, key and address", () => {
  assert.deepEqual(host_page_table(), { ...FIREFOX_PAGE_ADDRESSES });
});

test("the command takes exactly the page keys and refuses anything else", () => {
  const def = registry.get("browser.open_firefox_page");
  assert.ok(def);
  assert.equal(def.bridge, false);
  for (const page of FIREFOX_PAGES) assert.deepEqual(check_args(def, { page }), { ok: true, args: { page, where: "tab" } });
  for (const page of ["about:config", "Settings", "settings --profile", ""]) {
    assert.equal(check_args(def, { page }).ok, false, `accepted ${page}`);
  }
});

test("here takes every page of the module route and refuses the passwords page, which only the host and the clipboard open", () => {
  const def = registry.get("browser.open_firefox_page")!;
  for (const page of MODULE_FIREFOX_PAGES) assert.deepEqual(check_args(def, { page, where: "here" }), { ok: true, args: { page, where: "here" } });
  assert.equal(check_args(def, { page: "logins", where: "here" }).ok, false);
  assert.equal(check_args(def, { page: "settings", where: "window" }).ok, false);
  assert.deepEqual(FIREFOX_PAGES.filter((page) => !MODULE_FIREFOX_PAGES.includes(page)), ["logins"]);
});

test("typed text names a page only when it equals the page's address", () => {
  assert.equal(firefox_page_at("about:addons"), "addons");
  assert.equal(firefox_page_at("  ABOUT:Config "), "config");
  assert.equal(firefox_page_at("about:settings"), "settings");
  assert.equal(firefox_page_at("about:settings#privacy"), "settings-privacy");
  assert.equal(firefox_page_at("about:preferences#sync"), "settings-sync");
  assert.equal(firefox_page_at("about:debugging#/runtime/this-firefox"), "debugging");
  for (const text of ["about:debugging", "about:preferences?x=1", "about:preferences#paneGeneral", "about:settingsx", "about:telemetry", "addons", "about:addons#x"]) assert.equal(firefox_page_at(text), undefined, text);
});

function make(failure?: NativeFailure | "other", over: Partial<FirefoxPageDeps> = {}) {
  const log = { opened: [] as string[], clipboard: [] as string[], toasts: [] as string[], notice_stored: false, module_asks: [] as unknown[] };
  const deps: FirefoxPageDeps = {
    module_opens_pages: async () => false,
    module_open: async (args) => {
      log.module_asks.push(args);
      return { ok: true };
    },
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
  await run(CTX, { page: "config", where: "tab" });
  assert.deepEqual(log.opened, ["config"]);
  assert.deepEqual(log.clipboard, []);
  assert.deepEqual(log.toasts, []);
});

for (const failure of ["host_missing", "no_permission"] as const) {
  test(`without the host (${failure}) the address is copied and the host notice shows once`, async () => {
    const { run, log } = make(failure);
    await run(CTX, { page: "settings", where: "tab" });
    await run(CTX, { page: "memory", where: "tab" });
    assert.deepEqual(log.clipboard, ["about:preferences", "about:memory"]);
    assert.deepEqual(log.toasts, [`Copied about:preferences. Press Ctrl+L, then paste. ${HOST_PAGE_NOTICE}`, "Copied about:memory. Press Ctrl+L, then paste."]);
    assert.equal(log.notice_stored, true);
    assert.match(HOST_PAGE_NOTICE, /:native\.install/);
  });
}

test("a stored notice flag keeps the first no-host message short", async () => {
  const { run, log } = make("host_missing", { notice_shown: async () => true });
  await run(CTX, { page: "debugging", where: "tab" });
  assert.deepEqual(log.clipboard, ["about:debugging#/runtime/this-firefox"]);
  assert.deepEqual(log.toasts, ["Copied about:debugging#/runtime/this-firefox. Press Ctrl+L, then paste."]);
});

for (const failure of ["host_failed", "host_outdated", "bad_reply"] as const) {
  test(`a host that answers (${failure}) refuses with its message and copies nothing`, async () => {
    const { run, log } = make(failure);
    await assert.rejects(run(CTX, { page: "settings", where: "tab" }), (error: unknown) => error instanceof RuntimeRefusal && error.message === `host says ${failure}`);
    assert.deepEqual(log.clipboard, []);
    assert.equal(log.notice_stored, false);
  });
}

test("an error that is not the host's passes through", async () => {
  const { run } = make("other");
  await assert.rejects(run(CTX, { page: "settings", where: "tab" }), (error: unknown) => !(error instanceof RuntimeRefusal) && error instanceof Error && error.message === "boom");
});

test("a failed copy refuses with the address and stores no notice", async () => {
  const { run, log } = make("host_missing", { write_clipboard: async () => Promise.reject(new Error("denied")) });
  await assert.rejects(run(CTX, { page: "addons", where: "tab" }), (error: unknown) => error instanceof RuntimeRefusal && /about:addons/.test(error.message));
  assert.equal(log.notice_stored, false);
  assert.deepEqual(log.toasts, []);
});

// ---- The module route, ahead of the host and the clipboard.

const TAB: FirefoxPageArgs = { page: "settings", where: "tab" };
const HERE: FirefoxPageArgs = { page: "addons", where: "here" };
const with_module = (answer: CallResult | (() => CallResult), failure?: NativeFailure, over: Partial<FirefoxPageDeps> = {}) => {
  const asks: unknown[] = [];
  const made = make(failure, {
    module_opens_pages: async () => true,
    module_open: async (args) => {
      asks.push(args);
      return typeof answer === "function" ? answer() : answer;
    },
    ...over,
  });
  return { ...made, asks };
};

test("a module that says firefox_pages opens the page with the asking tab, and the host is never asked", async () => {
  const { run, log, asks } = with_module({ ok: true });
  await run(CTX, TAB);
  await run(CTX, HERE);
  assert.deepEqual(asks, [{ page: "settings", where: "tab", tab_id: 1 }, { page: "addons", where: "here", tab_id: 1 }]);
  assert.deepEqual(log.opened, []);
  assert.deepEqual(log.clipboard, []);
});

test("a run with no sender tab names no tab, so the module opens in the focused window", async () => {
  const { run, asks } = with_module({ ok: true });
  await run({ ...CTX, tab_id: undefined }, TAB);
  assert.deepEqual(asks, [{ page: "settings", where: "tab" }]);
});

test("an older module, whose hello lacks the flag, never gets the request: the host opens the page at once", async () => {
  const { run, log } = make();
  await run(CTX, TAB);
  assert.deepEqual(log.module_asks, []);
  assert.deepEqual(log.opened, ["settings"]);
});

for (const error of [NEEDS_MODULE, "firefox_page.open page has the wrong shape", "firefox_page.open where has the wrong shape", "firefox_page.open tab_id has the wrong shape"]) {
  test(`the module answering "${error}" falls back to the host, then the clipboard`, async () => {
    const hosted = with_module({ ok: false, error });
    await hosted.run(CTX, TAB);
    assert.deepEqual(hosted.log.opened, ["settings"]);
    const hostless = with_module({ ok: false, error }, "host_missing");
    await hostless.run(CTX, TAB);
    assert.deepEqual(hostless.log.clipboard, ["about:preferences"]);
  });
}

for (const error of ["Too many Firefox pages opened at once", "The tab that asked is no longer selected", "The tab that asked is gone", "The browser module may not act in this window", "the request is too old", "no handler for this kind", "the request failed"]) {
  test(`the module refusing with "${error}" shows that refusal and asks neither the host nor the clipboard`, async () => {
    const { run, log } = with_module({ ok: false, error });
    await assert.rejects(run(CTX, TAB), (thrown: unknown) => thrown instanceof RuntimeRefusal && thrown.message === error);
    assert.deepEqual(log.opened, []);
    assert.deepEqual(log.clipboard, []);
  });
}

test("here with no module that opens pages refuses: the host and the clipboard can only add a tab", async () => {
  for (const made of [make(), with_module({ ok: false, error: NEEDS_MODULE })]) {
    await assert.rejects(made.run(CTX, HERE), (thrown: unknown) => thrown instanceof RuntimeRefusal && thrown.message.startsWith(NEEDS_MODULE));
    assert.deepEqual(made.log.opened, []);
    assert.deepEqual(made.log.clipboard, []);
  }
});

test("a page with no address opens through the module only, and without it refuses with no host call and no copy", async () => {
  const { run, asks } = with_module({ ok: true });
  await run(CTX, { page: "addons-shortcuts", where: "tab" });
  assert.deepEqual(asks, [{ page: "addons-shortcuts", where: "tab", tab_id: 1 }]);
  for (const made of [make(), with_module({ ok: false, error: NEEDS_MODULE })]) {
    await assert.rejects(made.run(CTX, { page: "addons-shortcuts", where: "tab" }), (thrown: unknown) => thrown instanceof RuntimeRefusal && thrown.message.startsWith(NEEDS_MODULE));
    assert.deepEqual(made.log.opened, []);
    assert.deepEqual(made.log.clipboard, []);
  }
});

test("the passwords page skips the module even when it opens pages", async () => {
  const { run, log, asks } = with_module({ ok: true });
  await run(CTX, { page: "logins", where: "tab" });
  assert.deepEqual(asks, []);
  assert.deepEqual(log.opened, ["logins"]);
});

// The real call machinery: the request is written, then the module goes away before it answers, or never answers.
function call_world() {
  const written: string[] = [];
  const withdrawn: string[] = [];
  const timers: (() => void)[] = [];
  const calls = create_module_call({
    send: async (_kind, _args, on_id) => {
      const id = `r${written.length}`;
      written.push(id);
      on_id?.(id);
      return { ok: true, id };
    },
    withdraw: async (id) => void withdrawn.push(id),
    read_status: async () => ({ result: "matched", module_version: "1", module_v: 1 }),
    later: (run) => {
      timers.push(run);
      return () => undefined;
    },
  });
  const made = make(undefined, { module_opens_pages: async () => true, module_open: (args) => calls.call("firefox_page.open", args) });
  return { ...made, calls, written, withdrawn, timers };
}
const until_written = async (written: string[]) => {
  while (written.length === 0) await new Promise((resolve) => setImmediate(resolve));
};

test("a module that turns off mid-request ends the call with NEEDS_MODULE, takes the request back, and the host opens the page once", async () => {
  const { run, log, calls, written, withdrawn } = call_world();
  const done = run(CTX, TAB);
  await until_written(written);
  calls.status_changed({ result: "waiting" });
  await done;
  assert.deepEqual(withdrawn, written);
  assert.deepEqual(log.opened, ["settings"]);
  // A reply that comes after the fallback finds no call and opens nothing more.
  calls.hear({ v: 1, reply_to: written[0]!, ok: true });
  assert.deepEqual(log.opened, ["settings"]);
});

test("a module that never answers times out to the host, and the request is taken back so it never runs late", async () => {
  const { run, log, written, withdrawn, timers } = call_world();
  const done = run(CTX, TAB);
  await until_written(written);
  timers.forEach((fire) => fire());
  await done;
  assert.deepEqual(withdrawn, written);
  assert.deepEqual(log.opened, ["settings"]);
});

test("the settings panes reach the host and the clipboard as their own addresses", async () => {
  const { run, log } = make("host_missing");
  await run(CTX, { page: "settings-privacy", where: "tab" });
  assert.deepEqual(log.clipboard, ["about:preferences#privacy"]);
  assert.equal(FIREFOX_PAGE_ADDRESSES["settings-privacy"], "about:preferences#privacy");
});
