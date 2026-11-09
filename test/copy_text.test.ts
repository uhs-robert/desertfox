import assert from "node:assert/strict";
import { test } from "node:test";
import { copy_text, yank_text } from "../src/content/caret/copy_text.ts";

test("copy_text answers true once the clipboard took the text", async () => {
  const written: string[] = [];
  assert.equal(await copy_text({ writeText: async (text) => void written.push(text) }, "abc"), true);
  assert.deepEqual(written, ["abc"]);
});

test("copy_text answers false when the write is refused or there is no clipboard", async () => {
  assert.equal(await copy_text({ writeText: () => Promise.reject(new Error("denied")) }, "abc"), false);
  assert.equal(await copy_text(undefined, "abc"), false);
});

test("yank_text leaves visual mode only while the session that started the copy is current", async () => {
  const clipboard = { writeText: async () => {} };
  for (const same of [true, false]) {
    const done: string[] = [];
    await yank_text(clipboard, "abc", { is_same_session_: () => same, toast: (message) => done.push(message), leave_visual_: () => done.push("leave") });
    assert.deepEqual(done, same ? ["Copied abc", "leave"] : ["Copied abc"]);
  }
});

test("yank_text keeps visual mode and answers failed, without a toast, when the copy fails", async () => {
  const done: string[] = [];
  const outcome = await yank_text(undefined, "abc", { is_same_session_: () => true, toast: (message) => done.push(message), leave_visual_: () => done.push("leave") });
  assert.deepEqual(outcome, { ok: false, message: "Could not copy to the clipboard" });
  assert.deepEqual(done, []);
});
