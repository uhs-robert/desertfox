import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { KNOWN_DIRS, KNOWN_FILES } from "../src/shared/config_build/source_files.ts";

// The host cannot import the TypeScript sets, so this test keeps its copies equal to them.
function host_set(name: string): string[] {
  const source = readFileSync(new URL("../host/desertfox-host", import.meta.url), "utf8");
  const body = new RegExp(`^${name} = \\{([^}]*)\\}`, "m").exec(source)?.[1];
  assert.ok(body, `${name} not found in the host`);
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]!).sort();
}

test("the host reads the same file and folder names the config build knows", () => {
  assert.deepEqual(host_set("KNOWN_FILES"), [...KNOWN_FILES].sort());
  assert.deepEqual(host_set("KNOWN_DIRS"), [...KNOWN_DIRS].sort());
});
