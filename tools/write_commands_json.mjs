// Writes dist/commands.json from the command registry. Node loads the
// TypeScript sources directly, so the command modules need no bundling here.
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

// Modules that call `define` on import. Later waves add the command groups here.
const COMMAND_MODULES = [
  "src/commands/config.ts",
  "src/commands/scroll.ts",
  "src/commands/mode.ts",
  "src/commands/tab.ts",
  "src/commands/window.ts",
  "src/commands/browser.ts",
  "src/commands/zoom.ts",
  "src/commands/bookmark.ts",
];

export async function write_commands_json(out_dir) {
  const root = path.resolve(import.meta.dirname, "..");
  for (const module_path of COMMAND_MODULES) await import(pathToFileURL(path.join(root, module_path)).href);
  const { registry, build_commands_file } = await import(
    pathToFileURL(path.join(root, "src/shared/registry/index.ts")).href
  );
  const commands_file = build_commands_file(registry);
  await mkdir(out_dir, { recursive: true });
  await writeFile(path.join(out_dir, "commands.json"), `${JSON.stringify(commands_file, null, 2)}\n`);
  return commands_file.commands.length;
}
