// Writes files so a reader never sees a half-written one: write beside, then rename.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DataKind } from "../../src/shared/config_build/source_files.ts";

export function write_atomically(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const temp_path = `${path}.${process.pid}.tmp`;
  writeFileSync(temp_path, text);
  renameSync(temp_path, path);
}

export function write_schemas(dir: string, schemas: Record<DataKind, unknown>) {
  for (const [kind, schema] of Object.entries(schemas)) {
    write_atomically(join(dir, `${kind}.schema.json`), `${JSON.stringify(schema, null, 2)}\n`);
  }
}
