import assert from "node:assert/strict";
import { test } from "node:test";
import { make_mark_list_handlers } from "../../src/commands/mark_list.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import type { MarkItem } from "../../src/shared/messages.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";

const ctx: CommandContext = { tab_id: 3, window_id: 1, frame_id: 0, mode: "normal" };
const ITEMS: MarkItem[] = [{ key: "a", x: 0, y: 40 }, { key: "'", x: 0, y: 9 }, { key: "G", x: 5, y: 7, url: "https://github.com/x" }];

function make(items: MarkItem[] = ITEMS) {
  const calls: string[] = [];
  const handlers = make_mark_list_handlers({
    items: async () => items,
    jump: async (_ctx, key) => void calls.push(`jump ${key}`),
    remove: async (_ctx, key) => void calls.push(`remove ${key}`),
    toast: async (_ctx, kind, message) => void calls.push(`toast ${kind} ${message}`),
  });
  return { calls, handlers };
}

test("list jumps to the picked mark, and refuses a key with no mark or the previous position", async () => {
  const { calls, handlers } = make();
  await handlers.list(ctx, { mark: "G" });
  assert.deepEqual(calls, ["jump G"]);
  await assert.rejects(handlers.list(ctx, { mark: "b" }), /No mark b/);
  await assert.rejects(handlers.list(ctx, { mark: "'" }), /No mark '/);
});

test("delete removes the key and says so", async () => {
  const { calls, handlers } = make();
  await handlers.delete(ctx, { mark: "a" });
  assert.deepEqual(calls, ["remove a", "toast success Mark a deleted"]);
});

test("the schema takes one mark letter and the delete needs it", () => {
  const list = registry.get("mark.list");
  const remove = registry.get("mark.delete");
  assert.equal(check_args(list!, {}).ok, false);
  assert.equal(check_args(list!, { mark: "A" }).ok, true);
  assert.equal(check_args(list!, { mark: "ab" }).ok, false);
  assert.equal(check_args(remove!, {}).ok, false);
});
