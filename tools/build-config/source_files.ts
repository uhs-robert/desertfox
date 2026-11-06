// Reads the config directory from disk into the raw file map that `src/shared/config_build` parses.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_DIRS, KNOWN_FILES, type ConfigFiles } from "../../src/shared/config_build/source_files.ts";

function visible_entries(dir: string): string[] {
  return readdirSync(dir).filter((name) => !name.startsWith(".")).sort();
}

// A directory entry is recorded as `<path>/` with empty text, which the parser reports as unknown.
// Only files in a known place are read. A known file name that is a directory gets the marker too. An unknown top-level file gets empty text, since only its name matters.
export function read_config_files(config_dir: string): ConfigFiles {
  const files: ConfigFiles = {};
  for (const name of visible_entries(config_dir)) {
    const path = join(config_dir, name);
    if (!statSync(path).isDirectory()) {
      files[name] = KNOWN_FILES.has(name) ? readFileSync(path, "utf8") : "";
    } else if (!KNOWN_DIRS.has(name)) {
      files[`${name}/`] = "";
    } else {
      for (const entry of visible_entries(path)) {
        const entry_path = join(path, entry);
        if (statSync(entry_path).isFile()) files[`${name}/${entry}`] = readFileSync(entry_path, "utf8");
        else files[`${name}/${entry}/`] = "";
      }
    }
  }
  return files;
}

export function config_dir_exists(config_dir: string): boolean {
  return existsSync(config_dir) && statSync(config_dir).isDirectory();
}
