// The fold of the settings older versions saved in the browser (`desertfox_saved_settings`) into settings.toml.
// Every start runs it (`fold_saved_layer` in `startup.ts`). A saved value beat the file's before, so each one written into settings.toml keeps the setting in force as it was.
// The consent settings stay in the browser by design, and a few others stay because settings.toml cannot carry them yet (`SavedFold`).

import { TomlError } from "smol-toml";
import { RuntimeRefusal } from "../shared/command.ts";
import type { SettingOverrides, Settings } from "../shared/config.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import type { SiteRuleRow } from "../shared/match_pattern.ts";
import { CONSENT_SETTINGS } from "../shared/settings_schema.ts";
import { rows_in_settings_file, settings_d_file_that_hides, settings_d_site_rules, with_setting_in_files } from "./settings_file.ts";
import { is_pass_shaped } from "./site_keys.ts";
import type { TomlValue } from "./toml_key_edit.ts";
import { saved_popup_rows } from "./toolbar.ts";

// What the fold changes. `saved` is what stays in the layer, the same object when nothing moved.
// `moved`: names now in settings.toml, or dropped because the file already said the same. `held`: names a settings.d file sets, which wins over settings.toml, so the saved value stays on top of it.
// `refused`: names whose value the files build refuses in settings.toml, with the first problem. They stay, and the next start tries again.
export type SavedFold = { files: ConfigFiles; saved: SettingOverrides; moved: string[]; held: { name: string; file: string }[]; refused: { name: string; problem: string }[] };

type SettingName = keyof Settings;

const is_consent = (name: string): boolean => (CONSENT_SETTINGS as readonly string[]).includes(name);

// Whether the layer holds anything the fold moves or reports, so a start with only consent settings saved reads no files.
export const has_foldable = (saved: SettingOverrides, stays_in_browser: (name: SettingName) => boolean): boolean => Object.keys(saved).some((name) => !is_consent(name) && !stays_in_browser(name as SettingName));

// `stays_in_browser` names a setting that stays saved with no note, such as a `default_engine` only the old engines layer defines.
// `problems_of` builds files and gives the build's problems, none when they build.
export function saved_layer_folded(saved: SettingOverrides, files: ConfigFiles, problems_of: (files: ConfigFiles) => string[], stays_in_browser: (name: SettingName) => boolean): SavedFold {
  const held: SavedFold["held"] = [];
  const foldable: SettingName[] = [];
  for (const name of Object.keys(saved) as SettingName[]) {
    if (is_consent(name) || stays_in_browser(name)) continue;
    const file = settings_d_file_setting(files, name);
    if (file === undefined) foldable.push(name);
    else held.push({ name, file });
  }
  const together = all_folded(files, saved, foldable, problems_of);
  const refused: SavedFold["refused"] = [];
  let folded = files;
  if (together !== undefined) folded = together;
  else {
    // One name at a time, so one refused value leaves that name and not the whole layer.
    for (const name of foldable) {
      const next = with_saved_value_built(folded, saved, name, problems_of);
      if ("problem" in next) refused.push({ name, problem: next.problem });
      else folded = next.files;
    }
  }
  const moved = foldable.filter((name) => !refused.some((entry) => entry.name === name));
  if (moved.length === 0) return { files, saved, moved, held, refused };
  return { files: folded, saved: Object.fromEntries(Object.entries(saved).filter(([name]) => !(moved as string[]).includes(name))) as SettingOverrides, moved, held, refused };
}

// A settings.d file that does not parse sets nothing the fold can tell. The files build then refuses the write of the name and says why.
function settings_d_file_setting(files: ConfigFiles, name: SettingName): string | undefined {
  try {
    return settings_d_file_that_hides(files, name);
  } catch (error) {
    if (error instanceof TomlError) return undefined;
    throw error;
  }
}

function all_folded(files: ConfigFiles, saved: SettingOverrides, names: SettingName[], problems_of: (files: ConfigFiles) => string[]): ConfigFiles | undefined {
  let folded = files;
  try {
    for (const name of names) folded = with_saved_value(folded, saved, name);
  } catch (error) {
    if (error instanceof RuntimeRefusal || error instanceof TomlError) return undefined;
    throw error;
  }
  return problems_of(folded).length === 0 ? folded : undefined;
}

function with_saved_value_built(files: ConfigFiles, saved: SettingOverrides, name: SettingName, problems_of: (files: ConfigFiles) => string[]): { files: ConfigFiles } | { problem: string } {
  let next: ConfigFiles;
  try {
    next = with_saved_value(files, saved, name);
  } catch (error) {
    if (error instanceof RuntimeRefusal || error instanceof TomlError) return { problem: error.message };
    throw error;
  }
  const problem = problems_of(next)[0];
  return problem === undefined ? { files: next } : { problem };
}

function with_saved_value(files: ConfigFiles, saved: SettingOverrides, name: SettingName): ConfigFiles {
  if (name === "site_rules") return with_saved_site_rules(files, saved.site_rules);
  return with_setting_in_files(files, name, saved[name] as TomlValue);
}

// A saved `site_rules` list is the popup's from before it wrote settings.toml: copies of the file's rows taken at its first write, plus its own rows.
// The files' rows stand for the copies, edits since included, so only the popup's off rows and kept-keys rows go in, as the popup's next write would put them.
// An off row is present when any file has one for the site. A kept-keys row is present only when a file has the same keys for it: other keys in a file are a different rule, so the saved one stays.
// Settings.d rows count too, so rows a user already copied into a settings.d file do not come twice.
function with_saved_site_rules(files: ConfigFiles, saved: readonly SiteRuleRow[] | undefined): ConfigFiles {
  const file_rows = rows_in_settings_file(files, "site_rules") as SiteRuleRow[];
  const present_rows = [...file_rows, ...settings_d_site_rules(files).map(({ row }) => row)];
  const patterns = [...new Set((saved ?? []).map((row) => row.site))];
  const kept_keys_rows = patterns.flatMap((pattern) => (saved ?? []).filter((row) => row.site === pattern && is_pass_shaped(row)).slice(0, 1));
  const same_keys_present = (row: SiteRuleRow) => present_rows.some((present) => is_pass_shaped(present) && present.site === row.site && present.pass === row.pass);
  const added = [...saved_popup_rows(present_rows, saved), ...kept_keys_rows.filter((row) => !same_keys_present(row))];
  return added.length === 0 ? files : with_setting_in_files(files, "site_rules", [...file_rows, ...added] as TomlValue);
}

// The toast and Home notice when the fold moved something. Undefined when it moved nothing.
export function fold_moved_note(fold: SavedFold): string | undefined {
  const count = fold.moved.length;
  if (count === 0) return undefined;
  return `${count === 1 ? "1 setting" : `${count} settings`} saved in the browser moved into settings.toml: ${fold.moved.join(", ")}.`;
}

// The Home warnings for what stays saved: one for every name a settings.d file holds, and one per refused name.
export function fold_kept_notes(fold: SavedFold): string[] {
  const held = fold.held.length === 0 ? [] : [`Settings saved in the browser stay there, as a settings.d file sets them too: ${fold.held.map(({ name, file }) => `${name} (${file})`).join(", ")}. The saved values still win. Change the value in that file, or :unset the setting to drop the saved value.`];
  const refused = fold.refused.map(({ name, problem }) => `The setting ${name} saved in the browser stays there, as the config refuses it in settings.toml: ${problem} Fix that, and the next start moves it.`);
  return [...held, ...refused];
}
