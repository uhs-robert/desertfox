import assert from "node:assert/strict";
import { test } from "node:test";
import { content_handlers } from "../../src/background/content_messages.ts";
import type { ContentDeps } from "../../src/background/content_messages.ts";
import { browser_macro_recorder } from "../../src/background/macro_recorder.ts";

type Sender = browser.runtime.MessageSender;
const session = new Map<string, unknown>();
Object.assign(globalThis, {
  browser: {
    storage: {
      session: {
        get: async (key: string) => (session.has(key) ? { [key]: session.get(key) } : {}),
        set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => session.set(key, value)),
        remove: async (key: string) => void session.delete(key),
      },
    },
    tabs: { query: async () => [] },
  },
});

const PDF = "https://example.org/paper.pdf";
const sender_of = (tab: Partial<browser.tabs.Tab> | undefined, extra: Partial<Sender> = {}): Sender => ({ id: "x", frameId: 0, url: "https://page.says/", ...(tab && { tab: tab as browser.tabs.Tab }), ...extra });

function handler(options: { locked?: boolean; bar?: boolean; insert_held?: boolean } = {}) {
  const asked: unknown[][] = [];
  const deps = {
    is_locked_tab: async (tab_id: number) => (asked.push(["is_locked_tab", tab_id]), options.locked ?? true),
    browser_module: { bar_active: async () => options.bar ?? false },
    tab_insert: { join: async (tab_id: number, frame_id: number) => (asked.push(["insert", tab_id, frame_id]), options.insert_held ?? false) },
    tab_media: { join: async () => (asked.push(["media"]), true) },
    tab_item: { join: async () => (asked.push(["item"]), true) },
  } as unknown as ContentDeps;
  return { asked, run: (request: { join: boolean }, sender: Sender) => content_handlers(deps).read_keymap_state.run({ type: "read_keymap_state", ...request }, sender as never) };
}

test("the state holds the tab's own address, never one the message or the sender's url names", async () => {
  const { run } = handler();
  const state = (await run({ join: false, url: "https://evil.test/" } as never, sender_of({ id: 7, url: PDF })))!;
  assert.deepEqual(state, { address: PDF });
});

test("a tab that is not locked, or has no address, gets nothing", async () => {
  assert.equal(await handler({ locked: false }).run({ join: true }, sender_of({ id: 7, url: PDF })), undefined);
  assert.equal(await handler().run({ join: true }, sender_of({ id: 7 })), undefined);
  assert.equal(await handler().run({ join: true }, sender_of(undefined)), undefined);
});

test("only the insert join is asked, with the top frame, and only on a first ask", async () => {
  const held = handler({ insert_held: true });
  assert.deepEqual(await held.run({ join: true }, sender_of({ id: 7, url: PDF })), { address: PDF, join: "insert" });
  assert.deepEqual(held.asked.filter(([name]) => name === "insert"), [["insert", 7, 0]]);
  const again = handler({ insert_held: true });
  assert.deepEqual(await again.run({ join: false }, sender_of({ id: 7, url: PDF })), { address: PDF });
  assert.deepEqual(again.asked.filter(([name]) => name === "insert"), []);
  // With no insert hold, the media and item holds are never asked: the call has no document id to ask them with.
  const none = handler({ insert_held: false });
  assert.deepEqual(await none.run({ join: true }, sender_of({ id: 7, url: PDF }, { documentId: "doc" } as never)), { address: PDF });
  assert.equal(none.asked.some(([name]) => name === "media" || name === "item"), false);
});

test("the bar flag and the register of the macro being recorded come with the state, the private one for a private tab", async () => {
  const { run } = handler({ bar: true });
  await browser_macro_recorder.start("a", false);
  await browser_macro_recorder.start("p", true);
  assert.deepEqual(await run({ join: false }, sender_of({ id: 7, url: PDF })), { address: PDF, recording: "a", bar: true });
  assert.deepEqual(await run({ join: false }, sender_of({ id: 8, url: PDF, incognito: true })), { address: PDF, recording: "p", bar: true });
  await browser_macro_recorder.stop(false);
  await browser_macro_recorder.stop(true);
  assert.deepEqual(await run({ join: false }, sender_of({ id: 7, url: PDF })), { address: PDF, bar: true });
});
