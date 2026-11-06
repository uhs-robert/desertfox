// The keys the default keymap does not bind: `later` ones waiting for a phase and `dropped` ones that will not be built.

import { parse } from "smol-toml";
import type { KeymapConfig, KeymapMode } from "../../src/shared/keymap.ts";
import { parse_sequence } from "../../src/shared/keys/index.ts";

export const MODE_ORDER: readonly KeymapMode[] = ["normal", "hint", "cmdline", "caret", "visual", "visual_line", "insert", "ignore", "browser"];

export const PLANNED_STATUSES = ["later", "dropped"] as const;

export type PlannedRow = {
  mode: KeymapMode;
  key: string;
  status: (typeof PLANNED_STATUSES)[number];
  // Free text: the command the key would run, which usually does not exist yet.
  command: string;
  note: string;
};

// Throws on the first row that breaks a rule, naming the row.
export function read_planned(toml_text: string, keymap: KeymapConfig): PlannedRow[] {
  const raw_rows = (parse(toml_text) as { row?: Record<string, unknown>[] }).row ?? [];
  const seen = new Set<string>();
  return raw_rows.map((raw, index) => {
    const where = `keymap_planned.toml row ${index + 1} (${String(raw.mode)} ${String(raw.key)})`;
    const { mode, key, status, command = "", note = "" } = raw;
    if (!MODE_ORDER.includes(mode as KeymapMode)) throw new Error(`${where}: unknown mode`);
    if (typeof key !== "string" || key === "") throw new Error(`${where}: key must be a non-empty string`);
    if (!PLANNED_STATUSES.includes(status as PlannedRow["status"])) throw new Error(`${where}: status must be ${PLANNED_STATUSES.join(" or ")}`);
    if (typeof command !== "string" || typeof note !== "string") throw new Error(`${where}: command and note must be strings`);
    const parsed = parse_sequence(key);
    if (parsed.error !== undefined) throw new Error(`${where}: unparsable key, ${parsed.error}`);
    if (keymap[mode as KeymapMode]?.[key]) throw new Error(`${where}: the default keymap already binds this key`);
    const id = `${mode} ${key}`;
    if (seen.has(id)) throw new Error(`${where}: duplicate row`);
    seen.add(id);
    return { mode: mode as KeymapMode, key, status: status as PlannedRow["status"], command, note };
  });
}
