import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import type { CommandDef } from "../../src/shared/command.ts";
import type { KeymapConfig } from "../../src/shared/keymap.ts";
import { registry } from "../../src/shared/registry/index.ts";
import { read_planned } from "../../tools/keymap_docs/planned.ts";
import { render } from "../../tools/keymap_docs/render.ts";
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
  const text = render(keymap, fake_registry, [{ mode: "normal", key: "m", status: "later", command: "mark.add", note: "phase 3" }]);
  assert.match(text, /^bound: 4 \(normal 4\) \| later: 1 \| dropped: 0$/m);
  assert.match(text, /\| `J` \| bound \| `tab\.next` \| Next tab \|  \|/);
  assert.match(text, /\| `j` \| bound \| `scroll --count=10` \| Scroll down \|  \|/);
  assert.match(text, /\| `x` \| bound \| `tab\.next ; tab\.prev` \| Next tab \|  \|/);
  assert.match(text, /\| `p` \| bound \| `scroll` \(prompts\) \| Scroll \|  \|/);
  assert.match(text, /\| `m` \| later \| `mark\.add` \|  \| phase 3 \|/);
  assert.ok(!text.includes("gone"));
});

test("the count line matches the rendered rows of the default keymap", () => {
  const planned = read_planned(read("docs/keymap_planned.toml"), DEFAULT_KEYMAP);
  const text = render(DEFAULT_KEYMAP, registry, planned);
  const rows = (status: string) => text.split("\n").filter((line) => line.startsWith("| ") && line.includes(` | ${status} | `)).length;
  const [, bound, later, dropped] = text.match(/^bound: (\d+) .* \| later: (\d+) \| dropped: (\d+)$/m)!.map(Number) as [number, number, number, number];
  assert.deepEqual({ bound, later, dropped }, { bound: rows("bound"), later: rows("later"), dropped: rows("dropped") });
});

test("render fails when the keymap has a mode it has no place for", () => {
  assert.throws(() => render({ normal: {}, newmode: {} } as KeymapConfig, fake_registry, []), /lacks the mode newmode/);
});

test("planned rows fail with a named message", () => {
  const keymap: KeymapConfig = { normal: { J: { id: "tab.next" } } };
  const row = (fields: string) => `[[row]]\nmode = "normal"\nkey = "m"\nstatus = "later"\n${fields}`;
  assert.doesNotThrow(() => read_planned(row(""), keymap));
  assert.throws(() => read_planned(row("").replace('"later"', '"v1"'), keymap), /status must be/);
  assert.throws(() => read_planned(row("").replace('"normal"', '"nope"'), keymap), /unknown mode/);
  assert.throws(() => read_planned(row("").replace('"m"', '"a b"'), keymap), /unparsable key/);
  assert.throws(() => read_planned(row("").replace('"m"', '"J"'), keymap), /already binds/);
  assert.throws(() => read_planned(`${row("")}\n${row("")}`, keymap), /duplicate row/);
});

test("docs/keymap.md is current", () => {
  const planned = read_planned(read("docs/keymap_planned.toml"), DEFAULT_KEYMAP);
  const doc = read("docs/keymap.md");
  assert.equal(splice(doc, render(DEFAULT_KEYMAP, registry, planned)), doc, "run `just docs-gen`");
});
