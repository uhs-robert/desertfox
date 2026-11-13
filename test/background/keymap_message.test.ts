import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import type { CompileInput } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import type { EditLayers, KeymapEdits } from "../../src/background/edit_layers.ts";
import { binding_rows, create_keymap_messages, exportable_key_edits } from "../../src/background/keymap_message.ts";
import type { KeymapState } from "../../src/background/keymap_message.ts";
import type { MergedConfig } from "../../src/shared/config.ts";
import type { KeymapConfig } from "../../src/shared/keymap.ts";
import type { CompiledKeymap, TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const config_with = (keymap: KeymapConfig, extra: Partial<MergedConfig> = {}): MergedConfig => ({ ...empty_config(), keymap, ...extra });

const input_of = (config: MergedConfig, keymap_edits: KeymapEdits, default_keymap: KeymapConfig = DEFAULT_KEYMAP): CompileInput => ({
  config,
  default_keymap,
  get_command: (id) => registry.get(id),
  registry,
  enum_sources: { search_engines: Object.keys(config.search_engines), containers: [] },
  keymap_edits,
});

const leaf_id = (compiled: CompiledKeymap, keys: string) => ((compiled.modes.normal?.children[keys] as TreeLeaf | undefined)?.steps[0]?.invocation.id);

test("a key edit resolves with the config's aliases and engine names, and wins over the file and the default", () => {
  const config = config_with({ normal: { J: { id: "tab.prev" } } }, { command_aliases: { nt: "tab.next" }, search_engines: { ...empty_config().search_engines, wiki: { label: "Wiki", url: "https://w.test/?q=%s" } } });
  const { compiled, warnings } = compile_config(input_of(config, { normal: { J: "nt", K: "", gw: "search wiki" } }));
  assert.equal(leaf_id(compiled, "J"), "tab.next");
  assert.equal(leaf_id(compiled, "K"), undefined);
  const gw = (compiled.modes.normal!.children.g as { children: Record<string, TreeLeaf> }).children.w!;
  assert.deepEqual([gw.steps[0]!.invocation.id, gw.steps[0]!.invocation.args?.engine], ["open.search", "wiki"]);
  assert.deepEqual(warnings, []);
});

test("an edit that does not read warns and drops, so the binding under it stays", () => {
  const { compiled, warnings } = compile_config(input_of(config_with({}), { normal: { J: "no.such.command" } }));
  assert.equal(leaf_id(compiled, "J"), "tab.next");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /^keymap edits: normal skipped "J": /);
});

test("a __proto__ edit compiles as a key", () => {
  const { compiled, warnings } = compile_config(input_of(config_with({}), JSON.parse('{"normal":{"__proto__":"tab.close"}}')));
  let node: { children?: Record<string, unknown> } | undefined = compiled.modes.normal;
  for (const key of "__proto__") node = node?.children?.[key] as typeof node;
  assert.equal((node as unknown as TreeLeaf).steps[0]!.invocation.id, "tab.close");
  assert.equal(warnings.some((warning) => warning.includes("__proto__")), false);
});

test("without a command list the key edits are left out with one warning", () => {
  const { registry: _left_out, ...input } = input_of(config_with({}), { normal: { J: "tab.close" } });
  const { compiled, warnings } = compile_config(input);
  assert.equal(leaf_id(compiled, "J"), "tab.next");
  assert.deepEqual(warnings, ["keymap edits: skipped, no command list to read them with"]);
});

test("an edit that extends a default key drops that default, as a file binding does", () => {
  const { compiled, warnings } = compile_config(input_of(config_with({}), { normal: { Jx: "tab.close" } }));
  assert.equal(((compiled.modes.normal!.children.J as { children: Record<string, TreeLeaf> }).children.x!).steps[0]!.invocation.id, "tab.close");
  assert.deepEqual(warnings, ['normal: dropped default keys that your keys extend: "J" by Jx']);
});

test("the binding list tags each row with the layer that decides it", () => {
  const defaults: KeymapConfig = { normal: { J: { id: "tab.next" }, K: { id: "tab.prev" }, x: { id: "tab.close" }, T: { id: "tab.switch", prompt: { param: "tab" } } } };
  const files: KeymapConfig = { normal: { K: { id: "tab.goto" }, x: null, z: { id: "tab.next" } } };
  const edits: KeymapEdits = { normal: { J: "tab.close", z: "", q: "tab.prev" } };
  const rows = binding_rows(defaults, files, edits, registry, {});
  const row = (keys: string) => rows.find((candidate) => candidate.keys === keys);
  assert.deepEqual(row("J"), { mode: "normal", keys: "J", text: "tab.close", origin: "edit", default_text: "tab.next" });
  assert.deepEqual(row("K"), { mode: "normal", keys: "K", text: "tab.goto", origin: "file", default_text: "tab.prev" });
  assert.deepEqual(row("x"), { mode: "normal", keys: "x", text: "", origin: "removed", default_text: "tab.close" });
  assert.deepEqual(row("z"), { mode: "normal", keys: "z", text: "", origin: "removed" });
  assert.deepEqual(row("q"), { mode: "normal", keys: "q", text: "tab.prev", origin: "edit" });
  assert.equal(row("T")!.origin, "default");
  assert.match(row("T")!.text, /^:/);
});

