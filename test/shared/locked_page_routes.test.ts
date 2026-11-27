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

// Each `type` literal inside a `sendMessage(` call, from its open parenthesis to the one that closes it, over as many lines as the call takes.
function sent_types_in(source: string): string[] {
  const types: string[] = [];
  for (let start = source.indexOf("sendMessage("); start >= 0; start = source.indexOf("sendMessage(", start + 1)) {
    let depth = 0;
    let end = start + "sendMessage".length;
    for (; end < source.length; end++) {
      const quote = source[end]!;
      if (quote === '"' || quote === "'" || quote === "`") {
        for (end++; end < source.length && source[end] !== quote; end++) if (source[end] === "\\") end++;
      } else if (quote === "(") depth++;
      else if (quote === ")" && --depth === 0) break;
    }
    for (const match of source.slice(start, end).matchAll(/type: "([a-z_]+)"/g)) types.push(match[1]!);
  }
  return types;
}

async function sent_types(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const file of (await Promise.all(ROOTS.map(sources))).flat()) for (const type of sent_types_in(await readFile(file, "utf8"))) found.set(type, file);
  return found;
}

test("the scan reads a call over several lines, and a call on one line", () => {
  const source = ["const a = browser.runtime.sendMessage({", '  type: "new_request",', "  args: f(x),", "});", 'void browser.runtime.sendMessage({ type: "run", invocations: [] });',
    'browser.runtime.sendMessage({ text: ")", type: "quoted" });', '// type: "outside" sits in no call'].join("\n");
  assert.deepEqual(sent_types_in(source), ["new_request", "run", "quoted"]);
  assert.equal(Object.hasOwn(LOCKED_PAGE_ROUTES, "new_request"), false, "so an unrouted multi-line call fails the test below");
});

test("every type the page code sends has a locked page route, so a new type cannot slip past the allow list", async () => {
  const found = await sent_types();
  assert.ok(found.size >= 20, `the scan found only ${found.size} types`);
  const unrouted = [...found].filter(([type]) => !Object.hasOwn(LOCKED_PAGE_ROUTES, type));
  assert.deepEqual(unrouted, [], "add each to LOCKED_PAGE_ROUTES in src/shared/browser_module_protocol.ts, as background, module, snapshot or refused");
});
