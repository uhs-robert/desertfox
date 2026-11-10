// `"ap` and `"aP`: open.clipboard reads the register the prefix names, and the clipboard when none is named.

import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { REGISTER_PRIVATE_STORAGE_PREFIX, REGISTER_STORAGE_PREFIX } from "../../src/background/storage_keys.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const CTX: CommandContext = { tab_id: 7, window_id: 3, frame_id: 0, mode: "normal" };
const globals = globalThis as Record<string, unknown>;

// A browser whose calls answer from `answers`, by path. The config start-up makes many calls the test does not care about, and those answer undefined.
const browser_with = (answers: Record<string, (...args: never[]) => unknown>): unknown => {
  const namespace = (path: string): unknown =>
    new Proxy(function () {}, {
      get: (_target, key) => (typeof key === "symbol" || key === "then" ? undefined : namespace(`${path}${path === "" ? "" : "."}${key}`)),
      apply: (_target, _this, args) => Promise.resolve(answers[path]?.(...(args as never[]))),
    });
  return namespace("");
};

function stub(values: Record<string, unknown>, incognito = false) {
  const opened: { call: string; options: unknown }[] = [];
  globals.browser = browser_with({
    "storage.local.get": (key: string | string[]) => Object.fromEntries([key].flat().filter((name) => name in values).map((name) => [name, values[name]])),
    "storage.session.get": (key: string | string[]) => Object.fromEntries([key].flat().filter((name) => name in values).map((name) => [name, values[name]])),
    "windows.get": () => ({ incognito }),
    "contextualIdentities.query": () => [],
    "tabs.query": () => [],
    "tabs.update": (id: number, options: unknown) => void opened.push({ call: `update ${id}`, options }),
    "tabs.create": (options: unknown) => (opened.push({ call: "create", options }), { id: 1 }),
  });
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { readText: async () => "https://clip.example/" } }, configurable: true });
  return opened;
}

async function open_with(args: Record<string, unknown>) {
  const command = registry.get("open.clipboard")!;
  const checked = check_args(command, args);
  assert.equal(checked.ok, true);
  await command.run!(CTX, (checked as { args: Record<string, unknown> }).args);
}

test("with no register the clipboard is opened, and a register opens its text", async () => {
  const opened = stub({ [`${REGISTER_STORAGE_PREFIX}a`]: "https://reg.example/a" });
  await open_with({ where: "here" });
  await open_with({ where: "here", register: "a" });
  await open_with({ where: "tab", register: "A" });
  assert.deepEqual(opened.map((entry) => [entry.call, (entry.options as { url: string }).url]), [
    ["update 7", "https://clip.example/"],
    ["update 7", "https://reg.example/a"],
    ["create", "https://reg.example/a"],
  ]);
});

test("a register that is empty, or holds a macro, refuses", async () => {
  stub({ [`${REGISTER_STORAGE_PREFIX}m`]: [{ id: "page.reload" }] });
  await assert.rejects(open_with({ where: "here", register: "b" }), /Register b is empty/);
  await assert.rejects(open_with({ where: "here", register: "m" }), /holds a macro/);
});

test("`\"+p` reads the clipboard and a private window reads its own register", async () => {
  const opened = stub({ [`${REGISTER_STORAGE_PREFIX}a`]: "https://normal.example/", [`${REGISTER_PRIVATE_STORAGE_PREFIX}a`]: "https://private.example/" }, true);
  await open_with({ where: "here", register: "+" });
  await open_with({ where: "here", register: "a" });
  assert.deepEqual(opened.map((entry) => (entry.options as { url: string }).url), ["https://clip.example/", "https://private.example/"]);
});
