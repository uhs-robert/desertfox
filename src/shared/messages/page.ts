// Messages that extension pages (settings, popup, help) send to the background with `runtime.sendMessage`. The background refuses any sender that is not an extension page.

import type { SettingTag } from "../setting_list.ts";
import type { SettingRow } from "../settings_table.ts";
import type { KeymapMode } from "../keymap.ts";

// From an extension page (the settings page, the popup): sets or resets one setting. `value` is the typed value, checked by the setting's own check. `layer` defaults to `saved`, which a set reaches only for a consent setting. A reset drops the saved and the temp edit.
// `file` writes the value into settings.toml (the browser copy, then the folder through the native host), or for a reset removes the key there, and drops the saved and temp edits of it. Only the names in `FILE_WRITTEN_SETTINGS` take it.
// The answer is a ChangeSettingAnswer. The background refuses any sender that is not an extension page.
export type ChangeSetting = {
  type: "change_setting";
  name: string;
  action: "set" | "reset";
  value?: unknown;
  layer?: "saved" | "temp" | "file";
};

// From an extension page: asks for every setting. The answer is a ListSettingsAnswer.
export type ListSettings = {
  type: "list_settings";
};

// From an extension page (the settings page): asks for the font names (`string[]`). The background answers from its cache and then reads the host's fonts again and probes, for the next ask.
export type ListFontNames = {
  type: "list_font_names";
};

// `kind` is the row kind in `settings_table.ts`. `allowed` is the typed choice list of an enum or enum list, or the values the command line suggests. `value` is absent for a setting with no default that nothing sets.
export type SettingListRow = {
  name: string;
  value?: unknown;
  top_layer: SettingTag | "default";
  kind: SettingRow["kind"];
  settable: boolean;
  expectation: string;
  allowed?: unknown[];
};

// `message` is the line `:set` would toast, including a warning that a default engine or theme names nothing.
export type ChangeSettingAnswer = { ok: true; setting: SettingListRow; message: string } | { ok: false; message: string };

export type ListSettingsAnswer = { ok: true; settings: SettingListRow[] } | { ok: false; message: string };

// One key binding as the key editor lists it. `text` is the command as keymap.toml writes it, empty for a removed binding. `origin` names the layer that decides it: the shipped default, the config files, a browser edit, or an unbind by either. `default_text` is the shipped binding a file or edit replaced.
// `skipped` is set on an edit the compile dropped: the warning that says why. The binding under it runs instead.
export type BindingRow = { mode: KeymapMode; keys: string; text: string; origin: "default" | "file" | "edit" | "removed"; default_text?: string; skipped?: string };

// From an extension page: every binding of every mode, except the ones generators make (`search_keys` and the like). The answer is a ListBindingsAnswer.
export type ListBindings = { type: "list_bindings" };
export type ListBindingsAnswer = { ok: true; bindings: BindingRow[] } | { ok: false; message: string };

// From an extension page: what saving `text` on `keys` would do. Nothing is stored. `text` "" checks an unbind.
// `problems` are reasons the text or keys do not read. `warnings` are the compile warnings the binding adds. `shadows` are the bindings it replaces or drops.
// `saves` is false when a save would be refused: the text does not read, or the compile skips the binding (a warning says why). `ok` false means the check itself failed.
// `move_from` names the keys the row had, when the save moves it: the old key is freed first, as a `change_keymap` set with the same field does.
export type CheckBinding = { type: "check_binding"; mode: KeymapMode; keys: string; text: string; move_from?: string };
// `keys` is the sequence in the spelling the background stores, absent when the sequence does not parse.
export type CheckBindingAnswer = { ok: true; saves: boolean; problems: string[]; warnings: string[]; shadows: { keys: string; text: string }[]; keys?: string } | { ok: false; message: string };

// From an extension page: one key edit. A set with `move_from` is a move. `move_from_text` is the text the row showed on the old key: the change refuses the move when the old key holds other text by then. `set` binds `text`, `remove` unbinds the key, `reset` drops the edit so the file or default binding shows again.
// The answer carries the row after the change, absent when the key is then unbound. A refused set carries the check's problems and warnings.
export type ChangeKeymap = { type: "change_keymap"; mode: KeymapMode; keys: string; action: "set" | "remove" | "reset"; text?: string; move_from?: string; move_from_text?: string };
// The refusal of a move whose old key changed, after the old keys. The settings page spots it to let the row open again and move.
export const STALE_MOVE_REFUSAL = "changed since you opened it. Open the row again.";
export type ChangeKeymapAnswer = { ok: true; row?: BindingRow; message: string } | { ok: false; message: string; problems?: string[] };

// One engine the settings page added, as the Search engines section lists it. A table of search_engines.d/zz-desertfox.toml, or of the browser layer an older version kept, children inside it counted. `url` is empty for a table that holds only children. `letter` is the key letter that searches it. `left_out` is the reason the build dropped it after a files edit: it then runs nowhere.
export type EngineRow = { name: string; url: string; label: string; keyword?: string; letter?: string; children: number; left_out?: string };

