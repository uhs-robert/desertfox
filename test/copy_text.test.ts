import assert from "node:assert/strict";
import { test } from "node:test";
import { copy_text, copy_yank, yank_text } from "../src/content/caret/copy_text.ts";

test("copy_text answers true once the clipboard took the text", async () => {
  const written: string[] = [];
  assert.equal(await copy_text({ writeText: async (text) => void written.push(text) }, "abc"), true);
  assert.deepEqual(written, ["abc"]);
});

test("copy_text answers false when the write is refused or there is no clipboard", async () => {
  assert.equal(await copy_text({ writeText: () => Promise.reject(new Error("denied")) }, "abc"), false);
  assert.equal(await copy_text(undefined, "abc"), false);
});

function with_background(answer: unknown) {
  const sent: unknown[] = [];
  Object.defineProperty(globalThis, "browser", { value: { runtime: { sendMessage: async (message: unknown) => (sent.push(message), answer) } }, configurable: true });
  return sent;
}

test("copy_yank copies to the clipboard, then asks the background to fill the registers", async () => {
  const written: string[] = [];
  const sent = with_background({ ok: true });
  const clipboard = { writeText: async (text: string) => void written.push(text) };
  assert.deepEqual(await copy_yank(clipboard, "abc", "a"), { ok: true });
  assert.deepEqual(await copy_yank(clipboard, "def", undefined), { ok: true });
  assert.deepEqual(written, ["abc", "def"]);
  assert.deepEqual(sent, [
    { type: "register_yank", name: "a", text: "abc" },
    { type: "register_yank", name: "", text: "def" },
  ]);
});

test("copy_yank to the black hole copies and stores nothing", async () => {
  const written: string[] = [];
  const sent = with_background({ ok: true });
  assert.deepEqual(await copy_yank({ writeText: async (text) => void written.push(text) }, "abc", "_"), { ok: true });
  assert.deepEqual([written, sent], [[], []]);
});

test("copy_yank answers a refused register write, or no answer, as failed", async () => {
  const clipboard = { writeText: async () => {} };
  with_background({ ok: false, message: "Register a holds a macro, so text cannot join it" });
  assert.deepEqual(await copy_yank(clipboard, "abc", "A"), { ok: false, message: "Register a holds a macro, so text cannot join it" });
  with_background(undefined);
  assert.deepEqual(await copy_yank(clipboard, "abc", "a"), { ok: false, message: "DesertFox background did not answer" });
  assert.deepEqual(await copy_yank(undefined, "abc", "a"), { ok: false, message: "Could not copy to the clipboard" });
});

test("yank_text leaves visual mode only while the session that started the copy is current", async () => {
  with_background({ ok: true });
  const clipboard = { writeText: async () => {} };
  for (const same of [true, false]) {
    const done: string[] = [];
    await yank_text(clipboard, "abc", undefined, { is_same_session_: () => same, toast: (message) => done.push(message), leave_visual_: () => done.push("leave") });
    assert.deepEqual(done, same ? ["Copied abc", "leave"] : ["Copied abc"]);
  }
});

test("yank_text keeps visual mode and answers failed, without a toast, when the copy fails", async () => {
  const done: string[] = [];
  const outcome = await yank_text(undefined, "abc", undefined, { is_same_session_: () => true, toast: (message) => done.push(message), leave_visual_: () => done.push("leave") });
  assert.deepEqual(outcome, { ok: false, message: "Could not copy to the clipboard" });
  assert.deepEqual(done, []);
});