// The background's messages over storage in memory: `change_layers` runs `decide` on the stored edits.
function messages_over(config: MergedConfig, stored: { edits: KeymapEdits }) {
  const read_keymap_state = async (): Promise<KeymapState> => ({ config, layers: { keymap: stored.edits }, compile: (layers: EditLayers) => compile_config(input_of(config, layers.keymap)) });
  const change_layers = async (_kind: "keymap", decide: (current: KeymapEdits, config: MergedConfig) => KeymapEdits | undefined) => {
    const next = decide(stored.edits, config);
    if (next !== undefined) stored.edits = next;
  };
  return create_keymap_messages({ default_keymap: DEFAULT_KEYMAP, registry, read_keymap_state, change_layers });
}

test("the check reports only what the binding adds, and the bindings it replaces or drops", async () => {
  const messages = messages_over(config_with({ normal: { zq: { id: "tab.close" } } }), { edits: {} });
  const replaces = await messages.check({ type: "check_binding", mode: "normal", keys: "J", text: "tab.close" });
  assert.deepEqual(replaces, { ok: true, saves: true, problems: [], warnings: [], shadows: [{ keys: "J", text: "tab.next" }], keys: "J" });

  // The drop of a default it extends is news, not a refusal.
  const extends_default = await messages.check({ type: "check_binding", mode: "normal", keys: "Jx", text: "tab.close" });
  assert.equal(extends_default.ok && extends_default.saves && extends_default.warnings.length === 1, true, JSON.stringify(extends_default));
  assert.deepEqual(extends_default.ok && extends_default.shadows, [{ keys: "J", text: "tab.next" }]);

  const prefix = await messages.check({ type: "check_binding", mode: "normal", keys: "z", text: "tab.next" });
  assert.equal(prefix.ok && prefix.shadows.some((shadow) => shadow.keys === "zq"), true, JSON.stringify(prefix));

  const wrong_mode = await messages.check({ type: "check_binding", mode: "normal", keys: "J", text: "caret.move" });
  assert.equal(wrong_mode.ok && !wrong_mode.saves && wrong_mode.warnings.length === 1 && /normal: skipped "J": caret.move runs in/.test(wrong_mode.warnings[0]!), true, JSON.stringify(wrong_mode));

  const unread = await messages.check({ type: "check_binding", mode: "normal", keys: "J", text: "no.such" });
  assert.equal(unread.ok && !unread.saves && unread.problems.length === 1 && unread.warnings.length === 0, true);
  const bad_keys = await messages.check({ type: "check_binding", mode: "browser", keys: "J", text: "tab.next" });
  assert.equal(bad_keys.ok && /needs Ctrl or Alt/.test(bad_keys.problems[0]!), true, JSON.stringify(bad_keys));
});

test("set, remove and reset change the layer, and a set the check refuses changes nothing", async () => {
  const stored: { edits: KeymapEdits } = { edits: {} };
  const messages = messages_over(config_with({ normal: { zq: { id: "tab.close" } } }), stored);

  const set = await messages.change({ type: "change_keymap", mode: "normal", keys: "<A-J>", action: "set", text: "tab.close" });
  assert.deepEqual(set, { ok: true, row: { mode: "normal", keys: "<A-j>", text: "tab.close", origin: "edit" }, message: "Bound <A-j> in normal mode" });

  const refused = await messages.change({ type: "change_keymap", mode: "normal", keys: "J", action: "set", text: "caret.move" });
  assert.equal(refused.ok, false);
  assert.deepEqual(stored.edits, { normal: { "<A-j>": "tab.close" } });

  // An edit-only key is dropped, a default and a file binding take "".
  await messages.change({ type: "change_keymap", mode: "normal", keys: "<A-j>", action: "remove" });
  const removed = await messages.change({ type: "change_keymap", mode: "normal", keys: "J", action: "remove" });
  await messages.change({ type: "change_keymap", mode: "normal", keys: "zq", action: "remove" });
  assert.deepEqual(stored.edits, { normal: { J: "", zq: "" } });
  assert.deepEqual(removed.ok && removed.row, { mode: "normal", keys: "J", text: "", origin: "removed", default_text: "tab.next" });

  const reset = await messages.change({ type: "change_keymap", mode: "normal", keys: "J", action: "reset" });
  assert.deepEqual(reset.ok && reset.row, { mode: "normal", keys: "J", text: "tab.next", origin: "default" });
  assert.deepEqual(stored.edits, { normal: { zq: "" } });

  const listed = await messages.list();
  assert.equal(listed.ok && listed.bindings.find((row) => row.keys === "zq")?.origin, "removed");
  assert.equal((await messages.change({ type: "change_keymap", mode: "nope" as "normal", keys: "J", action: "reset" })).ok, false);
});

