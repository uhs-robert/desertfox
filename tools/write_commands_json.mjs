// Writes dist/commands.json from the command registry. Node loads the
// TypeScript sources directly, so the runtime list of command modules loads here without bundling.
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

export async function write_commands_json(out_dir) {
  const root = path.resolve(import.meta.dirname, "..");
  await import(pathToFileURL(path.join(root, "src/background/command_modules.ts")).href);
  const { registry, build_commands_file } = await import(
    pathToFileURL(path.join(root, "src/shared/registry/index.ts")).href
  );
  const commands_file = build_commands_file(registry);
  await mkdir(out_dir, { recursive: true });
  await writeFile(path.join(out_dir, "commands.json"), `${JSON.stringify(commands_file, null, 2)}\n`);
  return commands_file.commands.length;
}
