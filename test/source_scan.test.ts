import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const COMMENTS_AND_STRINGS = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;
// An unquoted property name ending in _, at the start of a line or after { ; , ( in a type or object literal.
const SUFFIXED_PROPERTY = /(?:^|[{;,(])\s*(?:readonly\s+)?([A-Za-z0-9]\w*_)\??\s*:/gm;

// Files whose types cross the extension boundary, where the build's mangleProps: /_$/ (tools/build.mjs) must not rename a property: it would change the name on the wire or on disk and silently break stored data.
const BOUNDARY_TYPE_FILES: Record<string, string> = {
  "src/shared/messages.ts": "every message between content scripts, pages and the background",
  "src/shared/invocation.ts": "invocations are stored in the slot table, the repeat memory and registers",
  "src/shared/config.ts": "the built config is stored under FILES_CONFIG_STORAGE_KEY",
  "src/shared/prefix_tree.ts": "CompiledKeymap is stored under COMPILED_KEYMAP_STORAGE_KEY",
  "src/background/config_load.ts": "ConfigStatus and FilesSource are stored",
  "src/background/edit_layers.ts": "the keymap, engine, alias and imported theme edits are stored",
  "src/background/external_editor.ts": "EditorJob is stored in storage.session",
  "src/background/host_start.ts": "HostStartPending is stored",
  "src/background/host_update.ts": "HostUpdateState is stored",
  "src/background/jump_store.ts": "the jump lists are stored",
  "src/background/last_used_tab.ts": "LastUsedRecord is stored in storage.session",
  "src/background/macro_recorder.ts": "the macro being recorded is stored",
  "src/background/mark_store.ts": "StoredMarks is stored",
  "src/background/reload.ts": "ReinjectReport is stored",
  "src/background/repeat_memory.ts": "the last repeatable request is stored",
  "src/background/session_store.ts": "StoredSessions is stored and exported in a zip",
  "src/background/slots.ts": "SlotTable is stored",
  "src/background/timing_log.ts": "the timings are stored in storage.session",
};

const WHY_NO_SUFFIX = "a property name ending in _ is shortened by the build's mangleProps: /_$/, so on a boundary type it silently breaks messages or stored data. Quote it or rename it.";

function suffixed_properties(files: { path: string; text: string }[]): string[] {
  const found: string[] = [];
  for (const { path, text } of files) {
    const code = text.replace(COMMENTS_AND_STRINGS, (match) => match.replace(/[^\n]/g, " "));
    for (const match of code.matchAll(SUFFIXED_PROPERTY)) found.push(`${path}: ${match[1]}`);
  }
  return found;
}

test("no boundary type file has a property name ending in _", () => {
  const files = Object.keys(BOUNDARY_TYPE_FILES).map((path) => ({ path, text: readFileSync(path, "utf8") }));
  assert.deepEqual(suffixed_properties(files), [], WHY_NO_SUFFIX);
});

test("the scan catches a property ending in _ and spares strings, comments and other names", () => {
  const planted = [
    { path: "a.ts", text: "export type A = {\n  count_: number;\n  ok: string;\n};" },
    { path: "b.ts", text: "type B = { x: 1; sent_?: boolean };" },
    { path: "c.ts", text: 'const s = "count_: 1"; // note_: 2\nconst t = cond ? a_ : b;' },
  ];
  assert.deepEqual(suffixed_properties(planted), ["a.ts: count_", "b.ts: sent_"]);
});