test("an edit meets a file key spelled another way: set, unbind and remove all reach it", async () => {
  // The default keymap binds `<C-d>`. The file spells its override `<C-D>`, and `<C-S-j>` with no default under it.
  const config = config_with({ normal: { "<C-D>": { id: "tab.prev" }, "<C-S-j>": { id: "tab.next" } } });
  const set = compile_config(input_of(config, { normal: { "<C-d>": "tab.close" } }));
  assert.equal(leaf_id(set.compiled, "<C-d>"), "tab.close");
  assert.deepEqual(set.warnings, []);
  assert.equal(leaf_id(compile_config(input_of(config, { normal: { "<C-d>": "" } })).compiled, "<C-d>"), undefined);

  const stored: { edits: KeymapEdits } = { edits: {} };
  const messages = messages_over(config, stored);
  const removed = await messages.change({ type: "change_keymap", mode: "normal", keys: "<C-S-j>", action: "remove" });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.deepEqual(stored.edits, { normal: { "<CS-j>": "" } });
  assert.equal(leaf_id(compile_config(input_of(config, stored.edits)).compiled, "<CS-j>"), undefined);

  await messages.change({ type: "change_keymap", mode: "normal", keys: "<C-d>", action: "set", text: "tab.close" });
  const listed = await messages.list();
  const rows = listed.ok ? listed.bindings.filter((row) => row.mode === "normal" && /^<C-?d>$|^<C-D>$/.test(row.keys)) : [];
  assert.deepEqual(rows.map((row) => [row.keys, row.origin, row.text]), [["<C-d>", "edit", "tab.close"]]);
});

test("a listed edit the compile dropped carries the warning instead of showing in force", async () => {
  // The alias the edit used left the config, as on a reload.
  const messages = messages_over(config_with({}), { edits: { normal: { J: "nt" } } });
  const listed = await messages.list();
  const row = listed.ok ? listed.bindings.find((candidate) => candidate.mode === "normal" && candidate.keys === "J") : undefined;
  assert.equal(row?.origin, "edit");
  assert.match(row?.skipped ?? "", /^keymap edits: normal skipped "J": /);
});

test("a joined multi-step text is refused, and a change that changes nothing says so", async () => {
  const stored: { edits: KeymapEdits } = { edits: {} };
  const messages = messages_over(config_with({}), stored);
  const joined = await messages.change({ type: "change_keymap", mode: "normal", keys: "J", action: "set", text: "open -t https://x.test ; tab.next" });
  assert.equal(joined.ok, false);
  assert.deepEqual(stored.edits, {});
  for (const request of [
    { keys: "J", action: "reset" },
    { keys: "zq", action: "remove" },
  ] as const) {
    const answer = await messages.change({ type: "change_keymap", mode: "normal", ...request });
    assert.deepEqual([answer.ok, answer.message.startsWith("Nothing to change")], [false, true], JSON.stringify(answer));
  }
  await messages.change({ type: "change_keymap", mode: "normal", keys: "J", action: "set", text: "tab.close" });
  const again = await messages.change({ type: "change_keymap", mode: "normal", keys: "J", action: "set", text: "tab.close" });
  assert.equal(again.ok, false);
});

test("a browser chord past the last free Firefox slot is refused by the check", async () => {
  // The defaults take 3 of the 10 slots.
  const browser_edits = (count: number) => ({ browser: Object.fromEntries(Array.from({ length: count }, (_, index) => [`<A-${index + 1}>`, "tab.next"])) });
  const last_free = await messages_over(config_with({}), { edits: browser_edits(6) }).check({ type: "check_binding", mode: "browser", keys: "<A-z>", text: "tab.next" });
  assert.equal(last_free.ok && last_free.saves, true, JSON.stringify(last_free));
  const past = await messages_over(config_with({}), { edits: browser_edits(7) }).check({ type: "check_binding", mode: "browser", keys: "<A-z>", text: "tab.next" });
  assert.equal(past.ok && !past.saves && past.warnings.some((warning) => /only 10 Firefox shortcut slots/.test(warning)), true, JSON.stringify(past));
});

test("the export keeps only the edits in force: one that does not read and one the compile skips stay out", () => {
  const config = config_with({});
  const layers: EditLayers = { keymap: { normal: { J: "tab.close", K: "", x: "user.gone" }, visual: { zz: "tab.next" } } };
  const exported = exportable_key_edits({ config, layers, compile: (other) => compile_config(input_of(config, other.keymap)) });
  assert.deepEqual(exported.edits, { normal: { J: "tab.close", K: "" } });
  assert.equal(exported.skipped.length, 2);
  assert.match(exported.skipped[0]!, /^keymap edits: normal skipped "x": unknown command "user.gone"/);
  assert.match(exported.skipped[1]!, /^visual: skipped "zz": tab.next runs in normal mode/);
});

test("a repeat remove says the key is already unbound", async () => {
  const messages = messages_over(config_with({}), { edits: { normal: { J: "" } } });
  const again = await messages.change({ type: "change_keymap", mode: "normal", keys: "J", action: "remove" });
  assert.deepEqual(again, { ok: false, message: 'Nothing to change: it is already unbound on normal "J".' });
});
