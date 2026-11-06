// Parses a folder of theme files, one theme per `<name>.toml`. The repo `themes/` and the
// user's `<config dir>/themes/` both go through here. `files` maps entry names in the folder
// to their text, with the directory-entry convention of `source_files.ts`.

import { check_theme_file } from "../theme/theme_file.ts";
import type { Theme } from "../theme/roles.ts";
import { entry_names, labeled_path, parse_toml_text, type ConfigFiles } from "./source_files.ts";

// `dir_label` is the folder as the user knows it, the prefix of every path in a problem message.
// `ignore` names entries that live in the folder but are not theme files: the repo `themes/` holds a README and the `oasis/` CSS copies.
export function parse_theme_files(files: ConfigFiles, dir_label: string, problems: string[], ignore: string[] = []): Record<string, Theme> {
  const themes: Record<string, Theme> = {};
  for (const name of entry_names(files, "").filter((entry) => !ignore.includes(entry))) {
    const path = labeled_path(dir_label, name);
    if (!name.endsWith(".toml") || !Object.hasOwn(files, name)) {
      problems.push(`${path}: unknown file, only .toml theme files belong in themes`);
      continue;
    }
    const data = parse_toml_text(path, files[name]!, problems);
    const theme = data && check_theme_file(path, data, problems);
    if (theme) themes[name.slice(0, -".toml".length)] = theme;
  }
  return themes;
}
