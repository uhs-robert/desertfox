import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { create_completer } from "../../src/cmdline/completion/sources.ts";
import { create_word_lookup } from "../../src/cmdline/word_lookup.ts";
import type { CommandMeta, ParamDef } from "../../src/shared/command.ts";
import { compile_keymap } from "../../src/shared/keys/compiler.ts";
import { flag_alternatives, print_command, summary_problems } from "../../src/shared/registry/index.ts";

// An enum whose default value is conditional: the value "x" is the default only when `where` is tab.
const WHERE: ParamDef = { name: "where", type: "enum", values: ["here", "tab"], default: "here" };
const PICK: ParamDef = { name: "pick", type: "enum", values: ["x", "y"], default: { value: "x", when: { where: ["tab"] } } };
const COMMAND = { id: "c.d", name: "cd", label: "Conditional", intent: "Pick one.", params: [WHERE, PICK] };

test("the label code leaves out the value of a conditional enum default", () => {
  const { compiled } = compile_keymap({ normal: { a: { id: "c.d", args: { pick: "x" } }, b: { id: "c.d", args: { pick: "y" } } } }, {}, () => ({ runs_in: "background", label: "Conditional", count: "ignore", params: [WHERE, PICK] }));
  const label = (key: string) => (compiled.modes.normal!.children[key] as { label: string }).label;
  assert.equal(label("a"), "Conditional");
  assert.equal(label("b"), "Conditional y");
});

test("the flag list and completion leave out the value of a conditional enum default", () => {
  assert.deepEqual(flag_alternatives(PICK), ["--y"]);
  const lookup = create_word_lookup([COMMAND] as CommandMeta[]);
  const rows = create_completer(lookup, [COMMAND] as CommandMeta[], {}, {})("cd --", 5).rows.map((row) => row.name);
  assert.ok(rows.includes("--y"));
  assert.ok(!rows.includes("--x"));
});

test("the summary audit asks no description for the value of a conditional enum default", () => {
  const params = [WHERE, { ...PICK, description: { y: "Pick the second." } }, ];
  assert.deepEqual(summary_problems({ id: "c.d", intent: "Pick one.", params: [{ ...params[0]!, description: { tab: "Open in a tab." } }, params[1]!] }), []);
});

test("the printer leaves out a literal default and never prints a conditional one as text", () => {
  const url: ParamDef = { name: "url", type: "string", main: true, default: { value: "", when: { where: ["tab"] } } };
  const command = { id: "c.u", name: "cu", label: "U", intent: "Open.", params: [WHERE, url] } as CommandMeta;
  const text = print_command(command, { where: "tab", url: "a.example" }, {});
  assert.ok(!text.includes("[object Object]"), text);
});

// Reading a param's `default` anywhere else would skip the conditional form. The files below write or check the definition, or read a different `default`.
const MAY_READ = new Set(["src/shared/registry/params.ts", "src/shared/registry/define.ts", "tools/build-config/snippet.ts", "src/shared/engines/resolve.ts", "src/help/render.ts"]);

function sources_under(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources_under(path);
    return /\.(ts|mjs)$/.test(name) ? [path] : [];
  });
}

test("no file outside params.ts reads a param's default directly", () => {
  const offenders = [...sources_under("src"), ...sources_under("tools")]
    .filter((path) => !MAY_READ.has(path))
    .filter((path) => /\.default\b/.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
});
