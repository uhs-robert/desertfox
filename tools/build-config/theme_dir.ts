// Reads a folder of theme files, one theme per `<name>.toml`. The repo `themes/` and the
// user's `<config dir>/themes/` both go through here.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { check_theme_file } from "../../src/shared/theme/theme_file.ts";
import type { Theme } from "../../src/shared/theme/roles.ts";
import { parse_toml_file } from "./source_files.ts";

// `ignore` names entries that live in the folder but are not theme files: the repo `themes/` holds a README and the `oasis/` CSS copies.
export function read_theme_dir(dir: string, problems: string[], ignore: string[] = []): Record<string, Theme> {
  const themes: Record<string, Theme> = {};
  if (!existsSync(dir)) return themes;
  for (const name of readdirSync(dir).filter((entry) => !entry.startsWith(".") && !ignore.includes(entry)).sort()) {
    const path = join(dir, name);
    if (!name.endsWith(".toml") || !statSync(path).isFile()) {
      problems.push(`${path}: unknown file, only .toml theme files belong in themes`);
      continue;
    }
    const data = parse_toml_file(path, problems);
    const theme = data && check_theme_file(path, data, problems);
    if (theme) themes[name.slice(0, -".toml".length)] = theme;
  }
  return themes;
}
