// Renders the generated block of docs/keymap.md: a count line and one table per mode.

import { MODES, type CommandDef } from "../../src/shared/command.ts";
import type { BoundInvocation, KeyBinding } from "../../src/shared/invocation.ts";
import type { KeymapConfig, KeymapMode } from "../../src/shared/keymap.ts";
import { print_command } from "../../src/shared/registry/print_command.ts";
import { cell, code } from "./splice.ts";

const MODE_ORDER: readonly KeymapMode[] = ["normal", "media", "item", "item_visual", "grab", "hint", "cmdline", "caret", "visual", "visual_line", "insert", "ignore", "browser"];

type Lookup = { get(id: string): CommandDef | undefined };

type Row = { key: string; command: string; label: string };

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
    command: `${code(texts.join(" ; "))}${prompts}`,
    label: first.label ?? registry.get(first.id)?.label ?? "",
  };
}

function rows_of(mode: KeymapMode, keymap: KeymapConfig, registry: Lookup): Row[] {
  return Object.entries(keymap[mode] ?? {}).flatMap(([key, binding]) => (binding ? [bound_row(key, binding, registry)] : []));
}

function table(rows: readonly Row[]): string {
  const lines = rows.map((row) => `| ${[code(row.key), row.command, row.label].map(cell).join(" | ")} |`);
  return ["| Key | Command | Label |", "| --- | --- | --- |", ...lines].join("\n");
}

function groups_list(group_names: Record<string, string>): string {
  return Object.entries(group_names).map(([prefix, name]) => `- ${code(prefix)}: ${name}`).join("\n");
}

const NOT_MODES = ["group_names", "search_keys", "container_keys", "site_keys", "modifiers", "mode_parents"];

// One line for the keys a child mode takes from its parent: listing them would repeat the parent's table.
function parent_line(mode: KeymapMode, keymap: KeymapConfig): string {
  const link = keymap.mode_parents?.[mode];
  if (!link) return "";
  const runs = link.leave ? `switches to ${link.parent} mode first and then runs as there` : `runs as in ${link.parent} mode`;
  return `\n\nEvery key of ${link.parent} mode that this table does not bind also works here: it ${runs}. A key of ${link.parent} mode comes here only when each command of the key runs in ${link.leave ? link.parent : mode} mode.`;
}

export function render(keymap: KeymapConfig, registry: Lookup): string {
  const missing = [...MODES, "browser", ...Object.keys(keymap).filter((name) => !NOT_MODES.includes(name))].filter((mode) => !MODE_ORDER.includes(mode as KeymapMode));
  if (missing.length > 0) throw new Error(`MODE_ORDER in render.ts lacks the mode ${[...new Set(missing)].join(", ")}`);
  const by_mode = MODE_ORDER.map((mode) => ({ mode, rows: rows_of(mode, keymap, registry) })).filter((entry) => entry.rows.length > 0);
  const per_mode = by_mode.map(({ mode, rows }) => `${mode} ${rows.length}`).join(", ");
  const sections = by_mode.map(({ mode, rows }) => {
    const groups = mode === "normal" && keymap.group_names ? `\n\nWhich-key group names:\n\n${groups_list(keymap.group_names)}` : "";
    return `### ${mode}\n\n${table(rows)}${parent_line(mode, keymap)}${groups}`;
  });
  const counts = `bound: ${by_mode.reduce((sum, { rows }) => sum + rows.length, 0)} (${per_mode})`;
  return [counts, ...sections].join("\n\n");
}
