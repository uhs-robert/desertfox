// Swaps the config in place.

import { keep_chain, refused_as, warn_and_go } from "../shared/swallow.ts";
import type { MergedConfig, SettingEdits } from "../shared/config.ts";
import { registry } from "../shared/registry/builtin.ts";
import { load_layers } from "./edit_layers.ts";
import type { EngineEdits } from "./edit_layers.ts";
import { load_edits, load_files_source } from "../shared/config/config_load.ts";
import type { FilesSource } from "../shared/config/config_load.ts";
import { ENGINE_EDITS_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import { read_slot_map, store_slot_map } from "./slots.ts";
import { build_files_config, ConfigRefusal, KEPT_CURRENT } from "./config_reload.ts";
import type { ApplyAction } from "./config_reload.ts";
import { checked_consent, plan_folder_writes, IMPORT_DIR_LABEL, imports_nothing, plan_import_files, preview_import, preview_snippet, read_import_source } from "./config_import.ts";
import type { FolderWrite, ImportResult } from "./config_import.ts";
import { edit_problem, is_snippet_file } from "../shared/config_file_path.ts";
import type { ConfigImportPreview, SnippetPreview } from "../shared/messages/page.ts";
import { key_edits_running } from "./keymap_message.ts";
import { parse_snippet } from "../shared/config_build/snippet.ts";
import { commands_of_registry } from "../shared/config_build/build_config.ts";
import { FILES_CONFIG_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import { clear_host_pending, has_config_files, remember_applied, same_files } from "./host_start.ts";
import { read_unsynced, stored_unsynced, unsynced_of_stored } from "./settings_file.ts";
import type { FileWriteOutcome, UnsyncedFiles } from "./settings_file.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import type { ConfigFileWrites, PickMark } from "./config_file_writes.ts";
import type { ConfigFilesReply } from "./native_client.ts";
import type { ConfigStore, LoadStep } from "./config_store.ts";
import type { Services } from "./services.ts";

declare const browser: MessagingBrowser;

// Swaps the config in place: the one commit path of a reload, an import, an editor save and a setting write.
// The file-write pipeline calls `apply_files` of this module, so the caller passes in the parts of it an import uses.
export function create_config_swap(store: ConfigStore, deps: Pick<Services, "snippets" | "native_host"> & { file_writes: Pick<ConfigFileWrites, "note_record_dropped" | "mark_pick" | "write_files" | "writes_of" | "in_write_hold"> }) {
  const { snippets, native_host } = deps;
  const { note_record_dropped, mark_pick, write_files, writes_of, in_write_hold } = deps.file_writes;
  const { get_config, publish, built_in_commands, in_change_queue, read_load_step, set_load_step, read_current_config, set_current_config, count_swap } = store;
  // The one swap path of `config.reload` and of an import: builds the raw files and swaps the config, snippets and stored files in place.
  // Nothing restarts, so the edits and the modes stay. Runs only inside the change queue, so a swap, a `:set` and another swap never publish over each other.
  // A setting write passes `setting`: the edits that replace the setting edits, the record of the folder's base texts (none when no file is written), and for an Engines page change that touches the old engines layer the layer after it.
  // They go into the same storage write as the files, so a stop between writes never leaves one without the other, and a failure restores them all.
  // An import that read the folder passes `import_record`, the record of the files it sends there, which replaces the old record whole.
  async function apply_files(source: FilesSource, action: ApplyAction, setting?: { edits_after: SettingEdits; unsynced: UnsyncedFiles | undefined; engines_after?: EngineEdits }, import_record?: UnsyncedFiles): Promise<{ warnings: number }> {
    const { files, dir_label } = source;
    await get_config();
    const current_step = await read_load_step();
    // The build checks snippet ids against the built-in commands, so the snippets of the last load stay out.
    const { stored, loaded } = build_files_config(files, dir_label, built_in_commands(), action);
    const edits = await load_edits();
    const engines_after = setting?.engines_after;
    const swapped_keys = [FILES_CONFIG_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY, ...(engines_after ? [ENGINE_EDITS_STORAGE_KEY] : [])];
    const local_before = await browser.storage.local.get(swapped_keys);
    const unsynced_after = setting ? setting.unsynced : (import_record ?? (await unsynced_kept_by(action, source)));
    let local_written = false;
    // From here the registry holds the new snippets while the tabs still run the old keymap.
    // Readers wait on `get_config` until the swap commits, so no command runs against half of it.
    const config_before = read_current_config() as Promise<MergedConfig>;
    const slot_map_before = await read_slot_map();
    let commit!: (config: MergedConfig | Promise<MergedConfig>) => void;
    set_current_config(new Promise<MergedConfig>((resolve) => (commit = resolve)));
    try {
      // Before the publish, so a key bound to a snippet resolves.
      const snippet_warnings = snippets.register(loaded.config.snippets);
      // No slots: the new keymap can move the browser chords, so the publish plans them again.
      const step: LoadStep = { loaded, load_warnings: [...loaded.warnings, ...snippet_warnings], source };
      const published = await publish(step, setting?.edits_after ?? edits, engines_after && { ...(await load_layers()), engines: engines_after });
      // One `set`, so the config, the files it was built from, the saved edits and the record of a lagging folder never part.
      // `null` drops the record within the same `set`.
      local_written = true;
      await browser.storage.local.set({
        [FILES_CONFIG_STORAGE_KEY]: stored,
        [FILES_SOURCE_STORAGE_KEY]: source satisfies FilesSource,
        [SETTINGS_FILE_UNSYNCED_STORAGE_KEY]: stored_unsynced(unsynced_after),
        ...(setting && { [SAVED_SETTINGS_STORAGE_KEY]: setting.edits_after.saved }),
        ...(engines_after && { [ENGINE_EDITS_STORAGE_KEY]: engines_after }),
      });
      // Temp edits live in session storage, which no `set` of local storage covers.
      if (setting) await browser.storage.session.set({ [TEMP_SETTINGS_STORAGE_KEY]: setting.edits_after.temp });
      // A setting write keeps the copies-differ question: its own write classifies the folder again.
      if (action !== "setting") await clear_host_pending();
      set_load_step(Promise.resolve(step));
      commit(published.config);
      count_swap();
      if (!setting) {
        const kept = import_record ? undefined : unsynced_after;
        const dropped = Object.keys(unsynced_of_stored(local_before[SETTINGS_FILE_UNSYNCED_STORAGE_KEY]) ?? {}).filter((path) => !kept || !Object.hasOwn(kept, path));
        for (const path of dropped) note_record_dropped(path, action === "import" || action === "edit" ? action : "reload");
      }
      return { warnings: published.warnings.length };
    } catch (error) {
      // The failed publish may have written the new keymap and status already.
      // Each step is best effort, so a failed rollback never hides the error that caused it.
      try {
        snippets.register(current_step.loaded.config.snippets);
      } catch {
        // The publish below still puts the old keymap back.
      }
      // The failed publish may have stored a map planned from the new keymap.
      await store_slot_map(slot_map_before).catch(warn_and_go("rollback slot map"));
      if (local_written) await restore_local(swapped_keys, local_before).catch(warn_and_go("rollback stored files"));
      if (setting) await browser.storage.session.set({ [TEMP_SETTINGS_STORAGE_KEY]: edits.temp }).catch(warn_and_go("rollback temp edits"));
      await publish({ loaded: current_step.loaded, load_warnings: current_step.load_warnings }, edits).catch(warn_and_go("rollback publish"));
      commit(config_before);
      throw error;
    }
  }

  // Puts each key back as it was, and removes the ones that were absent.
  async function restore_local(keys: string[], before: Record<string, unknown>): Promise<void> {
    await browser.storage.local.set(Object.fromEntries(keys.filter((key) => Object.hasOwn(before, key)).map((key) => [key, before[key]])));
    await browser.storage.local.remove(keys.filter((key) => !Object.hasOwn(before, key)));
  }

  // The record of a file the folder has not got survives an editor save or a snippet change that leaves that file as it was: the browser's edit is still the only change to it.
  // A reload or an import that replaces the config brings the copy from elsewhere, and a save of the file itself changes what the folder would get, so those drop its path.
  async function unsynced_kept_by(action: ApplyAction, source: FilesSource): Promise<UnsyncedFiles | undefined> {
    // An import of snippets alone keeps the config files, so it is a snippet change too.
    const keeps_config = action === "edit" || action === "remove" || (action === "import" && !source.imported);
    const unsynced = keeps_config ? await read_unsynced() : undefined;
    if (!unsynced) return undefined;
    const stored = (await load_files_source()).files;
    return stored_unsynced(Object.fromEntries(Object.entries(unsynced).filter(([path]) => stored[path] === source.files[path]))) ?? undefined;
  }

  // What an import would change, for the consent screen. It stores nothing and runs no snippet.
  async function preview_config_import(source: unknown): Promise<ConfigImportPreview> {
    const incoming = await read_import_source(source);
    await get_config();
    const built_in_commands = commands_of_registry(registry).filter((command) => !snippets.is_snippet(command.id));
    const folder = await read_folder_for_import();
    return preview_import(incoming, (await load_files_source()).files, built_in_commands, folder?.files, paths_with_write_out(incoming));
  }

  // The paths of `files` with a host write still out, which can land after the import's folder read.
  const paths_with_write_out = (files: ConfigFiles): Set<string> => new Set(Object.keys(files).filter((path) => writes_of(path).out !== undefined));

  // The config folder, or undefined when the host cannot read it or the folder holds no config files. Then an import stays in the browser, as a start or `,r` would not take such a folder either.
  async function read_folder_for_import(): Promise<ConfigFilesReply | undefined> {
    const reply = await refused_as(native_host.read_config(), undefined);
    return reply?.config_dir_exists && has_config_files(reply.files) ? reply : undefined;
  }

  // Applies an import over the slot's raw files: its config files replace the ones in force, and only the snippets in `accepted` join the installed ones.
  // The slot is read inside the queue, so an import after a reload builds on the reloaded files.
  // Its config files also go to the folder, so a later `,r` keeps them: the swap stores their record, and the writes run after it, outside the queue and in the write hold, as a `:set`'s do.
  // The record is in the swap's own storage write, so a stop before the writes leaves it for the next start to write.
  async function import_config(source: unknown, accepted: unknown): Promise<ImportResult> {
    const reading = read_import_source(source);
    // Settled here too, so a refused read is not an unhandled rejection while the queue waits.
    void keep_chain(reading);
    const { picks, writing, source_once_written, ...result } = await in_change_queue(async (): Promise<ImportResult & { picks?: PickMark[] | undefined; writing?: { outcomes: Promise<Map<string, FileWriteOutcome | undefined>> }; source_once_written?: FilesSource | undefined }> => {
      const incoming = await reading;
      const consented = checked_consent(incoming, accepted);
      if (imports_nothing(incoming, consented)) throw new ConfigRefusal(`${KEPT_CURRENT.import} The import holds no config files and no snippet was accepted.`);
      const current = await load_files_source();
      const { files: planned_files, replaces_config } = plan_import_files(incoming, current.files, consented);
      const snippet_count = Object.keys(consented).length;
      if (!replaces_config) return { ...(await apply_files({ ...current, files: planned_files }, "import")), replaces_config, snippets: snippet_count };
      const folder = await read_folder_for_import();
      // The copy holds the folder's consent keys too, so the text written and the record's view of the copy are one.
      const plan = folder && plan_folder_writes(planned_files, folder.files, paths_with_write_out(planned_files));
      const { warnings } = await apply_files({ files: plan?.files ?? planned_files, dir_label: IMPORT_DIR_LABEL, imported: true }, "import", undefined, plan?.record);
      if (!plan) return { warnings, replaces_config, snippets: snippet_count };
      // The source the copy takes once every write lands: one the folder holds whole but for the files the import lacks.
      const folder_can_hold_copy = Object.keys(plan.kept_out).length === 0 && Object.entries(plan.files).every(([path, text]) => !is_snippet_file(path) || folder.files[path] === text);
      const source_once_written = folder_can_hold_copy ? { files: plan.files, dir_label: folder.config_dir, imported: false } : undefined;
      const picks = Object.keys(plan.record).map(mark_pick);
      // Joins the write hold in the turn that committed, so a `:set` after the import writes after it.
      const outcomes = in_write_hold(() => write_files(in_change_queue, picks.map((pick) => ({ path: pick.path, pick }))));
      return { warnings, replaces_config, snippets: snippet_count, picks, writing: { outcomes }, kept_out: plan.kept_out, source_once_written };
    });
    if (!picks || !writing) return result;
    const outcomes = await writing.outcomes;
    // A pick always stores a record, so the loop finds an outcome. The fallback only satisfies the type.
    const folder_writes: FolderWrite[] = picks.map(({ path }) => ({ path, outcome: outcomes.get(path) ?? { kind: "written" } }));
    if (source_once_written && folder_writes.every(({ outcome }) => outcome.kind === "written")) await end_import(source_once_written).catch(warn_and_go("end an import whose files all reached the folder"));
    return { ...result, folder_writes };
  }

  // An import whose every file reached the folder, with no snippet the folder lacks, holds what the folder holds. It then takes the folder's label and stops being an import, so a `:set` writes the folder again and the next start adopts the folder without asking.
  // Only while the copy is still the import's files and no write waits: a browser change since then would be lost to that adopt.
  async function end_import(source: FilesSource): Promise<void> {
    await in_change_queue(async () => {
      const current = await load_files_source();
      if (!current.imported || !same_files(current.files, source.files) || (await read_unsynced()) !== undefined) return;
      await apply_files(source, "import");
      await remember_applied(source.files);
    });
  }

  // Drops one installed snippet from the slot's raw files and rebuilds. A key in the files or a key edit that binds it refuses the removal, and the snippet stays.
  function remove_snippet(path: string): Promise<{ warnings: number }> {
    return in_change_queue(async () => {
      const current = await load_files_source();
      if (!path.startsWith("snippets/") || !Object.hasOwn(current.files, path)) throw new ConfigRefusal(`${KEPT_CURRENT.remove} No snippet ${path} is installed.`);
      const snippet_id = parse_snippet(path, current.files[path]!, [])?.id;
      if (snippet_id !== undefined) {
        const binding_edits = key_edits_running(snippet_id, { config: await get_config(), layers: await load_layers() }, registry);
        if (binding_edits.length > 0) throw new ConfigRefusal(`${KEPT_CURRENT.remove} The key edit ${binding_edits.join(", ")} runs ${snippet_id}. Reset or change it first.`);
      }
      const { [path]: _removed, ...files } = current.files;
      return apply_files({ ...current, files }, "remove");
    });
  }

  // Files the editor saved are named by their stored path, in the build and in the slot, so a message names the same file whatever the last action was.
  const EDITOR_DIR_LABEL = "";

  // Stores one file the user typed in the files editor, or deletes it with `text` null, and rebuilds. The user's own config: the import guards do not apply.
  // It runs in the change queue, so saves and reloads apply one after another, each on the files the one before left. A build that fails writes nothing, so the stored files and the config stay as they were.
  // A snippet is code with every permission, so it is stored only with `accepted` equal to its text. Otherwise the answer is the consent preview, and nothing is stored.
  function save_config_file(path: string, text: string | null, base: string | null, accepted?: string): Promise<{ warnings: number } | { consent: SnippetPreview }> {
    return in_change_queue(async () => {
      const current = await load_files_source();
      const problem = edit_problem(path, text, current.files);
      if (problem) throw new ConfigRefusal(`${KEPT_CURRENT.edit} ${problem}`);
      if ((current.files[path] ?? null) !== base) throw new ConfigRefusal(`${KEPT_CURRENT.edit} ${path} changed since you opened it (an import, a reload or another tab). Close it and open it again.`);
      if (text !== null && is_snippet_file(path) && accepted !== text) return { consent: preview_snippet(path, text, current.files, EDITOR_DIR_LABEL) };
      const { [path]: _replaced, ...others } = current.files;
      return apply_files({ files: text === null ? others : { ...others, [path]: text }, dir_label: EDITOR_DIR_LABEL, imported: current.imported }, "edit");
    });
  }

  return { apply_files, import_config, preview_config_import, remove_snippet, save_config_file };
}

export type ConfigSwap = ReturnType<typeof create_config_swap>;
