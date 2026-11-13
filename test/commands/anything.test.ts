import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { make_anything_handlers } from "../../src/commands/open.ts";
import type { AnythingDeps } from "../../src/commands/open.ts";
import { encode_ref } from "../../src/shared/anything_ref.ts";

const CTX: CommandContext = { tab_id: 1, window_id: 10 } as CommandContext;

function make(private_line = false, tabs: Record<number, { window_id: number; incognito: boolean }> = { 5: { window_id: 10, incognito: false }, 6: { window_id: 11, incognito: false }, 7: { window_id: 12, incognito: true } }) {
  const calls: string[] = [];
  const deps: AnythingDeps = {
    is_private: async () => private_line,
    read_tab: async (id) => tabs[id],
    activate: async (id) => void calls.push(`activate ${id}`),
    focus_window: async (id) => void calls.push(`focus ${id}`),
    restore_closed: async (id) => void calls.push(`restore ${id}`),
    target: async (_ctx, text) => `target:${text}`,
    search: async (_ctx, engine, query) => `search:${engine ?? "default"}:${query}`,
    open: async (_ctx, url, where) => void calls.push(`open ${url} ${where}`),
  };
  return { run: (query: string, where = "here") => make_anything_handlers(deps).run(CTX, { query, where: where as "here" }), calls };
}

test("a tab row switches to the tab, and focuses its window when it is another one, whatever where says", async () => {
  const { run, calls } = make();
  await run(encode_ref({ kind: "tab", id: 5 }), "tab");
  await run(encode_ref({ kind: "tab", id: 6 }), "tab");
  assert.deepEqual(calls, ["activate 5", "activate 6", "focus 11"]);
});

test("a tab of the other privacy or a gone tab is refused", async () => {
  const { run } = make();
  await assert.rejects(run(encode_ref({ kind: "tab", id: 7 })), RuntimeRefusal);
  await assert.rejects(run(encode_ref({ kind: "tab", id: 99 })), RuntimeRefusal);
});

test("a closed-tab row restores it, and a private line refuses", async () => {
  const { run, calls } = make();
  await run(encode_ref({ kind: "closed", session_id: "s1" }), "tab");
  assert.deepEqual(calls, ["restore s1"]);
  await assert.rejects(make(true).run(encode_ref({ kind: "closed", session_id: "s1" })), RuntimeRefusal);
});

test("page, engine and web rows open where asked", async () => {
  const { run, calls } = make();
  await run(encode_ref({ kind: "page", url: "https://a.test/" }));
  await run(encode_ref({ kind: "engine", engine: "github", query: "q" }), "tab");
  await run(encode_ref({ kind: "web", query: "w" }), "window");
  assert.deepEqual(calls, ["open target:https://a.test/ here", "open search:github:q tab", "open target:w window"]);
});

test("text with no reference opens like the last row", async () => {
  const { run, calls } = make();
  await run("some words", "tab");
  assert.deepEqual(calls, ["open target:some words tab"]);
});
