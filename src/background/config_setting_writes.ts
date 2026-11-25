import { effective_settings, needs_page, with_fallback_engines } from "../shared/config.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import type { SettingEdits, SettingOverrides, Settings } from "../shared/config.ts";
import { alias_edits_of, engine_edits_of, has_build_edits, nonempty_engine_edits, load_layers } from "./edit_layers.ts";
import type { EngineEdits } from "./edit_layers.ts";
import { build_layered } from "./engine_layer.ts";
import type { EngineFileOutcomes, EnginePlan, EngineTurn } from "./engine_message.ts";
import { ENGINE_FILE } from "./engine_file.ts";
import { KEYS_FILE } from "./engine_keys_file.ts";
import { saved_rows_to_keep } from "./saved_fold.ts";
import { load_edits, load_files_source, store_edits } from "../shared/config/config_load.ts";
import type { FilesSource } from "../shared/config/config_load.ts";
import { HOST_START_PENDING_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import { site_is_off, site_pattern, site_rows_after } from "../shared/site/site_state.ts";
import { is_pass_shaped, site_rows_with_pass, site_rows_without_pass } from "../shared/site/site_keys.ts";
import { matches_pattern, site_row_columns, type SiteRuleRow } from "../shared/match_pattern.ts";
import { host_file_of } from "./native_client.ts";
import { ConfigRefusal } from "./config_reload.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { held_in_settings_d, rows_in_settings_file, SETTINGS_FILE, settings_d_file_that_hides, settings_d_files_naming, settings_d_site_rules, settings_file_naming, settings_file_sets, read_unsynced, with_setting_in_files, with_unsynced_path, without_setting, without_setting_in_files } from "./settings_file.ts";
import type { FileWriteOutcome, UnsetResult } from "./settings_file.ts";
import type { TomlScalar, TomlValue } from "./toml_key_edit.ts";
import { theme_file_path } from "./theme_message.ts";
import type { ThemeFileChange } from "./theme_message.ts";
import { read_host_memory } from "./host_start.ts";
import type { ConfigStore } from "./config_store.ts";
import type { ConfigSwap } from "./config_swap.ts";
import type { ConfigFileWrites, PickMark } from "./config_file_writes.ts";

declare const browser: MessagingBrowser;

// A change of config files the host writes: the browser copy's files after it, the setting edits after it, and the paths it changed, which the host writes in one batch.
// `engines_after` replaces the engines layer in the same storage write, for an Engines page change that moves an engine or a key letter out of the layer an older version kept.
type FolderFilesPlan = { files: ConfigFiles; edits_after: SettingEdits; paths: string[]; engines_after?: EngineEdits };

// The setting, theme and engine writes: each plans a change of the browser copy's files in the change queue, then the file-write pipeline sends it to the folder.
export function create_config_setting_writes(parts: { store: ConfigStore; swap: ConfigSwap; file_writes: ConfigFileWrites }) {
  const { store, swap, file_writes } = parts;
  const { get_config, publish, built_in_commands, layered_build, in_change_queue, commit_change, mirror_key_edits, read_load_step } = store;
  const { apply_files } = swap;
  const { mark_pick, write_files, ask_when_folder_differs, read_folder_after_write, theme_resolves_without_file } = file_writes;
  // One change of the Engines page: its engine file, its key letters file and the old browser layer in one storage write, then one host write of both files.
  // `plan` runs in the change queue and gets a build of any files and layer over the aliases in force, so it refuses what a change breaks before anything is stored.
  // The answer has no `file` or `keys` for a file that stayed as it was.
  async function change_engine_file<R>(plan: (turn: EngineTurn) => EnginePlan | { done: R }): Promise<{ done: R } | EngineFileOutcomes> {
    let changed_paths: string[] = [];
    const changed = await change_folder_files<R>(async (files) => {
      const config = await get_config();
      const layers = await load_layers();
      const layer = engine_edits_of(layers);
      const aliases = alias_edits_of(layers);
      const step = await read_load_step();
      const dropped = has_build_edits(layers) ? (await layered_build(step, layer, aliases)).dropped : [];
      step.source ??= await load_files_source();
      const { dir_label } = step.source;
      const planned = plan({ files, config, layer, dropped, trial: (next_files, next_layer) => build_layered(next_files, dir_label, built_in_commands(), next_layer, aliases) });
      if ("done" in planned) return planned;
      changed_paths = [ENGINE_FILE, KEYS_FILE].filter((path) => planned.files[path] !== files[path]);
      const layer_changed = JSON.stringify(nonempty_engine_edits(planned.layer)) !== JSON.stringify(nonempty_engine_edits(layer));
      return { files: planned.files, edits_after: await load_edits(), paths: changed_paths, ...(layer_changed && { engines_after: planned.layer }) };
    });
    if ("done" in changed) return changed;
    const outcome_of = (path: string) => changed.outcomes[changed_paths.indexOf(path)];
    const file = outcome_of(ENGINE_FILE);
    const keys = outcome_of(KEYS_FILE);
    return { ...(file && { file }), ...(keys && { keys }) };
  }

  // Writes `value` into the browser copy of settings.toml, drops any saved or temp edit of `name` that would hide it, then asks the host to write the file.
  function set_in_settings_file(name: keyof Settings, value: TomlValue): Promise<FileWriteOutcome> {
    return change_setting_in_file<FileWriteOutcome>(name, async (files) => {
      if (name === "theme" && typeof value === "string" && !(await theme_in_files(value))) throw new RuntimeRefusal(`theme not changed: no theme named "${value}"`);
      if (name === "default_engine" && typeof value === "string") {
        if (needs_page(with_fallback_engines((await get_config()).search_engines)[value])) throw new RuntimeRefusal(`default_engine not changed: ${value} needs the current page, so it cannot be the default engine`);
        const home = await where_engine_named(value);
        if (home === "nowhere") throw new RuntimeRefusal(`default_engine not changed: no search engine named "${value}"`);
        if (home === "browser") {
          await save_in_browser(name, value);
          return { done: { kind: "saved_in_browser" } };
        }
      }
      return { files: with_setting_in_files(files, name, value) };
    });
  }

  // Flips the value in force and writes it as `set_in_settings_file` does. The value is read in the change queue, so two quick toggles flip twice.
  async function toggle_in_settings_file(name: keyof Settings): Promise<{ value: boolean; outcome: FileWriteOutcome }> {
    let value = false;
    const outcome = await change_setting_in_file<FileWriteOutcome>(name, async (files) => {
      value = !effective_settings((await get_config()).settings)[name];
      return { files: with_setting_in_files(files, name, value) };
    });
    return { value, outcome };
  }

  // Removes `name` from settings.toml and drops its saved and temp edits, so the default applies.
  // A `settings.d` file that sets it would still win, so the file stays as it is then: the browser edits go, or, with none, the unset refuses and names that file.
  function unset_in_settings_file(name: keyof Settings): Promise<UnsetResult> {
    return change_setting_in_file<UnsetResult>(name, async (files) => {
      const edits = await load_edits();
      const has_browser_edit = Object.hasOwn(edits.saved, name) || Object.hasOwn(edits.temp, name);
      const winning_file = settings_d_file_that_hides(files, name);
      if (winning_file === undefined && settings_file_sets(files, name)) return { files: without_setting_in_files(files, name) };
      if (has_browser_edit) {
        await drop_edits_of(name);
        return { done: { kind: "edits_only" } };
      }
      if (winning_file !== undefined) throw held_in_settings_d(winning_file, name);
      return { done: { kind: "not_set" } };
    });
  }

  // The popup's Disable or Enable on the site of the page at `url`: appends its off row to the `[[site_rules]]` of settings.toml, or removes its rows for the site's pattern there.
  // A list the popup saved in the browser before it wrote the file is dropped on every click, even one that changes no row, and its own rows go into the file.
  // `unchanged`: the site already was as asked and no saved list was left, so nothing is written.
  function change_site_rule_in_file(url: string, action: "disable" | "enable"): Promise<FileWriteOutcome | { kind: "unchanged" }> {
    return change_setting_in_file<{ kind: "unchanged" }>("site_rules", async (files) => {
      const pattern = site_pattern(url);
      if (pattern === undefined) throw new RuntimeRefusal("this page has no site to change");
      const saved_list = (await load_edits()).saved.site_rules;
      const file_rows = rows_in_settings_file(files, "site_rules") as SiteRuleRow[];
      const rows = [...file_rows, ...saved_rows_to_keep(files, saved_list)];
      const changed_rows = site_rows_after(rows, pattern, action);
      const rows_after = changed_rows ?? rows;
      // With the saved list gone, the rules of every file decide again, and one of them can still decide the site the other way.
      // The settings.d rows come after settings.toml's, so they decide only where no row of settings.toml sets the column.
      const rules_after = [...rows_after.map((row) => ({ file: SETTINGS_FILE, row })), ...settings_d_site_rules(files)];
      if (site_is_off(rules_after.map(({ row }) => row), url) !== (action === "disable")) {
        const deciding_file = rules_after.find(({ row }) => matches_pattern(row.site, url) && site_row_columns(row).off !== undefined)?.file;
        throw new RuntimeRefusal(`${action === "disable" ? "Not disabled: an earlier rule in site_rules keeps this site on" : "Not enabled: another rule in site_rules turns this site off"}. Change it in ${deciding_file ?? SETTINGS_FILE}.`);
      }
      if (changed_rows === undefined && saved_list === undefined) return { done: { kind: "unchanged" } };
      // No rows left removes the key, so a file that had none before the first click gets its text back.
      return { files: rows_after.length === 0 ? without_setting_in_files(files, "site_rules") : with_setting_in_files(files, "site_rules", rows_after as TomlValue) };
    });
  }

  // The Settings form's Save and Remove for the keys a site keeps: writes or removes its `{site, pass}` row in settings.toml, in place when the file has one. `unchanged`: Remove found no row.
  function change_site_keys_in_file(pattern: string, keys: string | null): Promise<FileWriteOutcome | { kind: "unchanged" }> {
    return change_setting_in_file<{ kind: "unchanged" }>("site_rules", async (files) => {
      const file_rows = rows_in_settings_file(files, "site_rules") as SiteRuleRow[];
      const saved_list = (await load_edits()).saved.site_rules;
      // A saved kept-keys row for a site a file already has keys for would sit behind that row, so the form leaves it out.
      const files_rows = [...file_rows, ...settings_d_site_rules(files).map(({ row }) => row)];
      const has_keys_in_file = (site: string) => files_rows.some((row) => row.site === site && is_pass_shaped(row));
      const rows = [...file_rows, ...saved_rows_to_keep(files, saved_list).filter((row) => !(is_pass_shaped(row) && has_keys_in_file(row.site)))];
      let rows_after: SiteRuleRow[];
      if (keys === null) {
        const removed = site_rows_without_pass(rows, pattern);
        if (removed === undefined) {
          // The form shows a settings.d row's keys from the combined list, so a Remove that finds none in settings.toml must not claim there is nothing to remove.
          const held = settings_d_site_rules(files).find(({ row }) => row.site === pattern && is_pass_shaped(row));
          if (held !== undefined) throw new RuntimeRefusal(`Not removed: ${held.file} keeps keys for ${pattern}. Change it there.`);
          return { done: { kind: "unchanged" } };
        }
        rows_after = removed;
      } else {
        const changed = site_rows_with_pass(rows, pattern, keys);
        if ("refusal" in changed) throw new RuntimeRefusal(`Not saved. ${changed.refusal}`);
        rows_after = changed.rows;
      }
      return { files: rows_after.length === 0 ? without_setting_in_files(files, "site_rules") : with_setting_in_files(files, "site_rules", rows_after as TomlValue) };
    });
  }

  // One change of `name` in settings.toml. `plan` runs in the change queue on the browser copy's files and returns them changed, or a result that wrote no file.
  // The change drops the saved and temp edits of `name`, so no browser edit hides the file.
  async function change_setting_in_file<R>(name: keyof Settings, plan: (files: ConfigFiles) => Promise<{ files: ConfigFiles } | { done: R }>): Promise<FileWriteOutcome | R> {
    const changed = await change_folder_files<R>(async (files) => {
      const planned = await plan(files);
      return "done" in planned ? planned : { files: planned.files, edits_after: without_setting(await load_edits(), name), paths: [SETTINGS_FILE] };
    });
    return "done" in changed ? changed.done : changed.outcomes[0]!;
  }

  // One change of files the folder holds. `plan` runs in the change queue on the browser copy's files. The outcomes follow the plan's paths.
  // Only the edit runs in the change queue. The host write of every changed path runs outside it, in one batch, so a slow host never holds up a `:set`.
  async function change_folder_files<R>(plan: (files: ConfigFiles) => Promise<FolderFilesPlan | { done: R }>): Promise<{ done: R } | { outcomes: FileWriteOutcome[] }> {
    const committed = await in_change_queue(async () => {
      const current = await load_files_source();
      const planned = await plan(current.files);
      if ("done" in planned) return planned;
      return { paths: planned.paths, ...(await commit_folder_files(current, planned)) };
    });
    if ("done" in committed) return committed;
    const picks = committed.picks.filter((pick) => pick !== undefined);
    const written = picks.length > 0 ? await write_files(in_change_queue, picks.map((pick) => ({ path: pick.path, pick }))) : new Map<string, FileWriteOutcome | undefined>();
    // A pick always stores a record, so the loop finds an outcome. The fallback only satisfies the type.
    const outcomes = committed.picks.map((pick): FileWriteOutcome => (pick ? (written.get(pick.path) ?? { kind: "written" }) : { kind: "browser_copy" }));
    // The question was made against the copy before the pick. The folder may still differ in other files, so it is asked again or settled.
    if (outcomes.every((outcome) => outcome.kind === "written") && committed.question_was_pending) {
      const folder = await read_folder_after_write();
      if (folder) await in_change_queue(() => ask_when_folder_differs(folder, { clear_when_settled: true }));
    }
    return { outcomes };
  }

  // In the change queue. Swaps in the planned files and edits, with each changed path in the record when the copy came from the folder, and numbers a pick for each path.
  // One pick per planned path. None for a path of a copy that did not come from the folder, so only the copy changed, unless an import's record still sends that file to the folder.
  async function commit_folder_files(current: FilesSource, planned: FolderFilesPlan): Promise<{ question_was_pending: boolean; picks: (PickMark | undefined)[] }> {
    // An earlier edit the folder never got keeps its base: the folder still holds that text.
    // A copy that did not come from the folder keeps the record too: an import's files can still wait for the folder.
    const from_folder = await came_from_folder(current);
    let unsynced = await read_unsynced();
    if (from_folder) for (const path of planned.paths) unsynced = with_unsynced_path(unsynced, path, current.files[path] ?? null);
    const edits = await load_edits();
    const question_was_pending = (await browser.storage.local.get(HOST_START_PENDING_STORAGE_KEY))[HOST_START_PENDING_STORAGE_KEY] !== undefined;
    try {
      await apply_files({ ...current, files: planned.files }, "setting", { edits_after: planned.edits_after, unsynced, ...(planned.engines_after && { engines_after: planned.engines_after }) });
    } catch (error) {
      // The files build can refuse a value the setting's own check passes. The checks before catch the common ones with a clearer message.
      throw error instanceof ConfigRefusal ? new RuntimeRefusal(error.message) : error;
    }
    if (JSON.stringify(planned.edits_after.saved) !== JSON.stringify(edits.saved)) await mirror_key_edits();
    const in_record = (path: string) => unsynced !== undefined && Object.hasOwn(unsynced, path);
    return { question_was_pending, picks: planned.paths.map((path) => (from_folder || in_record(path) ? mark_pick(path) : undefined)) };
  }

  // Saves the theme file `themes/<name>.toml` with `text`, or removes it with `text` null, in the browser copy and then through the host, as `set_in_settings_file` writes settings.toml.
  // A save over an existing file needs `replace`. A remove also takes `theme` out of settings.toml and drops the saved and temp edits when they name the theme, so nothing names a theme the files no longer have.
  // A `settings.d` file that sets `theme` to it refuses the remove, as the files build would refuse the config without the theme.
  // A file that shadows a built-in theme (or `desktop`) is only removed: the settings cleanup and the `settings.d` check are skipped, since the name still resolves.
  async function set_theme_file(name: string, text: string | null, replace: boolean): Promise<ThemeFileChange> {
    const path = theme_file_path(name);
    let replaced = false;
    const changed = await change_folder_files<"needs_replace">(async (files) => {
      replaced = Object.hasOwn(files, path);
      const edits = await load_edits();
      if (text !== null) {
        if (replaced && !replace) return { done: "needs_replace" };
        return { files: { ...files, [path]: text }, edits_after: edits, paths: [path] };
      }
      if (!replaced) throw new RuntimeRefusal(`No theme named ${name} is in the config files.`);
      if (host_file_of(path) === undefined) throw new RuntimeRefusal(`The native host does not write ${path}, as its name holds more than lowercase letters, digits, _ and -. Remove it from the config folder by hand.`);
      const { [path]: _removed, ...others } = files;
      // A built-in theme of the same name takes over, so a selection of the name still finds a theme.
      if (theme_resolves_without_file(name)) return { files: others, edits_after: edits, paths: [path] };
      const naming_file = settings_d_files_naming(files, "theme", name)[0];
      if (naming_file !== undefined) throw new RuntimeRefusal(`${naming_file} sets theme = "${name}". Change it there before you remove the theme.`);
      const edits_after = { saved: without_theme_named(edits.saved, name), temp: without_theme_named(edits.temp, name) };
      // Both files go in one batch, so the folder never names a theme file it no longer has.
      return settings_file_naming(files, "theme", name) ? { files: without_setting_in_files(others, "theme"), edits_after, paths: [SETTINGS_FILE, path] } : { files: others, edits_after, paths: [path] };
    });
    if ("done" in changed) return { kind: changed.done };
    const file = changed.outcomes.at(-1)!;
    const settings = changed.outcomes.length > 1 ? changed.outcomes[0] : undefined;
    return { kind: "changed", replaced, file, ...(settings && { settings }) };
  }

  const without_theme_named = (layer: SettingOverrides, theme: string): SettingOverrides => (layer.theme === theme ? Object.fromEntries(Object.entries(layer).filter(([setting]) => setting !== "theme")) : layer);

  // The folder's text is the base only when the browser copy came from the folder: a copy from an import, or one that never read a folder, would seed the folder with a settings.toml of its own.
  async function came_from_folder(source: FilesSource): Promise<boolean> {
    return !source.imported && (await read_host_memory()).applied !== undefined;
  }

  // Whether the files build knows the theme, so a settings.toml that names it builds.
  async function theme_in_files(value: string): Promise<boolean> {
    const files_config = (await read_load_step()).loaded.config;
    return theme_resolves_without_file(value) || Object.hasOwn(files_config.local_themes ?? {}, value);
  }

  // Where an engine name is known. `browser`: only in the browser (an engine added on the Engines page), so the files build refuses a settings.toml that names it.
  // An engine of the same name in the files is known to the build, so that name still goes to the file.
  async function where_engine_named(value: string): Promise<"files" | "browser" | "nowhere"> {
    const files_config = (await read_load_step()).loaded.config;
    if (Object.hasOwn(with_fallback_engines(files_config.search_engines), value)) return "files";
    return Object.hasOwn(with_fallback_engines((await get_config()).search_engines), value) ? "browser" : "nowhere";
  }

  // The saved edit, as before the file write existed: it lasts, and it drops a temp edit of the name that would hide it.
  async function save_in_browser(name: keyof Settings, value: TomlScalar): Promise<void> {
    const before = await load_edits();
    await commit_setting_edits(before, { saved: { ...before.saved, [name]: value }, temp: without_setting(before, name).temp });
  }

  async function drop_edits_of(name: keyof Settings): Promise<void> {
    const before = await load_edits();
    await commit_setting_edits(before, without_setting(before, name));
  }

  // `change_edits` for a caller already in the change queue.
  async function commit_setting_edits(before: SettingEdits, next: SettingEdits): Promise<void> {
    await commit_change(before, next, { store: store_edits, publish: async (edits) => publish(await read_load_step(), edits) });
    if (JSON.stringify(next.saved) !== JSON.stringify(before.saved)) await mirror_key_edits();
  }

  return { set_in_settings_file, toggle_in_settings_file, unset_in_settings_file, change_site_rule_in_file, change_site_keys_in_file, set_theme_file, change_engine_file, commit_folder_files, came_from_folder, where_engine_named };
}

export type ConfigSettingWrites = ReturnType<typeof create_config_setting_writes>;
