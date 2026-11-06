// Writes files so a reader never sees a half-written one: write beside, then rename.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MergedConfig, SearchEngine } from "../../src/shared/config.ts";
import type { DataKind } from "./source_files.ts";

export const EXTENSION_ID = "desertfox@uhs-robert";

// The file Firefox reads. Only the CLI's --live flag may target it.
export function live_managed_storage_path(): string {
  return join(homedir(), ".mozilla", "managed-storage", `${EXTENSION_ID}.json`);
}

export function managed_storage_document(config: MergedConfig) {
  return {
    name: EXTENSION_ID,
    description: "DesertFox user config merged by tools/build-config",
    type: "storage",
    data: config,
  };
}

export function write_atomically(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const temp_path = `${path}.${process.pid}.tmp`;
  writeFileSync(temp_path, text);
  renameSync(temp_path, path);
}

export function write_managed_storage(path: string, config: MergedConfig) {
  write_atomically(path, `${JSON.stringify(managed_storage_document(config), null, 2)}\n`);
}

export function write_schemas(dir: string, schemas: Record<DataKind, unknown>) {
  for (const [kind, schema] of Object.entries(schemas)) {
    write_atomically(join(dir, `${kind}.schema.json`), `${JSON.stringify(schema, null, 2)}\n`);
  }
}

// One engine per line, sorted by name, so a config change shows as a plain diff.
export function resolved_engines_text(engines: Record<string, SearchEngine>): string {
  return Object.keys(engines)
    .sort()
    .map((name) => `${JSON.stringify({ name, ...engines[name] })}\n`)
    .join("");
}

export function write_resolved_engines(path: string, engines: Record<string, SearchEngine>) {
  write_atomically(path, resolved_engines_text(engines));
}