// From an extension page: the engines the settings page added. The answer is a ListEnginesAnswer.
export type ListEngines = { type: "list_engines" };
export type ListEnginesAnswer = { ok: true; engines: EngineRow[] } | { ok: false; message: string };

// From an extension page: one change of the page's engines, which go to search_engines.d/zz-desertfox.toml. `set` adds an engine, or replaces the one of that name. `remove` drops one. `starter` adds the sample engines whose names no file or layer table holds yet.
// The background builds the config with the change and refuses it, with every problem, when the build does, before anything is stored.
export type ChangeEngines =
  | { type: "change_engines"; action: "set"; name: string; url: string; keyword?: string; letter?: string }
  | { type: "change_engines"; action: "remove"; name: string }
  | { type: "change_engines"; action: "starter" };
export type ChangeEnginesAnswer = { ok: true; message: string } | { ok: false; message: string; problems?: string[] };

// One alias the settings page added, as the Aliases section lists it. `left_out` is the reason the build dropped it after a files edit: it then runs nowhere.
export type AliasRow = { name: string; target: string; left_out?: string };
export type ListAliases = { type: "list_aliases" };
export type ListAliasesAnswer = { ok: true; aliases: AliasRow[] } | { ok: false; message: string };

// From an extension page: one change of the aliases layer. `set` adds an alias or replaces the one of that name. `remove` drops one. The background builds the config with the change and refuses it, with every problem, when the build does.
export type ChangeAliases = { type: "change_aliases"; action: "set"; name: string; target: string } | { type: "change_aliases"; action: "remove"; name: string };
export type ChangeAliasesAnswer = { ok: true; message: string } | { ok: false; message: string; problems?: string[] };

// One quickmark of a normal window. `saved` is false for an entry that only quickmarks.toml holds: the form can replace it with a saved one but not remove it.
export type QuickmarkRow = { key: string; url: string; saved: boolean };
export type ListQuickmarks = { type: "list_quickmarks" };
export type ListQuickmarksAnswer = { ok: true; quickmarks: QuickmarkRow[] } | { ok: false; message: string };

// From an extension page: one change of the quickmarks saved in a normal window, the store `M` writes.
export type ChangeQuickmarks = { type: "change_quickmarks"; action: "set"; key: string; url: string } | { type: "change_quickmarks"; action: "remove"; key: string };
export type ChangeQuickmarksAnswer = { ok: true; message: string } | { ok: false; message: string };

// From an extension page: the themes the base16 importer saved, for the list under the theme picker.
export type ListImportedThemes = { type: "list_imported_themes" };
// `names` can be removed through the native host. `kept_names` are theme files whose names the host does not write, which only a hand edit of the folder removes.
export type ListImportedThemesAnswer = { ok: true; names: string[]; kept_names?: string[] } | { ok: false; message: string };

// From an extension page: saves the scheme in `text` as `themes/<name>.toml`, or removes that theme file. The background parses the text itself, so a page cannot store a theme the parser would refuse.
// A save over an existing name is refused with `needs_replace` until the request says `replace: true`, so the page can ask first.
export type ChangeImportedThemes = { type: "change_imported_themes"; action: "save"; name: string; text: string; replace?: boolean } | { type: "change_imported_themes"; action: "remove"; name: string };
export type ChangeImportedThemesAnswer = { ok: true; message: string } | { ok: false; message: string; needs_replace?: true };

// What the toolbar popup asks. Only a top-level extension page may send them.
export type ToolbarRequest =
  | { type: "toolbar_set_disabled"; disabled: boolean }
  // `url` is the tab's address. The background derives the match pattern from it.
  | { type: "toolbar_site"; url: string; action: "disable" | "enable" }
  | { type: "toolbar_reload_config" };

export type ToolbarAnswer = { ok: true; message: string } | { ok: false; message: string };

// From the Settings page: keep `keys` (key sequences in keymap notation, separated by spaces) for the sites `pattern` covers, or with `keys` null stop keeping any. The answer is a ToolbarAnswer.
export type SiteKeysRequest = { type: "site_keys"; pattern: string; keys: string | null };

// The user's pick for an import: a zip's bytes, or the files of a `webkitdirectory` folder as read by the page, with paths relative to the picked folder's parent.
export type ImportSource = { kind: "zip"; bytes: Uint8Array | ArrayBuffer } | { kind: "folder"; entries: { path: string; text: string }[] };

// From an extension page: reads an import and says what it would change. Nothing is stored and no snippet runs. The answer is a ConfigImportPreview.
export type PreviewConfigImport = { type: "preview_config_import"; source: ImportSource };

// From an extension page: applies an import. `accepted` maps each snippet path the user accepted to the code the preview showed. Any other snippet is left out. The answer is a ConfigImportAnswer.
export type CommitConfigImport = { type: "commit_config_import"; source: ImportSource; accepted: Record<string, string> };

