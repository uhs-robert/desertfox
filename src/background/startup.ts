// Loads the config, compiles the keymap and publishes the result.

import type { MergedConfig, SettingEdits } from "../shared/config.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import { registry } from "../shared/registry/builtin.ts";
import { container_names, make_router_deps, snippet_deps } from "./browser_deps.ts";
import { compile_config } from "./compile.ts";
import { build_config_status, load_config, load_edits, load_files_source, store_edits, with_edits } from "./config_load.ts";
import type { FilesSource, LoadedConfig } from "./config_load.ts";
import { DEFAULT_KEYMAP } from "./default_keymap.ts";
import { THEME_STORAGE_KEY, USER_CSS_STORAGE_KEY } from "../shared/theme/apply.ts";
import { CONFIG_STATUS_STORAGE_KEY, DISABLED_STORAGE_KEY, SLOT_TABLE_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "./storage_keys.ts";
import { OFF_KEYMAP } from "./toolbar.ts";
import { apply_slot_plan, plan_slots, release_slots, slot_table } from "./slots.ts";
import type { SlotPlan } from "./slots.ts";
import { no_repeat_memory } from "./repeat_memory.ts";
import { create_snippets } from "./snippets.ts";
import { browser_native_deps, create_native_client, NativeHostError } from "./native_client.ts";
import { build_files_config, ConfigRefusal, KEPT_CURRENT } from "./config_reload.ts";
import type { ApplyAction } from "./config_reload.ts";
import { checked_consent, IMPORT_DIR_LABEL, imports_nothing, plan_import_files, preview_import, read_import_source } from "./config_import.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import type { ConfigImportPreview } from "../shared/messages.ts";
import { create_autoconfig_mirror } from "./autoconfig_mirror.ts";
import { commands_of_registry } from "../shared/config_build/build_config.ts";
import { FILES_CONFIG_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY } from "./storage_keys.ts";

export const snippets = create_snippets(registry, snippet_deps, make_router_deps(get_config, no_repeat_memory));
const native_host = create_native_client(browser_native_deps());
const autoconfig = create_autoconfig_mirror({ write_autoconfig: native_host.write_autoconfig, warn: console.warn });

// Everything a load (the first one, or a `config.reload`) works out and `publish` reuses. Browser edits are not part of it: they change while this stays.
type LoadStep = {
  loaded: LoadedConfig;
  // Warnings of the load itself. A publish adds the compile warnings to them.
  load_warnings: string[];
  // Found on the first publish of a load. A `:set` keeps it: it refuses the prefix settings, the only ones that move keys.
  slots?: { plan: SlotPlan; table: ReturnType<typeof slot_table>; warnings: string[]; applied: boolean };
};

// Derived from storage on every start, so a restart loses nothing.
let load_step: Promise<LoadStep> | undefined;
// Replaced after each publish, so a reader never sees the config from before a `:set`.
let current_config: Promise<MergedConfig> | undefined;

export function get_config(): Promise<MergedConfig> {
  return (current_config ??= start());
}

export async function get_search_engine_names(): Promise<string[]> {
  return Object.keys((await get_config()).search_engines);
}

async function start(): Promise<MergedConfig> {
  const loaded = await load_config();
  // Before the compile, so a key bound to a snippet resolves.
  const snippet_warnings = snippets.register(loaded.config.snippets);
  const step: LoadStep = { loaded, load_warnings: [...loaded.warnings, ...snippet_warnings] };
  load_step = Promise.resolve(step);
  return (await publish(step, await load_edits())).config;
}

// Compiles the loaded config under the browser edits, stores the result and tells the tabs.
// `warnings` is the whole list the help page shows: load, compile and shortcut slots.
async function publish(step: LoadStep, edits: SettingEdits): Promise<{ config: MergedConfig; warnings: string[] }> {
  const config = with_edits(step.loaded.config, edits);
  const { compiled, theme, warnings } = compile_config({
    config,
    default_keymap: DEFAULT_KEYMAP,
    get_command: (command_id) => registry.get(command_id),
    enum_sources: { search_engines: Object.keys(config.search_engines), containers: await container_names() },
  });

  // Read at every publish, so a restart with the switch off, a `:set` and a reload all store the empty keymap.
  const disabled = (await browser.storage.local.get(DISABLED_STORAGE_KEY))[DISABLED_STORAGE_KEY] === true;
  const plan = step.slots?.plan ?? plan_slots(compiled.modes.browser);
  if (disabled) {
    // A taken chord would still be eaten by Firefox, so the page would lose it while off.
    await release_slots(plan, browser.commands);
    step.slots = { plan, table: slot_table({ ...plan, assignments: [] }), warnings: plan.warnings, applied: false };
  } else if (!step.slots?.applied) {
    const applied = await apply_slot_plan(plan, browser.commands);
    step.slots = { plan, table: slot_table({ ...plan, assignments: applied.applied }), warnings: [...plan.warnings, ...applied.warnings], applied: true };
  }
  const all_warnings = [...step.load_warnings, ...warnings, ...step.slots.warnings];
  for (const warning of all_warnings) console.warn(`desertfox: ${warning}`);

  await browser.storage.local.set({
    [COMPILED_KEYMAP_STORAGE_KEY]: disabled ? OFF_KEYMAP : compiled,
    [WARNINGS_STORAGE_KEY]: all_warnings,
    [CONFIG_STATUS_STORAGE_KEY]: build_config_status(step.loaded.source, step.loaded.config.settings, edits),
    [SLOT_TABLE_STORAGE_KEY]: step.slots.table,
    [THEME_STORAGE_KEY]: theme,
    [USER_CSS_STORAGE_KEY]: config.css,
  });
  await tell_tabs_tree_changed();
  return { config, warnings: all_warnings };
}

// `:set` and `:unset` change the edits one at a time, so two of them in a row never read the same stored value.
let change_queue: Promise<unknown> = Promise.resolve();

// `decide` gets the edits now in force and the config under them. It returns the edits to keep, or nothing to change nothing.
export function change_edits(decide: (current: SettingEdits, config: MergedConfig) => SettingEdits | undefined): Promise<void> {
  const change = change_queue.then(async () => {
    const config = await get_config();
    const before = await load_edits();
    const next = decide(before, config);
    if (next === undefined) return;
    try {
      // Inside the try: the saved and temp layers are two writes, and one can land while the other fails.
      await store_edits(next);
      // Assigned after the publish succeeds, so a failed one leaves the readers the last good config.
      const { config: published } = await publish(await (load_step as Promise<LoadStep>), next);
      current_config = Promise.resolve(published);
      const saved_changed = JSON.stringify(next.saved) !== JSON.stringify(before.saved);
      if (saved_changed) void autoconfig.mirror(next.saved);
    } catch (error) {
      // Pages read the stored edits themselves, so a failed publish must not leave them ahead of the config.
      // Best effort, so a failed rollback never hides the error that caused it.
      await store_edits(before).catch(() => undefined);
      // Best effort: the failed publish may have written the keymap and status for `next` already.
      await publish(await (load_step as Promise<LoadStep>), before).catch(() => undefined);
      throw error;
    }
  });
  change_queue = change.catch(() => undefined);
  return change;
}

// Publishes again under the current edits, for a change that is not an edit: the toolbar switch. It runs in the change queue like the edits.
export function republish(): Promise<void> {
  const again = change_queue.then(async () => {
    await get_config();
    await publish(await (load_step as Promise<LoadStep>), await load_edits());
  });
  change_queue = again.catch(() => undefined);
  return again;
}

// The one swap path of `config.reload` and of an import: builds the raw files and swaps the config, snippets and stored files in place.
// Nothing restarts, so the edits and the modes stay. Runs only inside the change queue, so a swap, a `:set` and another swap never publish over each other.
async function apply_files(files: ConfigFiles, dir_label: string, action: ApplyAction): Promise<{ warnings: number }> {
  await get_config();
  const current_step = await (load_step as Promise<LoadStep>);
  // The build checks snippet ids against the built-in commands, so the snippets of the last load stay out.
  const built_in_commands = commands_of_registry(registry).filter((command) => !snippets.is_snippet(command.id));
  const { stored, loaded } = build_files_config(files, dir_label, built_in_commands, action);
  const edits = await load_edits();
  // From here the registry holds the new snippets while the tabs still run the old keymap.
  // Readers wait on `get_config` until the swap commits, so no command runs against half of it.
  const config_before = current_config as Promise<MergedConfig>;
  let commit!: (config: MergedConfig | Promise<MergedConfig>) => void;
  current_config = new Promise<MergedConfig>((resolve) => (commit = resolve));
  try {
    // Before the publish, so a key bound to a snippet resolves.
    const snippet_warnings = snippets.register(loaded.config.snippets);
    // No slots: the new keymap can move the browser chords, so the publish plans them again.
    const step: LoadStep = { loaded, load_warnings: [...loaded.warnings, ...snippet_warnings] };
    const published = await publish(step, edits);
    // One `set`, so the config and the files it was built from never part.
    await browser.storage.local.set({ [FILES_CONFIG_STORAGE_KEY]: stored, [FILES_SOURCE_STORAGE_KEY]: { files, dir_label } satisfies FilesSource });
    load_step = Promise.resolve(step);
    commit(published.config);
    return { warnings: published.warnings.length };
  } catch (error) {
    // The failed publish may have written the new keymap and status already.
    // Each step is best effort, so a failed rollback never hides the error that caused it.
    try {
      snippets.register(current_step.loaded.config.snippets);
    } catch {
      // The publish below still puts the old keymap back.
    }
    await publish({ loaded: current_step.loaded, load_warnings: current_step.load_warnings }, edits).catch(() => undefined);
    commit(config_before);
    throw error;
  }
}

function in_change_queue<T>(work: () => Promise<T>): Promise<T> {
  const queued = change_queue.then(work);
  change_queue = queued.catch(() => undefined);
  return queued;
}

// Rereads the files through the native host and applies them. They replace an import too.
export function reload_config(): Promise<{ config_dir: string; warnings: number }> {
  return in_change_queue(async () => {
    const reply = await native_host.read_config().catch((error: unknown) => {
      throw error instanceof NativeHostError ? new ConfigRefusal(`${KEPT_CURRENT.reload} ${error.message}`) : error;
    });
    // An empty build here would replace the user's config with the defaults, most likely because the host reads the wrong folder.
    if (!reply.config_dir_exists) {
      throw new ConfigRefusal(`${KEPT_CURRENT.reload} The native host found no config folder at ${reply.config_dir}. Create it, or set DESERTFOX_CONFIG_DIR for the host.`);
    }
    const { warnings } = await apply_files(reply.files, reply.config_dir, "reload");
    return { config_dir: reply.config_dir, warnings };
  });
}

// What an import would change, for the consent screen. It stores nothing and runs no snippet.
export async function preview_config_import(source: unknown): Promise<ConfigImportPreview> {
  const incoming = await read_import_source(source);
  await get_config();
  const built_in_commands = commands_of_registry(registry).filter((command) => !snippets.is_snippet(command.id));
  return preview_import(incoming, (await load_files_source()).files, built_in_commands);
}

// Applies an import over the slot's raw files: its config files replace the ones in force, and only the snippets in `accepted` join the installed ones.
// The slot is read inside the queue, so an import after a reload builds on the reloaded files.
export function import_config(source: unknown, accepted: unknown): Promise<{ warnings: number; replaces_config: boolean; snippets: number }> {
  const reading = read_import_source(source);
  // Settled here too, so a refused read is not an unhandled rejection while the queue waits.
  reading.catch(() => undefined);
  return in_change_queue(async () => {
    const incoming = await reading;
    const consented = checked_consent(incoming, accepted);
    if (imports_nothing(incoming, consented)) throw new ConfigRefusal(`${KEPT_CURRENT.import} The import holds no config files and no snippet was accepted.`);
    const current = await load_files_source();
    const { files, replaces_config } = plan_import_files(incoming, current.files, consented);
    const { warnings } = await apply_files(files, replaces_config ? IMPORT_DIR_LABEL : current.dir_label, "import");
    return { warnings, replaces_config, snippets: Object.keys(consented).length };
  });
}

// Drops one installed snippet from the slot's raw files and rebuilds. A key that binds it makes the build refuse, and the snippet stays.
export function remove_snippet(path: string): Promise<{ warnings: number }> {
  return in_change_queue(async () => {
    const current = await load_files_source();
    if (!path.startsWith("snippets/") || !Object.hasOwn(current.files, path)) throw new ConfigRefusal(`${KEPT_CURRENT.remove} No snippet ${path} is installed.`);
    const { [path]: _removed, ...files } = current.files;
    return apply_files(files, current.dir_label, "remove");
  });
}

async function tell_tabs_tree_changed(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? undefined : browser.tabs.sendMessage(tab.id, { type: "tree_updated" }).catch(() => undefined))),
  );
}
