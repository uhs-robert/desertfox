// usage: node tools/build-config/cli.ts [config_dir] [--commands <commands.json>] [--schemas <dir>]
// Lint only: builds the config in memory and reports problems. Firefox never reads its output.

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build_config, read_commands_file } from "./build_config.ts";
import { ConfigErrors } from "../../src/shared/config_build/errors.ts";
import { write_schemas } from "./output.ts";
import { build_schemas } from "../../src/shared/config_build/schemas.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    commands: { type: "string", default: join(import.meta.dirname, "..", "..", "dist", "commands.json") },
    schemas: { type: "string" },
  },
});

const config_dir = resolve(positionals[0] ?? join(homedir(), ".config", "desertfox"));

try {
  const commands = read_commands_file(values.commands);
  if (values.schemas) write_schemas(values.schemas, build_schemas(commands));
  const warnings: string[] = [];
  build_config(config_dir, commands, warnings);
  for (const warning of warnings) console.error(`warning: ${warning}`);
  console.log(`checked ${config_dir}${values.schemas ? ` and wrote schemas in ${values.schemas}` : ""}`);
} catch (error) {
  if (!(error instanceof ConfigErrors)) throw error;
  console.error(error.message);
  process.exit(1);
}
