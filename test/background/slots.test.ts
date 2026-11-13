import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_slot_plan, plan_slots, release_slots, SLOT_MAP_STORAGE_KEY, slot_table } from "../../src/background/slots.ts";
import "../../src/background/command_modules.ts";
import { install_fake_browser, type Files } from "./config_fake_browser.ts";
import type { TreeBranch, TreeNode } from "../../src/shared/prefix_tree.ts";

function leaf(id: string): TreeNode {
  return { kind: "leaf", steps: [{ invocation: { id }, runs_in: "background", count_rule: "ignore" }] };
}
const root = (children: Record<string, TreeNode>): TreeBranch => ({ kind: "branch", children });

test("chords take slots in order and the rest are reset", () => {
  const plan = plan_slots(root({ "<A-j>": leaf("tab.next"), "<A-k>": leaf("tab.prev") }));
  assert.deepEqual(plan.assignments.map((a) => [a.slot_name, a.shortcut]), [["slot_1", "Alt+J"], ["slot_2", "Alt+K"]]);
  assert.equal(plan.unused_slot_names.length, 8);
  assert.deepEqual(slot_table(plan).slot_2, [{ id: "tab.prev" }]);
});

test("more than the slot count warns and drops the extras", () => {
  const children: Record<string, TreeNode> = {};
  for (const key of "abcdefghijkl") children[`<A-${key}>`] = leaf("x.y");
  const plan = plan_slots(root(children));
  assert.equal(plan.assignments.length, 10);
  assert.match(plan.warnings.join("\n"), /2 chord\(s\) skipped/);
});

test("sequences and bare keys warn", () => {
  const plan = plan_slots(root({ g: { kind: "branch", children: { a: leaf("x.y") } }, j: leaf("x.y") }));
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.warnings.length, 2);
});

test("no browser section resets every slot", () => {
  assert.equal(plan_slots(undefined).unused_slot_names.length, 10);
});

test("apply updates used slots, resets the rest and reports refusals", async () => {
  const calls: string[] = [];
  const plan = plan_slots(root({ "<A-j>": leaf("a.b"), "<A-k>": leaf("a.b") }), 3);
  const { warnings } = await apply_slot_plan(plan, {
    update: async ({ name, shortcut }) => {
      calls.push(`update ${name} ${shortcut}`);
      if (shortcut === "Alt+K") throw new Error("taken");
    },
    reset: async (name) => void calls.push(`reset ${name}`),
  });
  assert.deepEqual(calls, ["reset slot_3", "update slot_1 Alt+J", "update slot_2 Alt+K", "reset slot_2"]);
  assert.equal(warnings.length, 1);
});

test("a refused slot is reset and left out of the slot table", async () => {
  const plan = plan_slots(root({ "<A-j>": leaf("a.b"), "<A-k>": leaf("c.d") }), 3);
  const reset: string[] = [];
  const { applied } = await apply_slot_plan(plan, {
    update: async ({ shortcut }) => {
      if (shortcut === "Alt+K") throw new Error("taken");
    },
    reset: async (name) => void reset.push(name),
  });
  assert.ok(reset.includes("slot_2"));
  assert.deepEqual(Object.keys(slot_table({ ...plan, assignments: applied })), ["slot_1"]);
});

test("release resets every slot, assigned or not, and survives a refusal", async () => {
  const plan = plan_slots(root({ "<A-j>": leaf("a.b") }), 3);
  const reset: string[] = [];
  await release_slots(plan, {
    reset: async (name) => {
      reset.push(name);
      if (name === "slot_1") throw new Error("gone");
    },
  });
  assert.deepEqual(reset, ["slot_1", "slot_2", "slot_3"]);
});

const chords = (keys: string[]): TreeBranch => root(Object.fromEntries(keys.map((key) => [key, leaf("x.y")])));
const slot_of = (plan: ReturnType<typeof plan_slots>) => Object.fromEntries(plan.assignments.map((a) => [a.shortcut, a.slot_name]));

test("migration: with no stored map the chords take the slots the keymap order gave them", () => {
  const plan = plan_slots(chords(["<A-a>", "<A-b>", "<A-c>"]));
  assert.deepEqual(plan.map, { "<A-a>": "slot_1", "<A-b>": "slot_2", "<A-c>": "slot_3" });
  // The map the first run stores gives the same plan back.
  assert.deepEqual(slot_of(plan_slots(chords(["<A-a>", "<A-b>", "<A-c>"]), 10, plan.map)), slot_of(plan));
});

test("removing a chord frees its slot and no later chord shifts", () => {
  const first = plan_slots(chords(["<A-a>", "<A-b>", "<A-c>"]));
  const after = plan_slots(chords(["<A-a>", "<A-c>"]), 10, first.map);
  assert.deepEqual(after.map, { "<A-a>": "slot_1", "<A-c>": "slot_3" });
  assert.ok(after.unused_slot_names.includes("slot_2"));
});

