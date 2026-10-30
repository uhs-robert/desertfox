// Writes files so a reader never sees a half-written one: write beside, then rename.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MergedConfig } from "../../src/shared/config.ts";
import type { DataKind } from "./source_files.ts";

export const EXTENSION_ID = "oasisfox@uhs-robert";

export function managed_storage_document(config: MergedConfig) {
  return {
    name: EXTENSION_ID,
    description: "OasisFox user config merged by tools/build-config",
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
