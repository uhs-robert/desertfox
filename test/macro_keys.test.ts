// The keys of recording: the q binding, the stop swap in the page's tree, the badge text and the which-key rows.

import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { list_keys } from "../src/background/list_keys.ts";
import { page_keymap_for } from "../src/background/page_keymap.ts";
import { mode_label } from "../src/content/mode_label.ts";
import { create_matcher } from "../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import type { CompiledKeymap } from "../src/shared/prefix_tree.ts";
import { registry } from "../src/shared/registry/builtin.ts";

const compiled = (user_keymap: Record<string, unknown> = {}): CompiledKeymap =>
  compile_config({ config: { ...empty_config(), keymap: user_keymap as never }, default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: {} }).compiled;
const storage_of = (keymap: CompiledKeymap) => ({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) }) as never;
const first_step = (result: ReturnType<ReturnType<typeof create_matcher>["feed"]>) => (result.kind === "match" ? result.leaf.steps[0]!.invocation : undefined);

test("q then a register key is macro.record with that register", () => {
  const matcher = create_matcher(compiled());
  assert.equal(matcher.feed("normal", "q").kind, "pending");
  assert.deepEqual(first_step(matcher.feed("normal", "a")), { id: "macro.record", args: { reg: "a" } });
});

test("while recording, q alone stops, and the reply names the register", async () => {
  const reply = (await page_keymap_for(storage_of(compiled()), ["https://a.test/"], "a"))!;
  assert.equal(reply.recording, "a");
  const matcher = create_matcher(reply.keymap);
  assert.equal(first_step(matcher.feed("normal", "q"))?.id, "macro.stop");
  assert.equal(first_step(matcher.feed("normal", "j"))?.id, "scroll.lines");
});

test("a page that is not recording keeps the record key and sends no register", async () => {
  const reply = (await page_keymap_for(storage_of(compiled()), ["https://a.test/"]))!;
  assert.equal(reply.recording, undefined);
  assert.equal(create_matcher(reply.keymap).feed("normal", "q").kind, "pending");
});

test("the stop key follows a user binding of macro.record", async () => {
  const reply = (await page_keymap_for(storage_of(compiled({ normal: { ",q": { id: "macro.record" } } })), ["https://a.test/"], "b"))!;
  const matcher = create_matcher(reply.keymap);
  matcher.feed("normal", ",");
  assert.equal(first_step(matcher.feed("normal", "q"))?.id, "macro.stop");
});

test("a site rule that passes q leaves the page to the key, and the badge still shows", async () => {
  const keymap = { ...compiled(), site_rules: [{ regex: "^https://a\\.test/", pass: [["q"]] }] } as CompiledKeymap;
  const reply = (await page_keymap_for(storage_of(keymap), ["https://a.test/"], "a"))!;
  assert.equal(reply.keymap.modes.normal?.children["q"], undefined);
  assert.equal(reply.recording, "a");
});

test("the badge adds the register to the mode, even where the setting hides the mode", () => {
  assert.equal(mode_label("normal", false, "always", "a"), "NORMAL recording @a");
  assert.equal(mode_label("normal", false, "not_normal", "a"), "recording @a");
  assert.equal(mode_label("normal", false, "off", "a"), "recording @a");
  assert.equal(mode_label("normal", false, "always"), "NORMAL");
  assert.equal(mode_label("insert", false, "off"), undefined);
});

test("which-key under q lists the stored macros, and the tree when there are none", async () => {
  const storage = storage_of(compiled());
  const ask = (macros?: () => Promise<{ name: string; description: string }[]>) => list_keys(storage, (id) => registry.get(id), { mode: "normal", prefix: ["q"] }, { macros });
  const rows = (await ask(async () => [{ name: "a", description: "3 steps" }, { name: "c", description: "1 step" }])).rows;
  assert.deepEqual(rows.map((row) => [row.keys, row.command]), [["a", "3 steps"], ["c", "1 step"]]);
  const bare = (await ask(async () => [])).rows;
  assert.equal(bare.length, 1);
  assert.equal(bare[0]!.keys, "<key>");
});
