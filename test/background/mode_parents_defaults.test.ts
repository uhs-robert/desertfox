// Item and media mode take normal keys through `mode_parents` instead of a copied list. These tests pin that every key
// the copies gave still resolves to the same leaf, and name each key the rule adds.

import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import { with_resolved_modes } from "../../src/shared/keys/mode_parents.ts";
import { parse_sequence } from "../../src/shared/keys/notation.ts";
import type { TreeBranch, TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const { compiled, warnings } = compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
const resolved = with_resolved_modes(compiled).modes;

const leaves_of = (node: TreeBranch | undefined, path = ""): Map<string, TreeLeaf> =>
  new Map(Object.entries(node?.children ?? {}).flatMap(([token, child]) => (child.kind === "leaf" ? [[path + token, child] as const] : [...leaves_of(child, path + token)])));

const normalized = (sequence: string) => (parse_sequence(sequence).tokens ?? []).join("");

// The lists the default keymap copied from normal mode before the rule.
const NORMAL_ONLY_HINT_KEYS = [";fF", ";fe"];
const KEPT_IN_ITEM = ["J", "K", "gt", "gT", "<C-d>", "<C-u>", "<C-f>", "<C-b>", ":", "<F1>", "g?", "f", "F", "/", "]]", "[[", "<C-o>", "<C-i>", "gi", "H", "L", "am", "aa", "ap", "as", "aS", "ar", "av", "aV", "al", "ah", "aP", "af", "A", "i", "gV", "n", "N", "*", "#", "<S-Escape>", "<S-Insert>", "<AC-Escape>", "<AC-`>", ",i", "<C-v>"].map(normalized);
const COPIED: Record<"item" | "media", (sequence: string) => boolean> = {
  item: (sequence) => (KEPT_IN_ITEM.includes(sequence) || sequence.startsWith(";")) && !NORMAL_ONLY_HINT_KEYS.includes(sequence),
  media: (sequence) => (sequence === "f" || sequence === ":" || sequence.startsWith(";")) && !NORMAL_ONLY_HINT_KEYS.includes(sequence),
};

// The keys the rule adds. Each one is a normal key whose commands all list the mode in the registry.
const GAINED = {
  item: [",?", ",h", ",s", "<A-m>", "[T", "[j", "[t", "[v", "]T", "]j", "]t", "]v", "g$", "g0", "sh", "t$", "t0", "tM", "tn", "tp", "wh"],
  media: ["A", "[v", "]v", "aP", "aS", "aV", "af", "ah", "al", "ap", "ar", "as", "av", "sh", "tM", "wh"],
};

const old_keys = (mode: "item" | "media"): Map<string, TreeLeaf> => {
  const copied = [...leaves_of(compiled.modes.normal)].filter(([sequence]) => COPIED[mode](sequence));
  // The own keys won over the copies, as they win over the parent's keys now.
  return new Map([...copied, ...leaves_of(compiled.modes[mode])]);
};

test("the default keymap with its parent links compiles with no warnings", () => {
  assert.deepEqual(warnings, []);
  assert.deepEqual(compiled.mode_parents?.item?.blocked, [[";", "f", "F"], [";", "f", "e"], ["g", "F"]]);
  assert.deepEqual(compiled.mode_parents?.media?.blocked, [["a", "a"]]);
});

for (const mode of ["item", "media"] as const) {
  // `old_keys` applies the old copy rule to the current normal tree, so this pins the rule, not a snapshot of the old trees.
  test(`${mode} mode: each key the old copy rule picked resolves to the leaf normal mode has for it`, () => {
    const now = leaves_of(resolved[mode]);
    const before = old_keys(mode);
    assert.ok(before.size > 100, `${before.size} keys`);
    for (const [sequence, leaf] of before) assert.deepEqual(now.get(sequence), leaf, sequence);
  });

  test(`${mode} mode: the rule adds exactly the reviewed keys, and ;fF, ;fe and gF stay out`, () => {
    const before = old_keys(mode);
    const gained = [...leaves_of(resolved[mode]).keys()].filter((sequence) => !before.has(sequence));
    assert.deepEqual(gained.sort(), [...GAINED[mode]].sort());
    for (const sequence of [...NORMAL_ONLY_HINT_KEYS, "gF"]) assert.equal(leaves_of(resolved[mode]).get(sequence), undefined, sequence);
  });

  test(`${mode} mode: every key runs commands that list ${mode} mode, so the rest of normal mode stays out of reach`, () => {
    for (const [sequence, leaf] of leaves_of(resolved[mode])) {
      for (let choice: TreeLeaf | undefined = leaf; choice; choice = choice.otherwise) {
        for (const step of choice.steps) assert.ok((registry.get(step.invocation.id)?.modes ?? ["normal"]).includes(mode), `${sequence} -> ${step.invocation.id}`);
      }
    }
  });
}
