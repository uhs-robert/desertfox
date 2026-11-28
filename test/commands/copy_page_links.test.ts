import assert from "node:assert/strict";
import { test } from "node:test";
import { make_copy_page_links_handler } from "../../src/commands/copy.ts";
import type { CopyPageLinksDeps } from "../../src/commands/copy.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { MAX_YANKED_LINKS } from "../../src/shared/copy/link_list.ts";

const CTX: CommandContext = { tab_id: 1, window_id: 1, frame_id: 0, mode: "normal" };
const PAIRS = [["https://a.com/p?utm_source=z&k=1", "A [draft]"], ["https://b.com/", ""], ["https://a.com/p?k=1&utm_medium=m", "Again"]];

function make(value: string | null = JSON.stringify(PAIRS), over: Partial<CopyPageLinksDeps> = {}) {
  const log = { clipboard: [] as string[], yanks: [] as unknown[], toasts: [] as string[], asked: [] as unknown[] };
  const deps: CopyPageLinksDeps = {
    page: async () => ({ url: "https://page.com/" }),
    ask_links: async (_ctx, scope) => (log.asked.push(scope), { ok: true, ...(value !== null && { value }) }),
    is_private: async () => false,
    strip_patterns: async () => () => ["utm_*"],
    write_clipboard: async (text) => void log.clipboard.push(text),
    store: { yank: async (...call: unknown[]) => void log.yanks.push(call) } as never,
    toast: async (_ctx, message) => void log.toasts.push(message),
    ...over,
  };
  return { run: make_copy_page_links_handler(deps), log };
}

test("each format strips tracking, keeps the first of duplicates, labels a bare link with its address, and toasts the count", async () => {
  const expected = {
    markdown: "- [A (draft)](https://a.com/p?k=1)\n- [https://b.com/](https://b.com/)",
    plain: "https://a.com/p?k=1\nhttps://b.com/",
    org: "- [[https://a.com/p?k=1][A (draft)]]\n- [[https://b.com/][https://b.com/]]",
  } as const;
  for (const [format, text] of Object.entries(expected)) {
    const { run, log } = make();
    await run(CTX, { scope: "page", format: format as keyof typeof expected });
    assert.deepEqual(log.clipboard, [text], format);
    assert.deepEqual(log.yanks, [["", text, false]], format);
    assert.deepEqual(log.toasts, ["Copied 2 links"], format);
  }
});

test("the scope goes to the module as typed", async () => {
  const { run, log } = make();
  await run(CTX, { scope: "viewport", format: "plain" });
  assert.deepEqual(log.asked, ["viewport"]);
});

test("one link toasts in the singular, and a page of 600 distinct links copies 500", async () => {
  const one = make(JSON.stringify([["https://a.com/", "A"]]));
  await one.run(CTX, { scope: "page", format: "plain" });
  assert.deepEqual(one.log.toasts, ["Copied 1 link"]);
  const many = make(JSON.stringify(Array.from({ length: 600 }, (_, index) => [`https://a.com/${index}`, "t"])));
  await many.run(CTX, { scope: "page", format: "plain" });
  assert.equal(many.log.clipboard[0]!.split("\n").length, MAX_YANKED_LINKS);
});

test("a reply of bad links is cleaned before it is copied", async () => {
  const { run, log } = make(JSON.stringify([["javascript:alert(1)", "x"], ["https://a.com/", "ok"], ["data:text/html,x", "y"]]));
  await run(CTX, { scope: "page", format: "plain" });
  assert.deepEqual(log.clipboard, ["https://a.com/"]);
});

test("a reply that cannot be read refuses and copies nothing", async () => {
  for (const value of [null, "not json", "{}"]) {
    const { run, log } = make(value);
    await assert.rejects(run(CTX, { scope: "page", format: "plain" }), /could not be read/, String(value));
    assert.deepEqual([log.clipboard, log.yanks, log.toasts], [[], [], []]);
  }
});

test("a page with no links gives the notice", async () => {
  for (const value of ["[]", JSON.stringify([["mailto:a@b.c", "t"]])]) {
    await assert.rejects(make(value).run(CTX, { scope: "page", format: "plain" }), /No links on this page/);
  }
});

test("the module's own refusal text passes through, and an older module gives the newer-module notice", async () => {
  const refused = make("[]", { ask_links: async () => ({ ok: false, error: "Links cannot be read on this page" }) });
  await assert.rejects(refused.run(CTX, { scope: "page", format: "plain" }), /Links cannot be read on this page/);
  const older = make("[]", { ask_links: async () => ({ ok: false, error: "no handler for this kind" }) });
  await assert.rejects(older.run(CTX, { scope: "page", format: "plain" }), /Needs a newer browser module/);
});

test("a named register gets the text, a private tab keeps its registers apart, and the black hole copies nothing and asks nothing", async () => {
  const named = make(JSON.stringify(PAIRS), { is_private: async () => true });
  await named.run(CTX, { scope: "page", format: "plain", register: "a" });
  assert.deepEqual(named.log.yanks, [["a", "https://a.com/p?k=1\nhttps://b.com/", true]]);
  const dropped = make();
  await dropped.run(CTX, { scope: "page", format: "plain", register: "_" });
  assert.deepEqual([dropped.log.clipboard, dropped.log.yanks, dropped.log.toasts, dropped.log.asked], [[], [], [], []]);
});

test("a refused clipboard still fills the register, then refuses with no toast", async () => {
  const { run, log } = make(JSON.stringify(PAIRS), { write_clipboard: () => Promise.reject(new Error("denied")) });
  await assert.rejects(run(CTX, { scope: "page", format: "plain" }), /Could not copy to the clipboard/);
  assert.equal(log.yanks.length, 1);
  assert.deepEqual(log.toasts, []);
});

test("a tab with no address refuses", async () => {
  await assert.rejects(make(JSON.stringify(PAIRS), { page: async () => undefined }).run(CTX, { scope: "page", format: "plain" }), /No page to copy/);
});