test("a new chord takes the first free slot, even ahead of an older chord in the tree", () => {
  const first = plan_slots(chords(["<A-a>", "<A-b>", "<A-c>"]));
  const without_b = plan_slots(chords(["<A-a>", "<A-c>"]), 10, first.map);
  // `<A-d>` sorts first in the tree and still lands in the freed slot_2, and `<A-c>` stays on slot_3.
  const added = plan_slots(chords(["<A-d>", "<A-a>", "<A-c>"]), 10, without_b.map);
  assert.deepEqual(added.map, { "<A-d>": "slot_2", "<A-a>": "slot_1", "<A-c>": "slot_3" });
});

test("a full set keeps its chords and refuses the new one, whatever its place in the tree", () => {
  const keys = "abcdefghij".split("").map((key) => `<A-${key}>`);
  const full = plan_slots(chords(keys));
  const plan = plan_slots(chords(["<A-z>", ...keys]), 10, full.map);
  assert.deepEqual(plan.map, full.map);
  assert.match(plan.warnings.join("\n"), /1 chord\(s\) skipped/);
});

test("a damaged map keeps only its sound entries", () => {
  const plan = plan_slots(chords(["<A-a>", "<A-b>", "<A-c>"]), 10, { "<A-a>": "slot_2", "<A-b>": "slot_2", "<A-c>": "slot_99", "<A-gone>": "slot_1" });
  assert.deepEqual(plan.map, { "<A-a>": "slot_2", "<A-b>": "slot_1", "<A-c>": "slot_3" });
  assert.deepEqual(plan_slots(chords(["<A-a>"]), 10, "junk" as never).map, { "<A-a>": "slot_1" });
});

type Startup = typeof import("../../src/background/startup.ts");
async function started(tag: string, files: Files = { "settings.toml": "" }) {
  const browser = install_fake_browser({ files });
  const startup = (await import(`../../src/background/startup.ts?slots_${tag}`)) as Startup;
  await startup.get_config();
  return { startup, ...browser };
}
const set_browser = (startup: Startup, browser_edits: Record<string, string>) => startup.change_layers("keymap", (current) => ({ ...current, browser: browser_edits }));

const DEFAULTS = { "<A-j>": "slot_1", "<A-k>": "slot_2", "<A-,>": "slot_3" };

test("the first publish stores the map the old order gave, and saves race on nothing", async () => {
  const { startup, local } = await started("race");
  assert.deepEqual(local[SLOT_MAP_STORAGE_KEY], DEFAULTS);
  // Two saves started together: the second reads the map the first stored.
  await Promise.all([set_browser(startup, { "<A-x>": "tab.close" }), set_browser(startup, { "<A-x>": "tab.close", "<A-y>": "tab.next" })]);
  assert.deepEqual(local[SLOT_MAP_STORAGE_KEY], { ...DEFAULTS, "<A-x>": "slot_4", "<A-y>": "slot_5" });
  // Removing a default frees slot_1, and the next chord takes it.
  await set_browser(startup, { "<A-j>": "", "<A-y>": "tab.next" });
  assert.deepEqual(local[SLOT_MAP_STORAGE_KEY], { "<A-k>": "slot_2", "<A-,>": "slot_3", "<A-y>": "slot_5" });
  await set_browser(startup, { "<A-j>": "", "<A-y>": "tab.next", "<A-z>": "tab.close" });
  assert.deepEqual(local[SLOT_MAP_STORAGE_KEY], { "<A-k>": "slot_2", "<A-,>": "slot_3", "<A-y>": "slot_5", "<A-z>": "slot_1" });
});

test("a failed publish puts the stored map back with the layers", async () => {
  const { startup, local, fake } = await started("rollback");
  await set_browser(startup, { "<A-x>": "tab.close", "<A-y>": "tab.next" });
  const before = structuredClone(local[SLOT_MAP_STORAGE_KEY]);
  const working = fake.tabs.query;
  fake.tabs.query = async () => {
    throw new Error("tabs down");
  };
  await assert.rejects(set_browser(startup, { "<A-y>": "tab.next", "<A-w>": "tab.close" }), /tabs down/);
  fake.tabs.query = working;
  assert.deepEqual(local[SLOT_MAP_STORAGE_KEY], before);
  // The next save plans from the restored map: the failed save's chord left no slot taken.
  await set_browser(startup, { "<A-x>": "tab.close", "<A-y>": "tab.next", "<A-v>": "tab.close" });
  assert.deepEqual(local[SLOT_MAP_STORAGE_KEY], { ...DEFAULTS, "<A-x>": "slot_4", "<A-y>": "slot_5", "<A-v>": "slot_6" });
});
