// The base16 importer's messages: the names of the theme files, and one change of them (save, remove). A change goes through `set_theme_file` in `startup.ts`, which changes `themes/<name>.toml` in the browser copy and through the native host, as a `:set` changes settings.toml.
// Also the move of the imports an older version kept in browser storage into those files, which a start runs once.

import { stringify, TomlError } from "smol-toml";
import type { ChangeImportedThemes, ChangeImportedThemesAnswer, ListImportedThemesAnswer } from "../shared/messages.ts";
import type { SettingOverrides } from "../shared/config.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { parse_base16, theme_name_problem, theme_name_shape_problem } from "../shared/theme/base16.ts";
import { derive_roles } from "../shared/theme/derive.ts";
import type { GivenColors } from "../shared/theme/derive.ts";
import { REQUIRED_ROLES, ROLES } from "../shared/theme/roles.ts";
import type { RoleColors, Theme } from "../shared/theme/roles.ts";
import { local_theme_problem, parse_color } from "../shared/theme/theme_file.ts";
import { failure } from "./config_reload.ts";
import { host_file_of } from "./native_client.ts";
import { outcome_note, SETTINGS_FILE, with_setting_in_files } from "./settings_file.ts";
import type { FileWriteOutcome } from "./settings_file.ts";

const THEME_FILE = /^themes\/([^/]+)\.toml$/;

export const theme_file_path = (name: string): string => `themes/${name}.toml`;

