import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { LOCKED_PAGE_ROUTES } from "../../src/shared/browser_module_protocol.ts";

// The page code the browser module runs on a locked page: content.js, the bundles, the command line host and the shared code they import.
const ROOTS = ["src/content", "src/shared", "src/cmdline/host.ts"];

async function sources(path: string): Promise<string[]> {
  if (path.endsWith(".ts")) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => sources(join(path, entry.name)).catch(() => [])))).flat().filter((file) => file.endsWith(".ts"));
}

// Each `type` literal in a `sendMessage(` call on the same line.
async function sent_types(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const file of (await Promise.all(ROOTS.map(sources))).flat()) {
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      const call = line.indexOf("sendMessage(");
      if (call < 0) continue;
      for (const match of line.slice(call).matchAll(/type: "([a-z_]+)"/g)) found.set(match[1]!, file);
    }
  }
  return found;
}

test("every type the page code sends has a locked page route, so a new type cannot slip past the allow list", async () => {
  const found = await sent_types();
  assert.ok(found.size >= 20, `the scan found only ${found.size} types`);
  const unrouted = [...found].filter(([type]) => !Object.hasOwn(LOCKED_PAGE_ROUTES, type));
  assert.deepEqual(unrouted, [], "add each to LOCKED_PAGE_ROUTES in src/shared/browser_module_protocol.ts, as background, module, snapshot or refused");
});
