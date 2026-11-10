import assert from "node:assert/strict";
import { test } from "node:test";
import { make_quickmark_handlers } from "../../src/commands/quickmark.ts";
import type { QuickmarkDeps } from "../../src/commands/quickmark.ts";
import type { CommandContext } from "../../src/shared/command.ts";

const ctx: CommandContext = { tab_id: 3, window_id: 1, frame_id: 0, mode: "normal" };

function make(table: Record<string, string> = {}) {
  const calls: string[] = [];
  const deps: QuickmarkDeps = {
    table: async () => table,
    save: async (_ctx, key, url) => void calls.push(`save ${key} ${url}`),
    tab_url: async () => "https://here.test/page",
    open: async (_ctx, url, where) => void calls.push(`open ${where} ${url}`),
    toast: async (_ctx, kind, message) => void calls.push(`toast ${kind} ${message}`),
  };
  return { calls, handlers: make_quickmark_handlers(deps) };
}

test("add saves the address of the current tab and says so", async () => {
  const { calls, handlers } = make();
  await handlers.add(ctx, { key: "h" });
  assert.deepEqual(calls, ["save h https://here.test/page", "toast success Quickmark h set"]);
});

test("open goes to the saved address where the flag says", async () => {
  const { calls, handlers } = make({ g: "https://github.com" });
  await handlers.open(ctx, { key: "g", where: "here" });
  await handlers.open(ctx, { key: "g", where: "tab" });
  assert.deepEqual(calls, ["open here https://github.com", "open tab https://github.com"]);
});

test("open refuses a key with no quickmark and opens nothing", async () => {
  const { calls, handlers } = make({ g: "https://github.com" });
  await assert.rejects(handlers.open(ctx, { key: "x", where: "here" }), /No quickmark x/);
  assert.deepEqual(calls, []);
});
