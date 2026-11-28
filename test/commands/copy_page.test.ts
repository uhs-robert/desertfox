import assert from "node:assert/strict";
import { test } from "node:test";
import { make_copy_page_handler } from "../../src/commands/copy.ts";
import type { CopyPageDeps } from "../../src/commands/copy.ts";
import type { CommandContext } from "../../src/shared/command.ts";

const CTX: CommandContext = { tab_id: 1, window_id: 1, frame_id: 0, mode: "normal" };

function make(over: Partial<CopyPageDeps> = {}) {
  const log = { clipboard: [] as string[], yanks: [] as unknown[], toasts: [] as string[] };
  const deps: CopyPageDeps = {
    page: async () => ({ url: "https://a.com/p?utm_source=z&k=1", title: "A [draft] page" }),
    is_private: async () => false,
    strip_patterns: async () => () => ["utm_*"],
    write_clipboard: async (text) => void log.clipboard.push(text),
    store: { yank: async (...call: unknown[]) => void log.yanks.push(call) } as never,
    toast: async (_ctx, message) => void log.toasts.push(message),
    ...over,
  };
  return { run: make_copy_page_handler(deps), log };
}

test("each format copies the tab's stripped address or title, fills the register and toasts", async () => {
  const expected = {
    plain: "https://a.com/p?k=1",
    canonical: "https://a.com/p?k=1",
    short: "https://a.com/p?k=1",
    title: "A [draft] page",
    markdown: "[A (draft) page](https://a.com/p?k=1)",
    org: "[[https://a.com/p?k=1][A (draft) page]]",
  } as const;
  for (const [format, text] of Object.entries(expected)) {
    const { run, log } = make();
    await run(CTX, { format: format as keyof typeof expected });
    assert.deepEqual(log.clipboard, [text], format);
    assert.deepEqual(log.yanks, [["", text, false]], format);
    assert.deepEqual(log.toasts, [`Copied ${text}`], format);
  }
});

test("a named register gets the text, the black hole copies nothing, and a private tab keeps its registers apart", async () => {
  const named = make({ is_private: async () => true });
  await named.run(CTX, { format: "plain", register: "a" });
  assert.deepEqual(named.log.yanks, [["a", "https://a.com/p?k=1", true]]);
  const dropped = make();
  await dropped.run(CTX, { format: "plain", register: "_" });
  assert.deepEqual([dropped.log.clipboard, dropped.log.yanks, dropped.log.toasts], [[], [], []]);
});

test("a refused clipboard still fills the register, then refuses with no toast", async () => {
  const { run, log } = make({ write_clipboard: () => Promise.reject(new Error("denied")) });
  await assert.rejects(run(CTX, { format: "plain" }), /Could not copy to the clipboard/);
  assert.equal(log.yanks.length, 1);
  assert.deepEqual(log.toasts, []);
});

test("a tab with no address refuses", async () => {
  await assert.rejects(make({ page: async () => undefined }).run(CTX, { format: "plain" }), /No page to copy/);
});