// The names of the theme files in `files`, sorted.
export function theme_file_names(files: ConfigFiles): string[] {
  return Object.keys(files)
    .map((path) => THEME_FILE.exec(path)?.[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

// What `set_theme_file` did. `needs_replace`: a save found a file of that name and was not told to replace it.
// `settings`: a remove also took `theme` out of settings.toml, because it named the theme.
export type ThemeFileChange = { kind: "needs_replace" } | { kind: "changed"; replaced: boolean; file: FileWriteOutcome; settings?: FileWriteOutcome };

export type ThemeMessageDeps = {
  // The browser copy of the config files, read in the change queue.
  read_files: () => Promise<ConfigFiles>;
  // `text` null removes the file.
  set_theme_file: (name: string, text: string | null, replace: boolean) => Promise<ThemeFileChange>;
};

// The end of a remove's reply about the theme file. A delete that reached the folder or only the browser copy saved nothing, so those two read apart from `outcome_note`.
function removal_note(outcome: FileWriteOutcome, path: string): string {
  if (outcome.kind === "written") return `, and ${path} is deleted from the config folder`;
  if (outcome.kind === "browser_copy") return " from the browser copy. It did not come from a config folder, so no file there changes";
  return outcome_note(outcome, path);
}

export function create_theme_messages(deps: ThemeMessageDeps) {
  async function list(): Promise<ListImportedThemesAnswer> {
    try {
      const names = theme_file_names(await deps.read_files());
      const kept_names = names.filter((name) => host_file_of(theme_file_path(name)) === undefined);
      return { ok: true, names: names.filter((name) => !kept_names.includes(name)), ...(kept_names.length > 0 && { kept_names }) };
    } catch (error) {
      return failure(error);
    }
  }

  async function save(name: unknown, text: unknown, replace: boolean): Promise<ChangeImportedThemesAnswer> {
    if (typeof name !== "string" || typeof text !== "string") throw new RuntimeRefusal("Theme not saved: give a name and the scheme text.");
    const name_problem = theme_name_problem(name);
    if (name_problem !== undefined) throw new RuntimeRefusal(`Theme not saved: ${name_problem}`);
    const parsed = parse_base16(text);
    if (!parsed.ok) throw new RuntimeRefusal(`Theme not saved: ${parsed.problem}`);
    const change = await deps.set_theme_file(name, stringify(parsed.scheme.theme), replace);
    if (change.kind === "needs_replace") return { ok: false, needs_replace: true, message: `A theme named ${name} already exists.` };
    return { ok: true, message: `${change.replaced ? "Replaced" : "Saved"} the theme ${name}${outcome_note(change.file, theme_file_path(name))}. Use it with :set theme ${name}.` };
  }

  async function remove(name: string): Promise<string> {
    const change = await deps.set_theme_file(name, null, true);
    if (change.kind !== "changed") throw new RuntimeRefusal(`the theme ${name} was not removed`);
    // The browser-copy note says where both changes went, so the setting's line does not repeat it.
    const setting = change.settings ? ` The theme setting goes back to the default${change.settings.kind === "browser_copy" ? "" : outcome_note(change.settings)}.` : "";
    return `Removed the theme ${name}${removal_note(change.file, theme_file_path(name))}.${setting}`;
  }

  async function change(request: ChangeImportedThemes): Promise<ChangeImportedThemesAnswer> {
    try {
      if (request.action === "save") return await save(request.name, request.text, request.replace === true);
      if (request.action === "remove") return { ok: true, message: await remove(String(request.name)) };
      return { ok: false, message: `unknown action ${JSON.stringify((request as { action: unknown }).action)}` };
    } catch (error) {
      return failure(error);
    }
  }

  return { list, change };
}

const is_record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// A stored table from before `mode_item` and `mode_media` lacks those two, so they derive from the rest. Any other missing role leaves the table for the check to refuse.
const ROLES_ADDED_LATER = ["mode_item", "mode_media"] as const;

function with_derived_roles(theme: unknown): unknown {
  if (!is_record(theme)) return theme;
  const filled: Record<string, unknown> = { ...theme };
  for (const variant of ["dark", "light"] as const) {
    const table = theme[variant];
    if (!is_record(table) || !REQUIRED_ROLES.every((role) => parse_color(table[role]) !== undefined)) continue;
    const derived = derive_roles(Object.fromEntries(Object.entries(table).filter(([, value]) => parse_color(value) !== undefined)) as GivenColors, variant);
    filled[variant] = { ...table, ...Object.fromEntries(ROLES_ADDED_LATER.filter((role) => table[role] === undefined).map((role) => [role, derived[role]])) };
  }
  return filled;
}

// The imports an older version kept in browser storage, whole and well named only, with only the role keys, as #rrggbb. A broken one is dropped, as that version dropped it.
export function stored_imports_of(stored: unknown): Record<string, Theme> {
  if (!is_record(stored)) return {};
  const kept: Record<string, Theme> = {};
  for (const [name, stored_theme] of Object.entries(stored)) {
    const theme = with_derived_roles(stored_theme);
    if (theme_name_shape_problem(name) !== undefined || local_theme_problem(theme) !== undefined) continue;
    const table = (variant: "dark" | "light") => Object.fromEntries(ROLES.map((role) => [role, parse_color((theme as Record<string, Record<string, unknown>>)[variant]![role])])) as RoleColors;
    kept[name] = { dark: table("dark"), light: table("light") };
  }
  return kept;
}

// The name an import moves to: its own, or `<name>-browser`, `<name>-browser-2` and on while a file of that name holds other text, cut short to fit the name limit.
// A file that already holds the import's text is the import, moved by an earlier start that stopped before it dropped the stored list.
function free_name_for(name: string, text: string, files: ConfigFiles): string {
  for (let round = 0; ; round += 1) {
    const suffix = round === 0 ? "" : round === 1 ? "-browser" : `-browser-${round}`;
    let stem = name;
    while (theme_name_shape_problem(`${stem}${suffix}`) !== undefined) stem = stem.slice(0, -1);
    const candidate = `${stem}${suffix}`;
    const on_file = files[theme_file_path(candidate)];
    if (on_file === undefined || on_file === text) return candidate;
  }
}

// The files and saved edits once the stored imports are theme files, and the paths that changed. A saved `theme` edit that names an import goes into settings.toml, under the import's new name.
// A `settings.d` file that sets `theme`, or a settings.toml the editor cannot change, keeps the saved edit instead.
export function imports_moved_to_files(stored: unknown, files: ConfigFiles, saved: SettingOverrides): { files: ConfigFiles; saved: SettingOverrides; paths: string[] } {
  let moved = { ...files };
  const paths: string[] = [];
  const new_names: Record<string, string> = {};
  for (const [name, theme] of Object.entries(stored_imports_of(stored))) {
    const text = stringify(theme);
    const target = free_name_for(name, text, moved);
    new_names[name] = target;
    if (moved[theme_file_path(target)] === text) continue;
    moved[theme_file_path(target)] = text;
    paths.push(theme_file_path(target));
  }
  const picked = saved.theme;
  if (typeof picked !== "string" || !Object.hasOwn(new_names, picked)) return { files: moved, saved, paths };
  const theme = new_names[picked]!;
  try {
    moved = with_setting_in_files(moved, "theme", theme);
  } catch (error) {
    if (!(error instanceof RuntimeRefusal || error instanceof TomlError)) throw error;
    return { files: moved, saved: { ...saved, theme }, paths };
  }
  const { theme: _moved, ...kept } = saved;
  return { files: moved, saved: kept, paths: [...paths, SETTINGS_FILE] };
}
