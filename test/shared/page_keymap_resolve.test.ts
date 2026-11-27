import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";
import { keymap_snapshot_of, page_keymap_for } from "../../src/background/page_keymap.ts";
import type { JoinMode } from "../../src/background/page_keymap.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import { BROWSER_MODULE_PROTOCOL_VERSION, json_bytes, MAX_SNAPSHOT_BYTES, validate_snapshot } from "../../src/shared/browser_module_protocol.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap } from "../../src/shared/prefix_tree.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { page_keymap_of } from "../../src/shared/site/page_keymap_resolve.ts";

const SITE_RULES = [
  { site: "https://pass.test/*", pass: "j <Space>" },
  { site: "https://only.test/*", only: "j" },
  { site: "https://off.test/*", off: true },
  { site: "https://bind.test/*", bind: { j: { id: "tab.next" } } },
  { site: "https://modes.test/*", modes: { visual: { label: "VISUAL", bind: { l: { id: "tab.next" } } } } },
  { site: "https://sticky.test/*", modes: { reading: { label: "READ", sticky: true, bind: { z: { id: "tab.prev" } } } } },
  { site: "https://rec.test/*", modes: { rec: { label: "REC", bind: { q: { id: "tab.next" }, w: { id: "tab.prev" } } } } },
  { site: "https://zoom.test/*", blur_on_load: true, scroll_selector: "#pane" },
];

