// The wiring of the config modules into one service, and the production instances. `config_store.ts` holds the store alone.
import { create_config_swap } from "./config_swap.ts";
import { create_config_file_writes } from "./config_file_writes.ts";
import { create_config_setting_writes } from "./config_setting_writes.ts";
import { create_config_start } from "./config_start.ts";
import { create_config_store } from "./config_store.ts";
import type { ConfigStore } from "./config_store.ts";
import { create_services } from "./services.ts";
import type { Services } from "./services.ts";

// The caller passes the store and the services, so a test builds its own instance and a production start shares the store with the commands.
export function create_config_service(parts: { store: ConfigStore; services: Services }) {
  const { store, services } = parts;
  const { snippets, host_update, native_host } = services;
  // The swap takes `note_record_dropped` from the pipeline, and the pipeline calls `apply_files` of the swap, so the pipeline reads the swap late.
  const file_writes = create_config_file_writes({ store, services, swap: () => swap });
  const swap = create_config_swap(store, { snippets, note_record_dropped: file_writes.note_record_dropped });
  const setting_writes = create_config_setting_writes({ store, swap, file_writes });
  const start = create_config_start({ store, services, swap, file_writes, setting_writes });

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
    ...start,
  };
}

export type ConfigService = ReturnType<typeof create_config_service>;

// The production instances. The services need `get_config` and the store needs the services, so the reader is passed late.
export const services = create_services({ get_config: () => config_store.get_config() });
export const config_store = create_config_store(services);
const service = create_config_service({ store: config_store, services });
export const { snippets, host_update, native_host, get_config, get_search_engine_names, change_edits, change_layers, read_settings_layers, read_keymap_state, read_engine_state, read_stored_files, read_alias_state, republish, set_desktop_theme } = service;
export const { import_config, preview_config_import, remove_snippet, save_config_file, set_in_settings_file, toggle_in_settings_file, unset_in_settings_file, change_site_rule_in_file, change_site_keys_in_file, set_theme_file, change_engine_file, reload_config, reload_config_at_start, choose_host_start } = service;
