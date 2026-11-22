import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";
import { SETTING_DOCS } from "../../src/shared/settings_docs.ts";
import { DEFAULT_SITE_ROW_NAMES } from "../../src/shared/table_constants.ts";
import type { CommandDef } from "../../src/shared/command.ts";
import type { KeymapConfig } from "../../src/shared/keymap.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { render } from "../../tools/keymap_docs/render.ts";
import { render_site_rows } from "../../tools/keymap_docs/render_site_rows.ts";
import { BEGIN_MARKER, cell, code, END_MARKER, splice } from "../../tools/keymap_docs/splice.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const fake_commands: Record<string, Partial<CommandDef>> = {
  "scroll.lines": { id: "scroll.lines", name: "scroll", label: "Scroll", params: [{ name: "count", type: "number", positional: true } as never] },
  "tab.next": { id: "tab.next", label: "Next tab" },
  "tab.prev": { id: "tab.prev", label: "Previous tab" },
};
const fake_registry = { get: (id: string) => fake_commands[id] as CommandDef | undefined };

test("splice replaces only the block between the markers", () => {
  const doc = `intro\n${BEGIN_MARKER}\nold\n${END_MARKER}\noutro\n`;
  assert.equal(splice(doc, "new"), `intro\n${BEGIN_MARKER}\n\nnew\n\n${END_MARKER}\noutro\n`);
});

test("splice rejects missing, duplicated and reversed markers", () => {
  assert.throws(() => splice("no markers", "x"), /exactly one/);
  assert.throws(() => splice(`${BEGIN_MARKER}\n${BEGIN_MARKER}\n${END_MARKER}`, "x"), /exactly one/);
  assert.throws(() => splice(`${END_MARKER}\n${BEGIN_MARKER}`, "x"), /comes before/);
});

test("cell escapes pipes and collapses whitespace, and code survives backticks", () => {
  assert.equal(cell("a |  b\n c"), "a \\| b c");
  assert.equal(code("<C-`>"), "``<C-`>``");
  assert.equal(code("`"), "`` ` ``");
});

test("render covers a bound, chained, labeled, prompting and array binding, and skips null", () => {
  const keymap: KeymapConfig = {
    normal: {
      J: { id: "tab.next" },
      j: { id: "scroll.lines", args: { count: 10 }, label: "Scroll down" },
      x: [{ id: "tab.next" }, { id: "tab.prev" }],
      p: { id: "scroll.lines", prompt: { param: "count" } },
      gone: null,
    },
  };
  const text = render(keymap, fake_registry);
  assert.match(text, /^bound: 4 \(normal 4\)$/m);
  assert.match(text, /\| `J` \| `tab\.next` \| Next tab \|/);
  assert.match(text, /\| `j` \| `scroll --count=10` \| Scroll down \|/);
  assert.match(text, /\| `x` \| `tab\.next ; tab\.prev` \| Next tab \|/);
  assert.match(text, /\| `p` \| `scroll` \(prompts\) \| Scroll \|/);
  assert.ok(!text.includes("gone"));
});

test("render fails when the keymap has a mode it has no place for", () => {
  assert.throws(() => render({ normal: {}, newmode: {} } as KeymapConfig, fake_registry), /lacks the mode newmode/);
});

test("docs/keymap.md is current", () => {
  const doc = read("docs/keymap.md");
  assert.equal(splice(doc, render(DEFAULT_KEYMAP, registry)), doc, "run `just docs-gen`");
});

test("docs/site_rows.md is current", () => {
  const doc = read("docs/site_rows.md");
  assert.equal(splice(doc, render_site_rows(DEFAULT_SITE_ROWS, DEFAULT_KEYMAP, registry)), doc, "run `just docs-gen`");
});

test("docs/site_rows.md lists every shipped row name and the setting text names it too", () => {
  const doc = read("docs/site_rows.md");
  // The first sentence is generated from the names, so only the hand-written prose after it can drift.
  const prose = SETTING_DOCS.default_site_rows_off.slice(SETTING_DOCS.default_site_rows_off.indexOf(". ") + 2);
  for (const name of DEFAULT_SITE_ROW_NAMES) {
    assert.ok(doc.includes(`### \`${name}\``), `site_rows.md lacks ${name}`);
    assert.ok(prose.includes(`\`${name}\``), `default_site_rows_off text lacks ${name}`);
  }
});
