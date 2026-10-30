// Assigns `browser` mode chords to the manifest's Firefox shortcut slots.

import type { BoundInvocation } from "../shared/invocation.ts";
import type { TreeBranch } from "../shared/prefix_tree.ts";
import { to_firefox_shortcut } from "../shared/keys/firefox_shortcut.ts";

export const SLOT_COUNT = 10;

export function slot_name(index: number): string {
  return `slot_${index + 1}`;
}

export type SlotAssignment = { slot_name: string; shortcut: string; invocations: BoundInvocation[] };

export type SlotPlan = {
  assignments: SlotAssignment[];
  unused_slot_names: string[];
  warnings: string[];
};

export function plan_slots(browser_root: TreeBranch | undefined, slot_count = SLOT_COUNT): SlotPlan {
  const assignments: SlotAssignment[] = [];
  const warnings: string[] = [];
  let skipped_for_room = 0;

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
    if (assignments.length >= slot_count) {
      skipped_for_room++;
      continue;
    }
    assignments.push({
      slot_name: slot_name(assignments.length),
      shortcut: converted.shortcut,
      invocations: node.steps.map((step) => step.invocation),
    });
  }
  if (skipped_for_room > 0) {
    warnings.push(`browser: ${skipped_for_room} chord(s) skipped, only ${slot_count} Firefox shortcut slots exist`);
  }

  const used = new Set(assignments.map((assignment) => assignment.slot_name));
  const unused_slot_names = Array.from({ length: slot_count }, (_, index) => slot_name(index)).filter((name) => !used.has(name));
  return { assignments, unused_slot_names, warnings };
}

export type SlotTable = Record<string, BoundInvocation[]>;

export function slot_table(plan: SlotPlan): SlotTable {
  return Object.fromEntries(plan.assignments.map((assignment) => [assignment.slot_name, assignment.invocations]));
}

// Returns a warning per slot Firefox refused (another extension or Firefox itself owns the chord).
export async function apply_slot_plan(
  plan: SlotPlan,
  commands: Pick<typeof browser.commands, "update" | "reset">,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const name of plan.unused_slot_names) {
    await commands.reset(name).catch(() => undefined);
  }
  for (const assignment of plan.assignments) {
    await commands.update({ name: assignment.slot_name, shortcut: assignment.shortcut }).catch((error: unknown) => {
      warnings.push(`browser: Firefox refused "${assignment.shortcut}": ${String(error)}`);
    });
  }
  return warnings;
}
