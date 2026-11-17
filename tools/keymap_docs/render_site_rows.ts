// Renders the generated block of docs/site_rows.md: one section per shipped site row name, with its address patterns and the keys it gives.

import type { CommandDef } from "../../src/shared/command.ts";
import type { DefaultSiteRow } from "../../src/background/default_site_rows.ts";
import type { BindingTable, SiteModeTable } from "../../src/shared/settings_table.ts";
import type { BoundInvocation } from "../../src/shared/invocation.ts";
import type { KeymapConfig } from "../../src/shared/keymap.ts";
import { cell, code } from "./splice.ts";

type Lookup = { get(id: string): CommandDef | undefined };

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// One step in plain words. A step's own `intent` wins, then a phrase for each command the rows use, then the command label with its enum choices.
function describe_step(step: BoundInvocation, command: CommandDef | undefined): string {
  const args = step.args ?? {};
  if (step.intent) return step.intent.replace(/\.$/, "");
  if (step.id === "page.send_key") return `Press ${args.ctrl ? "Ctrl+" : ""}${args.shift ? "Shift+" : ""}${String(args.key)} in the page`;
  if (step.id === "page.clipboard") return `${capitalized(String(args.action))} in the page`;
  if (step.id === "page.arrow") return `Press the ${String(args.direction)} arrow on the focused control`;
  if (step.id === "mode.site") return args.name === "off" ? "End the mode" : `Start the ${String(args.name)} mode`;
  const choices = (command?.params ?? []).flatMap((param) => (param.type === "enum" && param.value_labels && typeof args[param.name] === "string" ? [param.value_labels[args[param.name] as string]] : []));
  if (step.id === "page.item") return `Go ${choices.join(" ")}`;
  return [step.label ?? command?.label ?? step.id, ...choices].join(" ");
}

const lower_first_step = (step: BoundInvocation, command: CommandDef | undefined) => {
  const text = describe_step(step, command);
  return text.charAt(0).toLowerCase() + text.slice(1);
};

function describe(binding: BindingTable[string], registry: Lookup): string {
  const steps = [binding].flat() as BoundInvocation[];
  const text = steps.map((step, at) => (at === 0 ? describe_step : lower_first_step)(step, registry.get(step.id))).join(", then ");
  return (steps[0] as BoundInvocation).when_present ? `${text} (the plain key on a page with no item)` : text;
}

function key_table(bind: BindingTable, registry: Lookup): string {
  const lines = Object.entries(bind).flatMap(([key, binding]) => (binding ? [`| ${[code(key), describe(binding, registry)].map(cell).join(" | ")} |`] : []));
  return ["| Key | What it does |", "| --- | --- |", ...lines].join("\n");
}

// Keys that start a site mode: the row's own binds, then the default keymap.
function starter_keys(mode: string, bind: BindingTable | undefined, keymap: KeymapConfig): string[] {
  const starts = (binding: BindingTable[string]) => ([binding].flat() as BoundInvocation[]).some((step) => step.id === "mode.site" && step.args?.name === mode);
  // group_names, modifiers and the other non-mode entries hold strings, so they never hold a binding that starts a mode.
  const keymap_tables = Object.values(keymap).filter((value) => typeof value === "object" && value !== null && !Array.isArray(value)) as BindingTable[];
  const tables = [bind ?? {}, ...keymap_tables];
  return tables.flatMap((table) => Object.entries(table).filter(([, binding]) => binding && starts(binding)).map(([key]) => key));
}

function mode_section(name: string, mode: SiteModeTable[string], row_bind: BindingTable | undefined, keymap: KeymapConfig, registry: Lookup): string {
  const starters = [...new Set(starter_keys(name, row_bind, keymap))];
  const start = starters.length > 0 ? ` Start it with ${starters.map((key) => code(key)).join(" or ")}.` : "";
  return `#### Mode ${mode.label ?? name}\n\n${start.trim()}\n\n${key_table(mode.bind, registry)}`.replace("\n\n\n\n", "\n\n");
}

export function render_site_rows(rows: readonly DefaultSiteRow[], keymap: KeymapConfig, registry: Lookup): string {
  const names = [...new Set(rows.map(({ name }) => name))];
  const sections = names.map((name) => {
    const own = rows.filter((entry) => entry.name === name).map(({ row }) => row);
    const patterns = [...new Set(own.map((row) => row.site))];
    // The rows of one name differ only in their address, so the first row speaks for all.
    const first = own[0]!;
    const parts = [`### ${code(name)}`, `Addresses: ${patterns.map((pattern) => code(pattern)).join(", ")}`];
    if (first.bind && Object.keys(first.bind).length > 0) parts.push(key_table(first.bind, registry));
    if (first.pass) parts.push(`Keys left to the page: ${first.pass.split(" ").map((key) => code(key)).join(" ")}.`);
    for (const [mode_name, mode] of Object.entries(first.modes ?? {})) parts.push(mode_section(mode_name, mode, first.bind, keymap, registry));
    return parts.join("\n\n");
  });
  return [`Shipped rows: ${names.length} (${names.map((name) => code(name)).join(", ")}).`, ...sections].join("\n\n");
}
