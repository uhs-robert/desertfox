import type { Handlers } from "./message_table.ts";
import { page_refusal } from "./message_table.ts";
import type { PageRequests } from "../shared/messages/map.ts";
import { refused_as } from "../shared/swallow.ts";
import { answer_site_keys_request } from "./site_keys.ts";
import { answer_config_import } from "./config_import.ts";
import { answer_config_transfer } from "./config_transfer.ts";
import { answer_config_files } from "./config_files.ts";
import { answer_host_start_choice } from "./host_start.ts";
import { answer_sessions_transfer } from "./sessions_transfer.ts";
import { answer_toolbar_request } from "./toolbar.ts";
import {
  browser_session_storage,
  make_session_store,
} from "./session_store.ts";
import { exportable_key_edits } from "./keymap_message.ts";
import { dropped_warning } from "./engine_layer.ts";
import { outcome_note } from "./settings_file.ts";
import { load_edits, load_files_source } from "../shared/config/config_load.ts";
import { browser_quickmark_store } from "./quickmark_store.ts";
import type { FileWriteOutcome } from "./settings_file.ts";
import type { create_settings_messages } from "./settings_message.ts";
import type { create_keymap_messages } from "./keymap_message.ts";
import type { create_engine_messages } from "./engine_message.ts";
import type { create_alias_messages } from "./alias_message.ts";
import type { create_theme_messages } from "./theme_message.ts";
import type { create_quickmark_messages } from "./quickmark_message.ts";
import type { create_font_names } from "./font_names.ts";
import type { create_toolbar } from "./toolbar.ts";
import type {
  change_site_keys_in_file,
  change_site_rule_in_file,
  choose_host_start,
  import_config,
  preview_config_import,
  reload_config,
  remove_snippet,
  save_config_file,
} from "./config_main.ts";
import type { get_config, read_engine_state, read_keymap_state } from "./config_main.ts";

export type PageDeps = {
  get_config: typeof get_config;
  settings_messages: ReturnType<typeof create_settings_messages>;
  keymap_messages: ReturnType<typeof create_keymap_messages>;
  engine_messages: ReturnType<typeof create_engine_messages>;
  alias_messages: ReturnType<typeof create_alias_messages>;
  theme_messages: ReturnType<typeof create_theme_messages>;
  quickmark_messages: ReturnType<typeof create_quickmark_messages>;
  font_names: ReturnType<typeof create_font_names>;
  toolbar: ReturnType<typeof create_toolbar>;
  change_site_keys_in_file: typeof change_site_keys_in_file;
  change_site_rule_in_file: typeof change_site_rule_in_file;
  preview_config_import: typeof preview_config_import;
  import_config: typeof import_config;
  read_keymap_state: typeof read_keymap_state;
  read_engine_state: typeof read_engine_state;
  remove_snippet: typeof remove_snippet;
  save_config_file: typeof save_config_file;
  choose_host_start: typeof choose_host_start;
  reload_config: typeof reload_config;
};

// What became of settings.toml after a popup site change, as the end of its notice.
const site_rule_note = (outcome: FileWriteOutcome | { kind: "unchanged" }): string => (outcome.kind === "unchanged" ? "" : outcome_note(outcome));