// One snippet of an import as the consent screen shows it. The header fields are absent when the header does not parse.
export type SnippetPreview = {
  path: string;
  code: string;
  // A snippet with this path is installed, and accepting replaces it.
  replaces: boolean;
  problems: string[];
  id?: string;
  label?: string;
  intent?: string;
  matches?: string[];
  requires?: string[];
};

// A list the consent screen shows in two parts: the first rows, and the `rest` behind a fold. Nothing is dropped.
export type ReachList<T> = { rows: T[]; rest: T[] };
export type ReachRow = { what: string; url: string };
export type KeyGroup = "clipboard_or_page" | "settings" | "host";
// `consent` is set when the key names a setting that an import cannot switch on by itself: `switch_on` when the key can turn it on, `change` for any other write.
export type KeyRow = { where: string; keys: string; run: string; consent?: "switch_on" | "change" };
// What the built import reaches: the addresses it adds, the risky keys by group, and how many site rows add keys of their own.
export type ImportReach = { addresses: ReachList<ReachRow>; keys: Record<KeyGroup, ReachList<KeyRow>>; site_rows: number };

// `replaces_config` says the import holds config files, which replace every config file in force. `problems` come from a build with every snippet accepted: the commit refuses while any remain.
export type ConfigImportPreview =
  | { ok: true; replaces_config: boolean; config_files: string[]; snippets: SnippetPreview[]; problems: string[]; warnings: string[]; reach: ImportReach }
  | { ok: false; message: string };

export type ConfigImportAnswer = { ok: true; message: string } | { ok: false; message: string };

// From an extension page: the files an export writes, raw. The page builds the two zips. `config_files` holds the config files and the saved browser edits as TOML, `snippet_files` the installed snippets, both keyed by their path in the zip.
export type ExportConfig = { type: "export_config" };
// `skipped_key_edits` names the key edits left out because their text no longer reads, so an import does not refuse the whole config over them. `skipped_engine_edits` does the same for the engines and aliases the build dropped.
export type ExportConfigAnswer = { ok: true; config_files: Record<string, string>; snippet_files: Record<string, string>; skipped_key_edits?: string[]; skipped_engine_edits?: string[] } | { ok: false; message: string };

// From an extension page: the installed snippets for the list on the settings page. The header fields are absent when the header does not parse.
export type ListSnippets = { type: "list_snippets" };
export type InstalledSnippet = { path: string; problems: string[]; id?: string; label?: string; intent?: string; matches?: string[]; requires?: string[] };
export type ListSnippetsAnswer = { ok: true; snippets: InstalledSnippet[] } | { ok: false; message: string };

// From an extension page: removes one installed snippet and rebuilds the config without it. The answer is a ConfigImportAnswer.
export type RemoveSnippet = { type: "remove_snippet"; path: string };

// From an extension page: the saved tab sessions as the text of `desertfox-sessions.json`. `count` is 0 when none is saved.
export type ExportSessions = { type: "export_sessions" };
export type ExportSessionsAnswer = { ok: true; json: string; count: number } | { ok: false; message: string };

// From an extension page: adds the sessions of an export file. A name that is taken keeps both, and the import gets a suffix. The answer is a ConfigImportAnswer.
export type ImportSessions = { type: "import_sessions"; text: string };

// From an extension page: the stored config files for the editor, or one save of them. `text: null` deletes the file. `base` is the stored text the editor read (null for a file it saw as absent): the save is refused when the stored text differs now. A snippet is stored only when `accepted` holds the exact code, as the consent screen showed it, so the first save of a snippet answers with `consent` instead.
export type ConfigFilesRequest = { type: "config_files"; op: "read" } | { type: "config_files"; op: "save"; path: string; text: string | null; base: string | null; accepted?: string };
// `problems` holds every build problem of a refused save, not only the few the message names.
export type ConfigFilesAnswer =
  | { ok: true; files: Record<string, string> }
  | { ok: true; message: string }
  | { ok: false; message: string; problems?: string[] }
  | { ok: false; message: string; consent: SnippetPreview };

// What the background found at start when the native host's config folder differs from the browser copy of the files. Stored in `storage.local` until the user chooses, a later start finds no difference, or any swap of the files.
// The digests name the compared files (without `autoconfig.toml`), so a choice made on an older view is refused. `changes` is per file, as seen from the browser copy: `replaced` differs, `added` is only in the folder, `removed` only in the browser copy.
export type HostFileChange = { path: string; kind: "replaced" | "added" | "removed" };
export type HostStartPending = { config_dir: string; host_digest: string; browser_digest: string; changes: HostFileChange[] };

// From an extension page: the user's answer to a pending host start. The digests are the ones the page showed.
export type HostStartChoice = { type: "host_start_choice"; choice: "use_folder" | "keep_browser"; host_digest: string; browser_digest: string };
export type HostStartChoiceAnswer = { ok: true; message: string } | { ok: false; message: string; problems?: string[] };

