// Renders the generated block of docs/keymap.md: a count line and one table per mode.

import { MODES, type CommandDef } from "../../src/shared/command.ts";
import type { BoundInvocation, KeyBinding } from "../../src/shared/invocation.ts";
import type { KeymapConfig, KeymapMode } from "../../src/shared/keymap.ts";
import { print_command } from "../../src/shared/registry/print_command.ts";
import { MODE_ORDER, type PlannedRow } from "./planned.ts";
import { cell, code } from "./splice.ts";

type Lookup = { get(id: string): CommandDef | undefined };

type Row = { key: string; status: "bound" | "later" | "dropped"; command: string; label: string; note: string };

function bound_row(key: string, binding: KeyBinding, registry: Lookup): Row {
  const steps: BoundInvocation[] = [binding].flat();
  const texts = steps.map((step) => {
    const command = registry.get(step.id);
    return command ? print_command(command, step.args ?? {}, { flags: "long" }) : step.id;
  });
  const first = steps[0]!;
  const prompts = steps.some((step) => step.prompt) ? " (prompts)" : "";
  return {
    key,
    status: "bound",
    command: `${code(texts.join(" ; "))}${prompts}`,
    label: first.label ?? registry.get(first.id)?.label ?? "",
    note: "",
  };
}

function planned_row(row: PlannedRow): Row {
  return { key: row.key, status: row.status, command: row.command === "" ? "" : code(row.command), label: "", note: row.note };
}

function rows_of(mode: KeymapMode, keymap: KeymapConfig, registry: Lookup, planned: readonly PlannedRow[]): Row[] {
  const bound = Object.entries(keymap[mode] ?? {}).flatMap(([key, binding]) => (binding ? [bound_row(key, binding, registry)] : []));
  return [...bound, ...planned.filter((row) => row.mode === mode).map(planned_row)];
}

function table(rows: readonly Row[]): string {
  const lines = rows.map((row) => `| ${[code(row.key), row.status, row.command, row.label, row.note].map(cell).join(" | ")} |`);
  return ["| Key | Status | Command | Label | Note |", "| --- | --- | --- | --- | --- |", ...lines].join("\n");
}

function groups_list(group_names: Record<string, string>): string {
  return Object.entries(group_names).map(([prefix, name]) => `- ${code(prefix)}: ${name}`).join("\n");
}

const NOT_MODES = ["group_names", "search_keys", "container_keys"];

export function render(keymap: KeymapConfig, registry: Lookup, planned: readonly PlannedRow[]): string {
  const missing = [...MODES, "browser", ...Object.keys(keymap).filter((name) => !NOT_MODES.includes(name))].filter((mode) => !MODE_ORDER.includes(mode as KeymapMode));
  if (missing.length > 0) throw new Error(`MODE_ORDER in planned.ts lacks the mode ${[...new Set(missing)].join(", ")}`);
  const by_mode = MODE_ORDER.map((mode) => ({ mode, rows: rows_of(mode, keymap, registry, planned) })).filter((entry) => entry.rows.length > 0);
  const count_of = (status: Row["status"]) => by_mode.reduce((sum, { rows }) => sum + rows.filter((row) => row.status === status).length, 0);
  const per_mode = by_mode.map(({ mode, rows }) => `${mode} ${rows.filter((row) => row.status === "bound").length}`).join(", ");
  const sections = by_mode.map(({ mode, rows }) => {
    const groups = mode === "normal" && keymap.group_names ? `\n\nWhich-key group names:\n\n${groups_list(keymap.group_names)}` : "";
    return `### ${mode}\n\n${table(rows)}${groups}`;
  });
  const counts = `bound: ${count_of("bound")} (${per_mode}) | later: ${count_of("later")} | dropped: ${count_of("dropped")}`;
  return [counts, ...sections].join("\n\n");
}