function compiled_with(settings: Record<string, unknown>, keymap: Record<string, unknown> = {}): CompiledKeymap {
  const { compiled, warnings } = compile_config({ config: { ...empty_config(), keymap: keymap as never, settings: { site_rules: SITE_RULES, ...settings } as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  assert.deepEqual(warnings, []);
  return compiled;
}

const ADDRESSES = [
  "https://example.test/",
  "https://pass.test/a",
  "https://only.test/a",
  "https://off.test/a",
  "https://bind.test/a",
  "https://modes.test/a",
  "https://sticky.test/a",
  "https://zoom.test/a",
  "https://drive.google.com/drive/my-drive",
  "https://docs.google.com/spreadsheets/d/abc/edit",
  "about:reader?url=https%3A%2F%2Fexample.test%2F",
  undefined,
];
const STATES: { recording?: string; join?: JoinMode; bar?: boolean }[] = [{}, { recording: "a" }, { join: "insert" }, { bar: true }, { recording: "b", join: "insert", bar: true }];

const storage_of = (keymap: CompiledKeymap) => ({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) }) as never;

// The locked page shim runs `page_keymap_of` on the keymap it parsed from the snapshot text, and the background runs `page_keymap_for` on the stored keymap. One page must get one answer from either.
for (const [name, settings] of [["the default keymap with the shipped and test rows", {}], ["item_select set to arrows everywhere", { item_select: "arrows" }]] as const) {
  test(`the shared resolver equals page_keymap_for: ${name}`, async () => {
    const stored = compiled_with(settings);
    const from_snapshot = current_keymap(JSON.parse(JSON.stringify(keymap_snapshot_of(stored))) as CompiledKeymap);
    for (const address of ADDRESSES) {
      for (const state of STATES) {
        const expected = await page_keymap_for(storage_of(stored), [address], state.recording, async () => state.join, state.bar);
        assert.deepEqual(page_keymap_of(from_snapshot, [address], state), expected, JSON.stringify([address, state]));
      }
    }
  });
}

test("the rules reach the answer: pass, only, off, bind and site modes differ from the plain page", () => {
  const keymap = compiled_with({});
  const plain = page_keymap_of(keymap, ["https://example.test/"])!;
  assert.equal(page_keymap_of(keymap, ["https://pass.test/a"])!.keymap.modes.normal?.children["j"], undefined);
  assert.deepEqual(Object.keys(page_keymap_of(keymap, ["https://only.test/a"])!.keymap.modes.normal!.children).includes("k"), false);
  assert.equal(page_keymap_of(keymap, ["https://off.test/a"])!.all_off, true);
  assert.notDeepEqual(page_keymap_of(keymap, ["https://bind.test/a"])!.keymap.modes.normal, plain.keymap.modes.normal);
  assert.ok(page_keymap_of(keymap, ["https://modes.test/a"])!.site_modes?.["visual"]);
  assert.equal(plain.site_modes?.["visual"], undefined);
});

test("recording swaps the stop key into the normal tree and into site modes, and a page that is off takes no join", () => {
  const keymap = compiled_with({});
  const recording = page_keymap_of(keymap, ["https://modes.test/a"], { recording: "a" })!;
  assert.equal(recording.recording, "a");
  assert.equal(JSON.stringify(recording.keymap.modes.normal?.children["q"]).includes("macro.stop"), true);
  assert.equal(JSON.stringify(page_keymap_of(keymap, ["https://modes.test/a"])!.keymap.modes.normal?.children["q"]).includes("macro.stop"), false);
  assert.equal(page_keymap_of(keymap, ["https://off.test/a"], { join: "insert" })!.join, undefined);
  assert.equal(page_keymap_of(keymap, ["https://example.test/"], { join: "insert" })!.join, "insert");
});

test("while recording, a site mode that binds the record key still gets the stop key and keeps its other binds", () => {
  const keymap = compiled_with({});
  const mode_tree = (state: { recording?: string }) => page_keymap_of(keymap, ["https://rec.test/a"], state)!.site_modes!["rec"]!.tree;
  assert.equal(JSON.stringify(mode_tree({})["q"]).includes("tab.next"), true, "not recording: the mode's own bind");
  assert.equal(JSON.stringify(mode_tree({ recording: "a" })["q"]).includes("macro.stop"), true, "recording: the stop key");
  assert.equal(JSON.stringify(mode_tree({ recording: "a" })["w"]).includes("tab.prev"), true);
});

test("while recording, a site mode leaf on the first key of a prefixed record key gives way to the stop path", () => {
  const keymap = compiled_with({ site_rules: [{ site: "https://gq.test/*", modes: { rec: { label: "REC", bind: { g: { id: "tab.next" }, w: { id: "tab.prev" } } } } }] }, { normal: { gq: { id: "macro.record" } } });
  const mode_tree = (state: { recording?: string }) => page_keymap_of(keymap, ["https://gq.test/a"], state)!.site_modes!["rec"]!.tree;
  assert.equal(JSON.stringify(mode_tree({})["g"]).includes("tab.next"), true, "not recording: the site's own leaf");
  const g = mode_tree({ recording: "a" })["g"];
  assert.equal(g?.kind, "branch");
  assert.equal(JSON.stringify(g).includes("macro.stop"), true, "recording: g then q stops");
  assert.equal(JSON.stringify(g).includes("tab.next"), false);
  assert.equal(JSON.stringify(mode_tree({ recording: "a" })["w"]).includes("tab.prev"), true, "other binds stay");
});

test("no keymap gives no answer", () => {
  assert.equal(page_keymap_of(undefined, ["https://example.test/"]), undefined);
});

// The snapshot holds the stored keymap with its site rules as an object, and the validator measures the whole snapshot as JSON text. With the shipped rows it is about 419 KB of the 512 KB cap. A user config that adds rules can pass the cap, and the part is then removed (`write_parts`), so the shim stops the page code.
test("the keymap snapshot with the shipped site rows fits the snapshot cap", () => {
  const shipped = compiled_with({ site_rules: [] });
  const bytes = json_bytes({ v: BROWSER_MODULE_PROTOCOL_VERSION, value: keymap_snapshot_of(shipped) })!;
  console.log(`keymap snapshot bytes: ${bytes} of ${MAX_SNAPSHOT_BYTES}, ${MAX_SNAPSHOT_BYTES - bytes} left for user rules`);
  assert.equal(validate_snapshot("keymap", { v: BROWSER_MODULE_PROTOCOL_VERSION, value: JSON.parse(JSON.stringify(keymap_snapshot_of(shipped))) }).ok, true);
  assert.ok(bytes < 450 * 1024);
});