// The messages the extension's own pages send, one entry per type. A sender that is no extension page gets `refused`.
export const page_handlers = (deps: PageDeps) => {
  const settings = page_refusal("change settings");
  const keys = page_refusal("change keys");
  const engines = page_refusal("change engines");
  const aliases = page_refusal("change aliases");
  const themes = page_refusal("change imported themes");
  const quickmarks = page_refusal("change quickmarks");
  const import_config_refusal = page_refusal("import a config");
  const snippets = page_refusal("export or change snippets");
  const sessions = page_refusal("export or import sessions");
  const toolbar = page_refusal("use the toolbar");
  const toolbar_deps = { toolbar: deps.toolbar, change_site_rule: async (url: string, action: Parameters<typeof deps.change_site_rule_in_file>[1]) => site_rule_note(await deps.change_site_rule_in_file(url, action)), reload_config: deps.reload_config };
  const import_deps = { preview: deps.preview_config_import, commit: deps.import_config };
  const transfer_deps = {
    read_files: async () => (await load_files_source()).files,
    read_saved: async () => (await load_edits()).saved,
    read_keymap_edits: async () => exportable_key_edits(await deps.read_keymap_state()),
    read_engine_edits: async () => {
      const state = await deps.read_engine_state();
      return { edits: state.kept, aliases: state.kept_aliases, skipped: state.dropped.map(dropped_warning) };
    },
    read_quickmarks: () => browser_quickmark_store.saved(false),
    remove: deps.remove_snippet,
  };
  return {
    change_setting: { from: "page", refused: settings, run: (request) => deps.get_config().then(() => deps.settings_messages.change(request)) },
    list_settings: { from: "page", refused: settings, run: () => deps.get_config().then(() => deps.settings_messages.list()) },
    site_keys: {
      from: "page",
      refused: page_refusal("change site rules"),
      run: (request) =>
        answer_site_keys_request(request, {
          change_site_keys: async (pattern, keys) => {
            const outcome = await deps.change_site_keys_in_file(pattern, keys);
            return outcome.kind === "unchanged" ? { unchanged: true } : { note: outcome_note(outcome) };
          },
        }),
    },
    list_font_names: {
      from: "page",
      refused: [],
      run: () => {
        // The cache answers at once. The refresh (it may wait on the host) lands for the next open.
        const cached = refused_as(deps.font_names.read(), []);
        void refused_as(deps.font_names.refresh(), undefined);
        return cached;
      },
    },
    list_bindings: { from: "page", refused: keys, run: () => deps.keymap_messages.list() },
    check_binding: { from: "page", refused: keys, run: (request) => deps.keymap_messages.check(request) },
    change_keymap: { from: "page", refused: keys, run: (request) => deps.keymap_messages.change(request) },
    list_engines: { from: "page", refused: engines, run: () => deps.engine_messages.list() },
    change_engines: { from: "page", refused: engines, run: (request) => deps.engine_messages.change(request) },
    list_aliases: { from: "page", refused: aliases, run: () => deps.alias_messages.list() },
    change_aliases: { from: "page", refused: aliases, run: (request) => deps.alias_messages.change(request) },
    list_imported_themes: { from: "page", refused: themes, run: () => deps.theme_messages.list() },
    change_imported_themes: { from: "page", refused: themes, run: (request) => deps.theme_messages.change(request) },
    list_quickmarks: { from: "page", refused: quickmarks, run: () => deps.quickmark_messages.list() },
    change_quickmarks: { from: "page", refused: quickmarks, run: (request) => deps.quickmark_messages.change(request) },
    preview_config_import: { from: "page", refused: import_config_refusal, run: (request) => answer_config_import(request, import_deps) },
    commit_config_import: { from: "page", refused: import_config_refusal, run: (request) => answer_config_import(request, import_deps) },
    export_config: { from: "page", refused: snippets, run: (request) => answer_config_transfer(request, transfer_deps) },
    list_snippets: { from: "page", refused: snippets, run: (request) => answer_config_transfer(request, transfer_deps) },
    remove_snippet: { from: "page", refused: snippets, run: (request) => answer_config_transfer(request, transfer_deps) },
    config_files: { from: "page", refused: page_refusal("edit the config files"), run: (request) => answer_config_files(request, { read_files: async () => (await load_files_source()).files, save: deps.save_config_file }) },
    host_start_choice: { from: "page", refused: page_refusal("answer the config folder question"), run: (request) => answer_host_start_choice(request, deps.choose_host_start) },
    export_sessions: { from: "page", refused: sessions, run: (request) => answer_sessions_transfer(request, make_session_store(browser_session_storage)) },
    import_sessions: { from: "page", refused: sessions, run: (request) => answer_sessions_transfer(request, make_session_store(browser_session_storage)) },
    toolbar_set_disabled: { from: "page", refused: toolbar, run: (request) => answer_toolbar_request(request, toolbar_deps) },
    toolbar_site: { from: "page", refused: toolbar, run: (request) => answer_toolbar_request(request, toolbar_deps) },
    toolbar_reload_config: { from: "page", refused: toolbar, run: (request) => answer_toolbar_request(request, toolbar_deps) },
  } satisfies Handlers<keyof PageRequests>;
};
