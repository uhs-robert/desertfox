import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const COMMENTS_AND_STRINGS = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;
// mangleProps: /_$/ renames any property name that ends in _, including `_` alone and names that start with _ or $. The pattern finds one at the start of a line or after { ; , ( in a type or object literal.
const SUFFIXED_PROPERTY = /(?:^|[{;,(])\s*(?:readonly\s+)?([\w$]*_)\??\s*:/gm;
// The same position, read back from a quoted string: a quoted name is not renamed, but its unquoted uses are, so quoting hides the break instead of fixing it.
const BEFORE_MEMBER = /(?:^|[{;,(\n])\s*(?:readonly\s+)?$/;
const AFTER_MEMBER = /^\s*\??:/;

// Files whose types cross the extension boundary, where the build's mangleProps: /_$/ (tools/build.mjs) must not rename a property: it would change the name on the wire or on disk and silently break stored data.
const BOUNDARY_TYPE_FILES: Record<string, string> = {
  "src/background/browser_deps.ts": "the bundle-load entries it builds are stored for `debug.perf` to read",
  "src/background/config_load.ts": "ConfigStatus and FilesSource are stored",
  "src/background/edit_layers.ts": "the keymap, engine, alias and imported theme edits are stored",
  "src/background/external_editor.ts": "EditorJob is stored in storage.session",
  "src/background/hint_frames.ts": "HintFramesSession is stored in storage.session and its messages cross frames",
  "src/background/host_start.ts": "HostStartPending is stored",
  "src/background/host_update.ts": "HostUpdateState is stored",
  "src/background/jump_store.ts": "the jump lists are stored",
  "src/background/last_used_tab.ts": "LastUsedRecord is stored in storage.session",
  "src/background/macro_recorder.ts": "the macro being recorded is stored",
  "src/background/mark_store.ts": "StoredMarks is stored",
  "src/background/native_client.ts": "requests and replies cross the native host",
  "src/background/reload.ts": "ReinjectReport is stored",
  "src/background/session_store.ts": "StoredSessions is stored and exported in a zip",
  "src/background/slots.ts": "SlotTable is stored",
  "src/background/tab_media.ts": "MediaHold and TopState are stored in storage.session",
  "src/background/tab_modes.ts": "TabModeRecord is stored and ModeReport is sent by content scripts",
  "src/cmdline/protocol.ts": "HostToPage and PageToHost cross window.postMessage",
  "src/shared/page/icon_cache.ts": "FaviconEntry is stored in storage.local",
  "src/newtab/net_widget.ts": "StoredEntry is stored in storage.local",
  "src/shared/config.ts": "the built config is stored under FILES_CONFIG_STORAGE_KEY",
  "src/shared/invocation.ts": "invocations are stored in the slot table, the repeat memory and registers",
  "src/shared/jump_names.ts": "JumpEntry sits inside the stored jump lists",
  "src/shared/messages/content.ts": "every message from a content script to the background",
  "src/shared/messages/page.ts": "every message from an extension page to the background",
  "src/shared/messages/ports.ts": "the devtools and tab model ports carry these messages",
  "src/shared/messages/tab.ts": "every message from the background to a frame",
  "src/shared/prefix_tree.ts": "CompiledKeymap is stored under COMPILED_KEYMAP_STORAGE_KEY",
};

const WHY_NO_SUFFIX = "a property name ending in _ is shortened by the build's mangleProps: /_$/, so on a boundary type it silently breaks messages or stored data. Rename it. Quoting it only hides it from the scan.";

function suffixed_properties(files: { path: string; text: string }[]): string[] {
  const found: string[] = [];
  for (const { path, text } of files) {
    const code = text.replace(COMMENTS_AND_STRINGS, (match, offset: number) => {
      const quoted_name = /^["']([\w$]*_)["']$/.exec(match)?.[1];
      const is_member = BEFORE_MEMBER.test(text.slice(Math.max(0, offset - 60), offset)) && AFTER_MEMBER.test(text.slice(offset + match.length, offset + match.length + 20));
      if (quoted_name !== undefined && is_member) found.push(`${path}: ${quoted_name}`);
      return match.replace(/[^\n]/g, " ");
    });
    for (const match of code.matchAll(SUFFIXED_PROPERTY)) found.push(`${path}: ${match[1]}`);
  }
  return found.sort();
}

test("no boundary type file has a property name ending in _", () => {
  const files = Object.keys(BOUNDARY_TYPE_FILES).map((path) => ({ path, text: readFileSync(path, "utf8") }));
  assert.deepEqual(suffixed_properties(files), [], WHY_NO_SUFFIX);
});

test("the scan catches a property ending in _, quoted or led by _ or $, and spares strings, comments and other names", () => {
  const planted = [
    { path: "a.ts", text: "export type A = {\n  count_: number;\n  ok: string;\n};" },
    { path: "b.ts", text: "type B = { x: 1; sent_?: boolean };" },
    { path: "d.ts", text: 'type D = { "q_": number; _lead_: 1; $dollar_: 2; _: 3 };' },
    { path: "c.ts", text: 'const s = "count_: 1"; // note_: 2\nconst t = cond ? a_ : b;' },
  ];
  assert.deepEqual(suffixed_properties(planted), ["$dollar_", "_", "_lead_", "q_"].map((name) => `d.ts: ${name}`).concat(["a.ts: count_", "b.ts: sent_"]).sort());
});

// Without `declare const browser: MessagingBrowser;` a file still compiles, and its sends stay `any` with any `type` and any answer cast. Comments and strings are blanked first, so neither a mention of the idiom nor a send inside a string counts.
function files_sending_without_the_declaration(files: { path: string; text: string }[]): string[] {
  return files
    .filter(({ text }) => {
      const code = text.replace(COMMENTS_AND_STRINGS, (match) => match.replace(/[^\n]/g, " "));
      return /\bbrowser\.(?:runtime|tabs)\.sendMessage\(/.test(code) && !code.includes("declare const browser: MessagingBrowser;");
    })
    .map(({ path }) => path)
    .sort();
}

test("every src file that sends a message declares the typed browser", () => {
  const files = (readdirSync("src", { recursive: true, encoding: "utf8" }) as string[]).filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts")).map((name) => ({ path: `src/${name}`, text: readFileSync(`src/${name}`, "utf8") }));
  assert.deepEqual(files_sending_without_the_declaration(files), [], "add `declare const browser: MessagingBrowser;` after the imports, so the send is checked against the message map");
});

test("the sender scan catches a send without the declaration and spares a declared file, and a mention in a comment does not count", () => {
  const planted = [
    { path: "a.ts", text: "browser.runtime.sendMessage({});" },
    { path: "b.ts", text: "declare const browser: MessagingBrowser;\nbrowser.tabs.sendMessage(1, {});" },
    { path: "c.ts", text: "// declare const browser: MessagingBrowser;\nbrowser.runtime.sendMessage({});" },
  ];
  assert.deepEqual(files_sending_without_the_declaration(planted), ["a.ts", "c.ts"]);
});
