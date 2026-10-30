// usage: node tools/build-config/cli.ts [config_dir] [--commands <commands.json>] [--out <file>] [--schemas <dir>]

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build_config, read_commands_file } from "./build_config.ts";
import { ConfigErrors } from "./errors.ts";
import { EXTENSION_ID, write_managed_storage, write_schemas } from "./output.ts";
import { build_schemas } from "./schemas.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    commands: { type: "string", default: join(import.meta.dirname, "..", "..", "dist", "commands.json") },
    out: { type: "string", default: join(homedir(), ".mozilla", "managed-storage", `${EXTENSION_ID}.json`) },
    schemas: { type: "string" },
  },
});

const config_dir = resolve(positionals[0] ?? join(homedir(), ".config", "oasisfox"));

try {
  const commands = read_commands_file(values.commands);
  if (values.schemas) write_schemas(values.schemas, build_schemas(commands));
  write_managed_storage(values.out, build_config(config_dir, commands));
  console.log(`wrote ${values.out}${values.schemas ? ` and schemas in ${values.schemas}` : ""}`);
} catch (error) {
  if (!(error instanceof ConfigErrors)) throw error;
  console.error(error.message);
  process.exit(1);
}
