import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const COMMENTS_AND_STRINGS = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;
const EVAL_CALL = /\beval\s*\(/;
const NEW_FUNCTION = /\bnew\s+Function\b|(?<![.\w$])Function\s*\(/;
const STORAGE_KEY_CONSTANT = /\b[A-Z][A-Z0-9_]*KEY[A-Z0-9_]*\s*=\s*"([^"\n]*)"/g;
const MESSAGE_TYPE = /\btype:\s*"([^"\n]*)"/g;

// A call that is the browser's own API and runs a page expression, not code of ours. Keyed by file, matched on its exact text.
const ALLOWED_EVAL_CALLS: Record<string, string> = {
  "src/devtools/main.ts": "browser.devtools.inspectedWindow.eval(",
};

const WHY_NO_EVAL = "src/ must not evaluate strings (AGENTS.md architecture rules): eval and new Function are banned.";
const WHY_NO_SUFFIX = "the build's mangleProps: /_$/ (tools/build.mjs) shortens names ending in _, so a stored or sent key ending in _ silently breaks stored data.";

function source_files(): { path: string; text: string }[] {
  return readdirSync("src", { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ts$/.test(entry.name))
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path, text: readFileSync(path, "utf8") };
    });
}

function eval_violations(files: { path: string; text: string }[]): string[] {
  const found: string[] = [];
  for (const { path, text } of files) {
    const code = text.replace(COMMENTS_AND_STRINGS, (match) => match.replace(/[^\n]/g, " "));
    const lines = code.split("\n");
    lines.forEach((line, index) => {
      if (!EVAL_CALL.test(line) && !NEW_FUNCTION.test(line)) return;
      const allowed = ALLOWED_EVAL_CALLS[path];
      if (allowed !== undefined && text.split("\n")[index]!.includes(allowed)) return;
      found.push(`${path}:${index + 1}: ${text.split("\n")[index]!.trim()}`);
    });
  }
  return found;
}

function key_suffix_violations(files: { path: string; text: string }[]): string[] {
  const found: string[] = [];
  for (const { path, text } of files) {
    for (const pattern of [STORAGE_KEY_CONSTANT, MESSAGE_TYPE]) {
      for (const match of text.matchAll(pattern)) {
        if (match[1]!.endsWith("_")) found.push(`${path}: "${match[1]}"`);
      }
    }
  }
  return found;
}

test("src/ never calls eval or new Function", () => {
  assert.deepEqual(eval_violations(source_files()), [], WHY_NO_EVAL);
});

test("no storage key constant or message type string ends in _", () => {
  assert.deepEqual(key_suffix_violations(source_files()), [], WHY_NO_SUFFIX);
});

test("the scan catches eval, new Function and a key ending in _", () => {
  const planted = [
    { path: "src/x.ts", text: "const run = eval(code);\nconst make = new Function(\"a\", body);\n// eval(ignored)\nconst s = \"eval(\";" },
    { path: "src/y.ts", text: 'export const MODE_STORAGE_KEY = "desertfox_mode_";\nsend({ type: "run_" });' },
  ];
  assert.equal(eval_violations(planted).length, 2);
  assert.equal(key_suffix_violations(planted).length, 2);
});
