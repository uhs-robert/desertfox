// Assigns `browser` mode chords to the manifest's Firefox shortcut slots.

import type { BoundInvocation } from "../shared/invocation.ts";
import type { TreeBranch } from "../shared/prefix_tree.ts";
import { to_firefox_shortcut } from "../shared/keys/firefox_shortcut.ts";
import { ignore_refusal } from "../shared/swallow.ts";

export const SLOT_COUNT = 10;

export function slot_name(index: number): string {
  return `slot_${index + 1}`;
}

export type SlotAssignment = { slot_name: string; shortcut: string; invocations: BoundInvocation[] };

// The chord (as the keymap spells it) to the slot it holds. A chord keeps its slot until its binding goes, so an edit elsewhere never moves it.
export type SlotMap = Record<string, string>;

export const SLOT_MAP_STORAGE_KEY = "desertfox_slot_map";

export type SlotPlan = {
  assignments: SlotAssignment[];
  unused_slot_names: string[];
  warnings: string[];
  // What to store for the next plan: the slot of every assigned chord.
  map: SlotMap;
};

// A stored map that is not the expected shape, or names a slot twice or a slot that does not exist, keeps only its sound entries.
export function sound_slot_map(stored: unknown, slot_count = SLOT_COUNT): SlotMap {
  const map: SlotMap = {};
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return map;
  const taken = new Set<string>();
  const valid = new Set(Array.from({ length: slot_count }, (_, index) => slot_name(index)));
  for (const [chord, slot] of Object.entries(stored)) {
    if (typeof slot !== "string" || !valid.has(slot) || taken.has(slot)) continue;
    taken.add(slot);
    map[chord] = slot;
  }
  return map;
}

// A chord already in `previous` keeps its slot, and a new one takes the first free slot, so no chord moves when another is added or removed.
// With an empty `previous` the chords fill the slots in keymap order, which is the assignment the first release made: that is the migration.
export function plan_slots(browser_root: TreeBranch | undefined, slot_count = SLOT_COUNT, previous: SlotMap = {}): SlotPlan {
  const warnings: string[] = [];
  const chords: { token: string; shortcut: string; invocations: BoundInvocation[] }[] = [];

  for (const [token, node] of Object.entries(browser_root?.children ?? {})) {
    if (node.kind === "branch") {
      warnings.push(`browser: skipped "${token}...": a shortcut is one chord, not a sequence`);
      continue;
    }
    const converted = to_firefox_shortcut(token);
    if (converted.error !== undefined) {
      warnings.push(`browser: skipped "${token}": ${converted.error}`);
      continue;
    }
    chords.push({ token, shortcut: converted.shortcut, invocations: node.steps.map((step) => step.invocation) });
  }

  const remembered = sound_slot_map(previous, slot_count);
  const slot_of = new Map<string, string>();
  const taken = new Set<string>();
  for (const { token } of chords) {
    const slot = remembered[token];
    if (slot !== undefined) {
      slot_of.set(token, slot);
      taken.add(slot);
    }
  }
  let skipped_for_room = 0;
  for (const { token } of chords) {
    if (slot_of.has(token)) continue;
    const free = Array.from({ length: slot_count }, (_, index) => slot_name(index)).find((name) => !taken.has(name));
    if (free === undefined) {
      skipped_for_room++;
      continue;
    }
    slot_of.set(token, free);
    taken.add(free);
  }
  if (skipped_for_room > 0) {
    warnings.push(`browser: ${skipped_for_room} chord(s) skipped, only ${slot_count} Firefox shortcut slots exist`);
  }

  const assignments: SlotAssignment[] = chords
    .filter(({ token }) => slot_of.has(token))
    .map(({ token, shortcut, invocations }) => ({ slot_name: slot_of.get(token)!, shortcut, invocations }))
    .sort((a, b) => slot_index(a.slot_name) - slot_index(b.slot_name));
  const map: SlotMap = Object.fromEntries(chords.filter(({ token }) => slot_of.has(token)).map(({ token }) => [token, slot_of.get(token)!]));
  const used = new Set(assignments.map((assignment) => assignment.slot_name));
  const unused_slot_names = Array.from({ length: slot_count }, (_, index) => slot_name(index)).filter((name) => !used.has(name));
  return { assignments, unused_slot_names, warnings, map };
}

const slot_index = (name: string): number => Number(name.slice("slot_".length));

export async function read_slot_map(): Promise<SlotMap> {
  return sound_slot_map((await browser.storage.local.get(SLOT_MAP_STORAGE_KEY))[SLOT_MAP_STORAGE_KEY]);
}

export async function store_slot_map(map: SlotMap): Promise<void> {
  await browser.storage.local.set({ [SLOT_MAP_STORAGE_KEY]: map });
}

export type SlotTable = Record<string, BoundInvocation[]>;

export function slot_table(plan: SlotPlan): SlotTable {
  return Object.fromEntries(plan.assignments.map((assignment) => [assignment.slot_name, assignment.invocations]));
}

// Returns a warning per slot Firefox refused (another extension or Firefox itself owns the chord)
// and the assignments that took effect. A refused slot is reset, because it still holds its old chord.
export async function apply_slot_plan(
  plan: SlotPlan,
  commands: Pick<typeof browser.commands, "update" | "reset">,
): Promise<{ warnings: string[]; applied: SlotAssignment[] }> {
  const warnings: string[] = [];
  const applied: SlotAssignment[] = [];
  for (const name of plan.unused_slot_names) {
    await ignore_refusal(commands.reset(name));
  }
  for (const assignment of plan.assignments) {
    try {
      await commands.update({ name: assignment.slot_name, shortcut: assignment.shortcut });
      applied.push(assignment);
    } catch (error) {
      warnings.push(`browser: Firefox refused "${assignment.shortcut}": ${String(error)}`);
      await ignore_refusal(commands.reset(assignment.slot_name));
    }
  }
  return { warnings, applied };
}

// Frees every slot chord, so Firefox stops taking them from the page.
export async function release_slots(plan: SlotPlan, commands: Pick<typeof browser.commands, "reset">): Promise<void> {
  for (const name of [...plan.assignments.map((assignment) => assignment.slot_name), ...plan.unused_slot_names]) await ignore_refusal(commands.reset(name));
}
