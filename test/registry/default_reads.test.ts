import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { CommandMeta, ParamDef } from "../../src/shared/command.ts";
import { print_command } from "../../src/shared/registry/index.ts";

const WHERE: ParamDef = { name: "where", type: "enum", values: ["here", "tab"], default: "here" };

test("the printer drops a literal default and a conditional default only while its condition holds", () => {
  const note: ParamDef = { name: "note", type: "string", default: [{ value: "x", when: { where: ["tab"] } }] };
  const label: ParamDef = { name: "label", type: "string", default: "plain" };
  const command = { id: "c.n", name: "cn", label: "N", intent: "Note.", params: [WHERE, note, label] } as CommandMeta;
  assert.equal(print_command(command, { where: "tab", note: "x", label: "plain" }, {}), "cn --tab");
  assert.equal(print_command(command, { where: "tab", note: "y", label: "other" }, {}), "cn --tab --note=y --label=other");
  assert.equal(print_command(command, { where: "here", note: "x", label: "plain" }, {}), "cn --note=x");
});

// A read of a param's `default` anywhere else would skip the conditional form. The files below write or check the definition, or read a different `default`.
const MAY_READ = new Set(["src/shared/registry/params.ts", "src/shared/registry/define.ts", "tools/build-config/snippet.ts", "src/shared/engines/resolve.ts", "src/help/render.ts", "tools/build-config/schemas.ts", "tools/build_default_settings.ts"]);

const READ_FORMS: RegExp[] = [
  /\.default\b/, // param.default
  /\[\s*["'`]default["'`]\s*\]/, // param["default"]
  /\{[^{}]*\bdefault\b[^{}]*\}\s*=[^=>]/, // const { default: d } = param
  /\(\s*\{[^{}]*\bdefault\b[^{}]*\}\s*(:[^)]*)?\)\s*(=>|\{)/, // ({ default }) => ...
];

export const reads_default = (text: string): boolean => READ_FORMS.some((form) => form.test(text));

test("the scan sees every form of reading a default, and not a definition", () => {
  for (const text of ["x.default", 'x["default"]', "x['default']", "x[`default`]", "const { default: d } = param;", "const { name, default } = param;", "map(({ default: d }) => d)", "function f({ default }: ParamDef) {", "param\n  .default"]) {
    assert.ok(reads_default(text), text);
  }
  for (const text of ['{ name: "url", default: "" }', 'params: [{ name: "a", default: 1 }, B]', "export default x;", "switch (a) { default: break; }"]) {
    assert.ok(!reads_default(text), text);
  }
});

const SOURCE_EXTENSIONS = /\.(ts|mts|cts|js|mjs|cjs|html|sh)$/;

function sources_under(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources_under(path);
    return SOURCE_EXTENSIONS.test(name) ? [path] : [];
  });
}

test("no file outside params.ts reads a param's default directly", () => {
  const offenders = [...sources_under("src"), ...sources_under("tools")]
    .filter((path) => !MAY_READ.has(path))
    .filter((path) => reads_default(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
});
