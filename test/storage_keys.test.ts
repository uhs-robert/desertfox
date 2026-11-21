import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const KEY_FILES = ["src/background/slots.ts", "src/background/storage_keys.ts", "src/shared/prefix_tree.ts", "src/shared/storage_watch.ts", "src/shared/theme/apply.ts"];

// Names that start with `desertfox_` but are not storage keys: native host and port names, a message mark, a page flag and the practice page's session keys.
const NOT_STORAGE_KEYS: Record<string, string[]> = {
  "src/background/bridge.ts": ["desertfox_bridge"],
  "src/cmdline/protocol.ts": ["desertfox_cmdline"],
  "src/content/handlers/focus.ts": ["desertfox_content_loaded"],
  "src/help/practice_page.ts": ["desertfox_practice_left", "desertfox_practice_done"],
  "src/shared/native_host.ts": ["desertfox_host"],
  "src/shared/rank_port.ts": ["desertfox_rank"],
  "src/shared/tab_model_port.ts": ["desertfox_tab_model"],
};

const root = new URL("../", import.meta.url);
const sources = readdirSync(new URL("src", root), { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".ts"))
  .map((path) => `src/${path}`)
  .sort();
const code_of = (path: string) =>
  readFileSync(new URL(path, root), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

type Definition = { name: string; value: string; file: string };
const definitions: Definition[] = sources.flatMap((file) =>
  [...code_of(file).matchAll(/^export const ([A-Z][A-Z_]*_STORAGE_(?:KEY|PREFIX)) = "([^"]*)";/gm)].map((match) => ({ name: match[1]!, value: match[2]!, file })),
);

test("every storage key is defined once, in a key file, under the desertfox_ namespace", () => {
  assert.ok(definitions.length > 40, "the definition scan found too few keys");
  assert.deepEqual(definitions.filter((definition) => !KEY_FILES.includes(definition.file)).map((definition) => `${definition.name} in ${definition.file}`), []);
  for (const file of KEY_FILES) assert.ok(definitions.some((definition) => definition.file === file), `${file} defines no key: remove it from the list`);
  const values = definitions.map((definition) => definition.value);
  const names = definitions.map((definition) => definition.name);
  assert.deepEqual(values.filter((value, at) => values.indexOf(value) !== at), [], "two keys share a value");
  assert.deepEqual(names.filter((name, at) => names.indexOf(name) !== at), [], "two keys share a name");
  assert.deepEqual(values.filter((value) => !/^desertfox_[a-z_]+$/.test(value)), []);
});

test("no whole key starts with the value of a prefix key, so a prefix scan never sweeps another key", () => {
  const prefixes = definitions.filter((definition) => definition.name.endsWith("_PREFIX"));
  for (const key of definitions.filter((definition) => definition.name.endsWith("_KEY"))) {
    for (const prefix of prefixes) assert.ok(!key.value.startsWith(prefix.value), `${key.name} starts with ${prefix.name}`);
  }
});

test("a desertfox_ string literal outside the key files is a named non-key", () => {
  const found: string[] = [];
  for (const file of sources.filter((path) => !KEY_FILES.includes(path))) {
    for (const match of code_of(file).matchAll(/["'`](desertfox_[a-z_]+)/g)) {
      if (!NOT_STORAGE_KEYS[file]?.includes(match[1]!)) found.push(`${match[1]} in ${file}: define it in a key file, or name it in NOT_STORAGE_KEYS`);
    }
  }
  assert.deepEqual(found, []);
  for (const [file, literals] of Object.entries(NOT_STORAGE_KEYS)) {
    for (const literal of literals) assert.ok(code_of(file).includes(`"${literal}`), `${literal} is gone from ${file}: remove the exception`);
  }
});
