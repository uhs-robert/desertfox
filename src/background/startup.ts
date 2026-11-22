// The reload and start sequence of the config, with the wiring of the config modules. The config itself lives in `config_store.ts` and `config_swap.ts`, the writes in `config_file_writes.ts` and `config_setting_writes.ts`.
import { warn_and_go } from "../shared/swallow.ts";
import { show_toast_on_tab } from "./browser_deps.ts";
import { load_layers } from "./edit_layers.ts";
import { has_engine_edits } from "./edit_layers.ts";
import { ENGINE_FILE } from "./engine_file.ts";
import { engine_layer_moved } from "./engine_layer_move.ts";
import { fold_kept_notes, fold_moved_note, has_foldable, saved_layer_folded } from "./saved_fold.ts";
import { load_edits, load_files_source } from "../shared/config/config_load.ts";
import { ENGINE_EDITS_STORAGE_KEY, AUTOCONFIG_KEY_EDITS_ONLY_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SAVED_FOLD_NOTES_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, THEME_EDITS_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import type { Settings } from "../shared/config.ts";
import { NativeHostError } from "./native_client.ts";
import { ConfigRefusal, KEPT_CURRENT } from "./config_reload.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { classify_host_start, clear_host_pending, compared_files, has_config_files, read_host_memory, remember_applied, same_files, settle_host_start, store_host_pending } from "./host_start.ts";
import { files_before_unsynced, read_unsynced, SETTINGS_FILE } from "./settings_file.ts";
import { imports_moved_to_files } from "./theme_message.ts";
import type { HostStartChoice } from "../shared/messages/page.ts";
import { create_config_swap } from "./config_swap.ts";
import { create_config_file_writes } from "./config_file_writes.ts";
import { create_config_setting_writes } from "./config_setting_writes.ts";
import { config_store, services } from "./config_store.ts";
import type { ConfigStore } from "./config_store.ts";
import type { Services } from "./services.ts";

declare const browser: MessagingBrowser;

// The reload and the start sequence, and the wiring of the swap and the write modules into one service.
// The caller passes the store and the services, so a test builds its own instance and a production start shares the store with the commands.
export function create_config_service(parts: { store: ConfigStore; services: Services }) {
  const { store, services } = parts;
  const { snippets, host_update, native_host, autoconfig } = services;
  const { get_config, publish, in_change_queue, commit_change, read_fold_notes, read_load_step, read_swap_count } = store;
  // The swap takes `note_record_dropped` from the pipeline, and the pipeline calls `apply_files` of the swap, so the pipeline reads the swap late.
  const file_writes = create_config_file_writes({ store, services, swap: () => swap });
  const swap = create_config_swap(store, { snippets, note_record_dropped: file_writes.note_record_dropped });
  const { apply_files } = swap;
  const setting_writes = create_config_setting_writes({ store, swap, file_writes });
  const { commit_folder_files, came_from_folder, where_engine_named } = setting_writes;
  const { already_in_queue, write_waiting_files, folder_build_problems } = file_writes;
  // Older versions mirrored the saved settings too, consent values included, and a profile that changes no saved setting or key edit after the update would keep them in the file.
  // So the first start whose host finds the folder writes the file once. The mark waits for a write the host confirmed, so a failed one is tried again at the next start.
  // An empty saved layer left no setting in the file, and the write would create the file for a user who never had one, so that start only sets the mark.
  // A missing folder writes nothing: the host would create the folder for this file alone.
  async function rewrite_old_mirror(folder_exists: boolean): Promise<void> {
    if (!folder_exists || (await browser.storage.local.get(AUTOCONFIG_KEY_EDITS_ONLY_STORAGE_KEY))[AUTOCONFIG_KEY_EDITS_ONLY_STORAGE_KEY] === true) return;
    // Queued in the change queue, so a key edit that commits after it writes after it too. The host write itself waits outside the queue.
    const { written } = await in_change_queue(async () => {
      // The stored layer, not the checked one: a value the checks now drop still sat in the old file.
      const stored_saved = (await browser.storage.local.get(SAVED_SETTINGS_STORAGE_KEY))[SAVED_SETTINGS_STORAGE_KEY] as Record<string, unknown> | undefined;
      if (stored_saved === undefined || Object.keys(stored_saved).length === 0) return { written: Promise.resolve(true) };
      return { written: autoconfig.mirror((await load_layers()).keymap) };
    });
    if (await written) await browser.storage.local.set({ [AUTOCONFIG_KEY_EDITS_ONLY_STORAGE_KEY]: true });
  }

  // Rereads the files through the native host and applies them. They replace an import too.
  // A setting still waiting for the folder is written first, so `,r` keeps it. When the host cannot write it, the folder wins as always.
  function reload_config(): Promise<{ config_dir: string; warnings: number }> {
    return in_change_queue(async () => {
      // `,r` holds the queue for its own host read, so it waits on a write that is out and writes in its turn.
      await write_waiting_files(already_in_queue);
      const reply = await native_host.read_config().catch((error: unknown) => {
        throw error instanceof NativeHostError ? new ConfigRefusal(`${KEPT_CURRENT.reload} ${error.message}`) : error;
      });
      // An empty build here would replace the user's config with the defaults, most likely because the host reads the wrong folder.
      if (!reply.config_dir_exists) throw new ConfigRefusal(missing_folder_message(reply.config_dir));
      if (!has_config_files(reply.files)) throw new ConfigRefusal(empty_folder_message(reply.config_dir));
      const { warnings } = await apply_host_files(reply.files, reply.config_dir);
      return { config_dir: reply.config_dir, warnings };
    });
  }

  // Runs once per start. Edits made to the files while the browser was closed reach the stored build here, without a `config.reload`.
  // No permission, no host, a host error, or a missing or empty config folder keep the stored config and only warn on the console. Most users have no host, and the installer never creates the folder.
  // A folder that differs replaces the browser copy only while the copy holds no browser change. Otherwise the start stores what it would change, and the user chooses on the settings page (`host_start.ts`).
  // A broken file keeps the stored config too, and a toast names the problem so the user learns the edit failed.
  // The host read runs outside the queue so it never blocks a `:set` while the host starts. A swap that commits during the read is newer than the reply, so the reply is dropped.
  async function reload_config_at_start(): Promise<void> {
    await move_imported_themes().catch(warn_and_go("move the imported themes into theme files"));
    await move_engine_layer().catch(warn_and_go("move the engines saved in the browser into the Engines page's files"));
    await write_waiting_files(in_change_queue).catch(warn_and_go("write the waiting config files at start"));
    const swaps_before = read_swap_count();
    let reply;
    try {
      reply = await native_host.read_config();
    } catch (error) {
      console.warn(`Config not reread at start: ${error instanceof Error ? error.message : String(error)}`);
      // A choice needs the host, so a question left from an earlier start cannot be answered now.
      await in_change_queue(clear_host_pending).catch(warn_and_go("clear host pending"));
      return;
    }
    // Not awaited, so the start read never waits on this write.
    void rewrite_old_mirror(reply.config_dir_exists).catch(warn_and_go("rewrite autoconfig.toml with the key edits alone"));
    // The swap count once the copy stands for the folder with no question open, or undefined: the only state where the saved settings can join the copy without a later "use the folder" dropping them.
    const settled = await in_change_queue(async (): Promise<number | undefined> => {
      await get_config();
      if (read_swap_count() !== swaps_before) return undefined;
      const browser_files = (await load_files_source()).files;
      // A setting the host could not write yet (an older host) is the copy's only change while the folder still holds the base text: no question, the write comes later.
      const unsynced = await read_unsynced();
      const only_unwritten_edit_differs = unsynced !== undefined && same_files(compared_files(reply.files), compared_files(files_before_unsynced(browser_files, unsynced)));
      if (only_unwritten_edit_differs) return read_swap_count();
      const plan = await classify_host_start(reply, browser_files, await read_host_memory());
      if (plan.kind === "ask") {
        await store_host_pending(plan.pending);
        await toast_start(HOST_DIFFERS_MESSAGE, "warning");
        return undefined;
      }
      if (plan.kind === "ignore") {
        if (plan.reason === "missing") console.warn(missing_folder_message(reply.config_dir));
        if (plan.reason === "empty") console.warn(empty_folder_message(reply.config_dir));
        if (plan.reason === "same") await remember_applied(reply.files);
        await clear_host_pending();
        return plan.reason === "same" ? read_swap_count() : undefined;
      }
      try {
        await apply_host_files(reply.files, reply.config_dir);
        return read_swap_count();
      } catch (error) {
        if (!(error instanceof ConfigRefusal)) throw error;
        await toast_start(error.message, "error");
        return undefined;
      }
    }).catch((error: unknown) => {
      console.warn(`Config not reread at start: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    });
    if (settled === undefined) return;
    const folded = await fold_saved_layer(settled).catch(warn_and_go("move the settings saved in the browser into settings.toml"));
    // Only a fold adds a write. A path the first round left waiting waits for the next start, as before.
    if (folded === true) await write_waiting_files(in_change_queue).catch(warn_and_go("write the folded settings.toml at start"));
  }

  // Moves the imports an older version kept in browser storage into theme files, and a saved `theme` edit that names one into settings.toml. The waiting writes of the start send them to the folder, or a later start when the host is off.
  // The stored list goes in the same queue turn, after the swap stored the files and the record together. A stop before that leaves the list, and the next start moves it again: a file that holds an import's text already counts as moved.
  async function move_imported_themes(): Promise<void> {
    await in_change_queue(async () => {
      const stored = (await browser.storage.local.get(THEME_EDITS_STORAGE_KEY))[THEME_EDITS_STORAGE_KEY];
      if (stored === undefined) return;
      await get_config();
      const current = await load_files_source();
      const edits = await load_edits();
      const moved = imports_moved_to_files(stored, current.files, edits.saved);
      if (moved.paths.length > 0 || moved.saved !== edits.saved) await commit_folder_files(current, { files: moved.files, edits_after: { saved: moved.saved, temp: edits.temp }, paths: moved.paths });
      await browser.storage.local.remove(THEME_EDITS_STORAGE_KEY);
    });
  }

  // Moves the engines layer an older version kept in the browser into the Engines page's files (`engine_layer_moved`), and a saved `default_engine` edit into settings.toml. The waiting writes of the start send them to the folder, or a later start when the host is off.
  // What is left of the layer goes in the same storage write as the files and the record, so a stop at any point moves nothing twice and loses nothing. It stays in the build and on the Engines page as before. A start toasts what the user needs to know: a hand file that now wins, or a piece left in the layer.
  async function move_engine_layer(): Promise<void> {
    const notes = await in_change_queue(async () => {
      const stored = (await browser.storage.local.get(ENGINE_EDITS_STORAGE_KEY))[ENGINE_EDITS_STORAGE_KEY];
      const edits = await load_edits();
      if (stored === undefined && typeof edits.saved.default_engine !== "string") return [];
      await get_config();
      const current = await load_files_source();
      const move = engine_layer_moved(stored, current.files, edits.saved, (files) => folder_build_problems(files, current.dir_label));
      const left_changed = stored !== undefined && JSON.stringify(move.left) !== JSON.stringify(stored);
      if (move.paths.length > 0 || move.saved !== edits.saved) {
        await commit_folder_files(current, { files: move.files, edits_after: { saved: move.saved, temp: edits.temp }, paths: move.paths, ...(left_changed && { engines_after: move.left }) });
      } else if (left_changed) {
        // No file changed, so the layer has no write to share. It still needs a publish, or the running keymap keeps a dropped letter, and a failed publish puts the stored layer back.
        const store = async (layer: unknown) => (layer === undefined ? browser.storage.local.remove(ENGINE_EDITS_STORAGE_KEY) : browser.storage.local.set({ [ENGINE_EDITS_STORAGE_KEY]: layer }));
        const step = await read_load_step();
        await commit_change<unknown>(stored, has_engine_edits(move.left) ? move.left : undefined, { store, publish: async () => publish(step, edits) });
        return move.notes;
      }
      if (stored !== undefined && !has_engine_edits(move.left)) await browser.storage.local.remove(ENGINE_EDITS_STORAGE_KEY);
      return move.notes;
    });
    if (notes.length > 0) await toast_start(`Moving the search engines saved in the browser into ${ENGINE_FILE}: ${notes.join(" ")}`, "warning");
  }

  // Moves the settings an older version saved in the browser into settings.toml (`saved_layer_folded`). The start runs it only after its folder read settled, and the waiting writes after it send the file to the folder.
  // Without the host or a folder, or while the copies-differ question waits, the layer stays on top as before: a later "use the folder" answer drops values that sit only in the copy.
  // The smaller layer goes in the same storage write as the files and the record, so a stop at any point moves nothing twice and loses nothing.
  // A name that stays saved gets a Home warning at every start, and a start that moves something says so in a toast and on Home.
  // True when it moved something into the browser copy.
  // `swaps_settled` is the swap count the start read reconciled. A swap since, for example an editor save, makes a difference the next start can ask about, so the fold waits for that start.
  async function fold_saved_layer(swaps_settled: number): Promise<boolean> {
    const moved_note = await in_change_queue(async () => {
      await get_config();
      const pending = (await browser.storage.local.get(HOST_START_PENDING_STORAGE_KEY))[HOST_START_PENDING_STORAGE_KEY] !== undefined;
      // A swap or a pick can land between the start read and this turn.
      if (read_swap_count() !== swaps_settled || pending || !(await came_from_folder(await load_files_source()))) return undefined;
      const edits = await load_edits();
      const notes_before = await read_fold_notes();
      const engine = edits.saved.default_engine;
      // Only the old engines layer defines such an engine, and the files build refuses a settings.toml that names it, so it stays a saved edit (`set_in_settings_file`).
      const browser_only_engine = typeof engine === "string" && (await where_engine_named(engine)) === "browser";
      const stays_in_browser = (name: keyof Settings) => name === "default_engine" && browser_only_engine;
      let notes: string[] = [];
      let moved_note: string | undefined;
      if (has_foldable(edits.saved, stays_in_browser)) {
        const current = await load_files_source();
        const fold = saved_layer_folded(edits.saved, current.files, (files) => folder_build_problems(files, current.dir_label), stays_in_browser);
        moved_note = fold_moved_note(fold);
        if (moved_note !== undefined) {
          const paths = fold.files[SETTINGS_FILE] === current.files[SETTINGS_FILE] ? [] : [SETTINGS_FILE];
          await commit_folder_files(current, { files: fold.files, edits_after: { saved: fold.saved, temp: edits.temp }, paths });
        }
        notes = [...(moved_note === undefined ? [] : [moved_note]), ...fold_kept_notes(fold)];
      }
      // Stored after the swap, so a refused swap claims no move. The warnings then need a publish of their own to reach Home.
      if (JSON.stringify(notes) !== JSON.stringify(notes_before)) {
        await store_fold_notes(notes);
        await publish(await read_load_step(), await load_edits());
      }
      return moved_note;
    });
    if (moved_note === undefined) return false;
    await toast_start(moved_note, "warning").catch(warn_and_go("show the toast of the folded settings"));
    return true;
  }

  async function store_fold_notes(notes: string[]): Promise<void> {
    if (notes.length === 0) await browser.storage.session.remove(SAVED_FOLD_NOTES_STORAGE_KEY);
    else await browser.storage.session.set({ [SAVED_FOLD_NOTES_STORAGE_KEY]: notes });
  }

  const HOST_DIFFERS_MESSAGE = "The config folder differs from the config stored in the browser, which stays for now. Open the Settings page to choose.";

  // Every swap to the folder's files goes through here, so the next start can tell an unedited browser copy from one with browser changes.
  async function apply_host_files(files: ConfigFiles, config_dir: string): Promise<{ warnings: number }> {
    const applied = await apply_files({ files, dir_label: config_dir, imported: false }, "reload");
    await remember_applied(files);
    return applied;
  }

  // The answer to the settings page's question. In the change queue, so it never interleaves with a save, an import or a reload.
  function choose_host_start(choice: HostStartChoice["choice"], seen: { host_digest: string; browser_digest: string }): Promise<{ warnings: number }> {
    return in_change_queue(() =>
      settle_host_start(choice, seen, {
        read_host: () => native_host.read_config(),
        read_browser_files: async () => (await load_files_source()).files,
        apply_folder: apply_host_files,
      }),
    );
  }

  async function toast_start(message: string, kind: "error" | "warning"): Promise<void> {
    console.warn(message);
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    await show_toast_on_tab({ tab_id: tab?.id }, "config_start", message, kind);
  }

  const missing_folder_message = (config_dir: string) => `${KEPT_CURRENT.reload} The native host found no config folder at ${config_dir}. Create it, or set DESERTFOX_CONFIG_DIR for the host.`;
  // The host creates the folder itself when it writes autoconfig.toml, so a folder holding only that file is as good as missing.
  const empty_folder_message = (config_dir: string) => `${KEPT_CURRENT.reload} The native host found no config files in ${config_dir}. Put your config files there, or set DESERTFOX_CONFIG_DIR for the host.`;

  return {
    ...swap,
    set_in_settings_file: setting_writes.set_in_settings_file,
    toggle_in_settings_file: setting_writes.toggle_in_settings_file,
    unset_in_settings_file: setting_writes.unset_in_settings_file,
    change_site_rule_in_file: setting_writes.change_site_rule_in_file,
    change_site_keys_in_file: setting_writes.change_site_keys_in_file,
    set_theme_file: setting_writes.set_theme_file,
    change_engine_file: setting_writes.change_engine_file,
    get_config: store.get_config,
    get_search_engine_names: store.get_search_engine_names,
    change_edits: store.change_edits,
    change_layers: store.change_layers,
    read_settings_layers: store.read_settings_layers,
    read_keymap_state: store.read_keymap_state,
    read_engine_state: store.read_engine_state,
    read_stored_files: store.read_stored_files,
    read_alias_state: store.read_alias_state,
    republish: store.republish,
    set_desktop_theme: store.set_desktop_theme,
    snippets,
    host_update,
    native_host,
    reload_config,
    reload_config_at_start,
    choose_host_start,
  };
}

export type ConfigService = ReturnType<typeof create_config_service>;

const service = create_config_service({ store: config_store, services });
export const { import_config, preview_config_import, remove_snippet, save_config_file, set_in_settings_file, toggle_in_settings_file, unset_in_settings_file, change_site_rule_in_file, change_site_keys_in_file, set_theme_file, change_engine_file, reload_config, reload_config_at_start, choose_host_start } = service;

