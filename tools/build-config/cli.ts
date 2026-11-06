// usage: node tools/build-config/cli.ts [config_dir] [--commands <commands.json>] (--out <file> | --live) [--schemas <dir>]

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build_config, read_commands_file } from "./build_config.ts";
import { ConfigErrors } from "./errors.ts";
import { live_managed_storage_path, write_managed_storage, write_resolved_engines, write_schemas } from "./output.ts";
import { build_schemas } from "./schemas.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    commands: { type: "string", default: join(import.meta.dirname, "..", "..", "dist", "commands.json") },
    out: { type: "string" },
    live: { type: "boolean", default: false },
    schemas: { type: "string" },
  },
});

// No default output: a bare run must never reach the live config.
if (values.live === (values.out !== undefined)) {
  console.error("usage: node tools/build-config/cli.ts [config_dir] (--out <file> | --live) [--commands <file>] [--schemas <dir>]");
  console.error("pass exactly one of --out or --live. --live writes the config Firefox reads.");
  process.exit(2);
}
const out_path = values.live ? live_managed_storage_path() : values.out!;

const config_dir = resolve(positionals[0] ?? join(homedir(), ".config", "desertfox"));

try {
  const commands = read_commands_file(values.commands);
  if (values.schemas) write_schemas(values.schemas, build_schemas(commands));
  const warnings: string[] = [];
  const config = build_config(config_dir, commands, warnings);
  for (const warning of warnings) console.error(`warning: ${warning}`);
  write_managed_storage(out_path, config);
  write_resolved_engines(out_path.replace(/\.json$/, "") + ".engines.jsonl", config.search_engines);
  console.log(`wrote ${out_path}${values.schemas ? ` and schemas in ${values.schemas}` : ""}`);
} catch (error) {
  if (!(error instanceof ConfigErrors)) throw error;
  console.error(error.message);
  process.exit(1);
}
