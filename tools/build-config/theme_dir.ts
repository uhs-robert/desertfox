// Reads a folder of theme files from disk and hands them to the parser in `src/shared/config_build`.
// The repo `themes/` goes through here; the user's themes arrive inside the config file map.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse_theme_files } from "../../src/shared/config_build/theme_dir.ts";
import type { Theme } from "../../src/shared/theme/roles.ts";

export function read_theme_dir(dir: string, problems: string[], ignore: string[] = []): Record<string, Theme> {
  if (!existsSync(dir)) return {};
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir).filter((entry) => !entry.startsWith(".") && !ignore.includes(entry))) {
    const path = join(dir, name);
    if (statSync(path).isFile()) files[name] = name.endsWith(".toml") ? readFileSync(path, "utf8") : "";
    else files[`${name}/`] = "";
  }
  return parse_theme_files(files, dir, problems, ignore);
}
