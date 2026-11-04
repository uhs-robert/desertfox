// JSON Schemas for the data files, cut from `commands.json`, so an editor
// (Taplo reads them for TOML) completes command names and setting names.

import type { CommandMeta } from "../../src/shared/command.ts";
import { BUILT_IN_PAGE, DEFAULT_SETTINGS, MODE_INDICATOR_VALUES, WHICH_KEY_BORDER_VALUES } from "../../src/shared/config.ts";
import { PALETTE_NAMES } from "../../src/shared/mode_colors.ts";
import { KEYMAP_MODES } from "./merge.ts";
import type { DataKind } from "./source_files.ts";

type Schema = Record<string, unknown>;

const DRAFT = "http://json-schema.org/draft-07/schema#";

// A binding is a command string, so the editor can offer the command names but
// cannot check the arguments. The build tool checks those.
function keymap_schema(commands: CommandMeta[]): Schema {
  const command_text: Schema = {
    type: "string",
    description: 'A command and its arguments, for example "open tab https://example.com". A leading ":" types it into the command line. "" removes a default binding',
    examples: commands.map((command) => command.name ?? command.id),
  };
  const command_list: Schema = { type: "array", minItems: 1, items: { type: "string", minLength: 1 } };
  const labeled_binding: Schema = {
    type: "object",
    description: "A binding with the label which-key shows for it, instead of the label derived from the command",
    properties: { run: { anyOf: [command_text, command_list] }, label: { type: "string", minLength: 1 } },
    required: ["run"],
    additionalProperties: false,
  };
  const binding: Schema = { anyOf: [command_text, command_list, labeled_binding] };
  const mode_bindings: Schema = { type: "object", additionalProperties: binding };
  const string_map: Schema = { type: "object", additionalProperties: { type: "string", minLength: 1 } };
  return {
    $schema: DRAFT,
    title: "OasisFox keymap",
    type: "object",
    properties: {
      ...Object.fromEntries(KEYMAP_MODES.map((mode) => [mode, mode_bindings])),
      search_keys: { ...string_map, description: "Last key to search engine name" },
      container_keys: { ...string_map, description: "Last key to container name" },
      group_names: { ...string_map, description: "Key sequence of a group to the name which-key shows for it" },
    },
    additionalProperties: false,
  };
}

function prefix_pair_schema(first_key: string): Schema {
  const prefix = { type: "string", minLength: 1 };
  return { type: "object", properties: { [first_key]: prefix, tab: prefix }, required: [first_key, "tab"], additionalProperties: false };
}

function settings_schema(): Schema {
  return {
    $schema: DRAFT,
    title: "OasisFox settings",
    type: "object",
    properties: {
      which_key_delay_ms: { type: "number", minimum: 0, default: DEFAULT_SETTINGS.which_key_delay_ms },
      hint_letters: { type: "string", minLength: 2, default: DEFAULT_SETTINGS.hint_letters },
      ignore_sites: { type: "array", items: { type: "string" }, description: "Match patterns where OasisFox starts in ignore mode" },
      which_key_border: { enum: [...WHICH_KEY_BORDER_VALUES], default: DEFAULT_SETTINGS.which_key_border, description: "Corner style of the which-key panel border" },
      mode_indicator: { enum: [...MODE_INDICATOR_VALUES], default: DEFAULT_SETTINGS.mode_indicator, description: "When the mode badge shows: always (NORMAL too), not_normal, or off" },
      palette: { type: "string", minLength: 1, examples: [...PALETTE_NAMES], default: DEFAULT_SETTINGS.palette, description: "Theme name: themes/<name>.toml in the config directory first, then a built-in theme. Light or dark follows the system theme" },
      search_prefixes: { ...prefix_pair_schema("here"), default: DEFAULT_SETTINGS.search_prefixes },
      container_prefixes: { ...prefix_pair_schema("reopen"), default: DEFAULT_SETTINGS.container_prefixes },
      home_page: { type: "string", minLength: 1, description: `URL that page.home opens, or "${BUILT_IN_PAGE}" for the built-in new tab page` },
      default_engine: {
        type: "string",
        minLength: 1,
        default: DEFAULT_SETTINGS.default_engine,
        description: "Search engine that open.clipboard uses for text that is not a URL. Must name a defined engine",
      },
      new_tab_page: { type: "string", pattern: `^(${BUILT_IN_PAGE}|https?://\\S+)$`, description: `What a new tab shows: an http or https URL that the new tab redirects to, or "${BUILT_IN_PAGE}" for the built-in page. Unset means the built-in page` },
      completion_all_windows: { type: "boolean", default: false, description: "Whether the tab completion lists the tabs of every window, not only the line's window" },
      cmdline_prompt: { type: "string", minLength: 1, maxLength: 8, pattern: "^[^\\r\\n]+$", default: "caret", description: "Before the command line input: \"caret\" for a bold > , \"colon\" for an accent :, or your own text (include the trailing space you want)" },
      open_completion: { type: "array", items: { enum: ["bookmarks", "history"] }, uniqueItems: true, description: "Groups that open completes from, in list order. A source left out is not read. Default is both" },
      history_completion_max: { type: "integer", minimum: 0, default: 10, description: "History rows that open completion shows for an empty word" },
      newtab_clock: { oneOf: [{ type: "boolean" }, { enum: ["analog", "digital"] }], default: true, description: "The new tab page clock: false hides it, true or \"analog\" shows the analog face, \"digital\" shows the seven-segment digits" },
      newtab_date: { type: "boolean", default: true, description: "Whether the new tab page shows the date under the clock" },
      newtab_clock_format: { enum: [12, 24], default: 12, description: "Hours on the digital clock: 12 with an AM or PM suffix, or 24. The analog clock ignores it" },
    },
    additionalProperties: false,
  };
}

// An engine table holds fields (strings, `params`, narrowing tables) and child engine tables. Taplo cannot tell a
// child from a narrowing, so the nested levels stay loose and the build tool checks them.
function search_engines_schema(): Schema {
  const engine: Schema = {
    type: "object",
    properties: {
      url: { type: "string", minLength: 1, description: "URL template. {query} is the typed or selected text, %s is the same. Page slots: {url}, {host}, {title}, {repo}, {subreddit}, {channel}. {a|b} takes the first that has a value, {name:raw} skips escaping" },
      label: { type: "string", minLength: 1 },
      fallback: { type: "string", minLength: 1, description: "Engine to use when the page cannot fill the slots" },
      params: { type: "object", description: "Params declared here, each { default, values, children }" },
    },
    additionalProperties: true,
  };
  return { $schema: DRAFT, title: "OasisFox search engines", type: "object", additionalProperties: engine };
}

export function build_schemas(commands: CommandMeta[]): Record<DataKind, Schema> {
  return {
    keymap: keymap_schema(commands),
    search_engines: search_engines_schema(),
    command_aliases: {
      $schema: DRAFT,
      title: "OasisFox command aliases",
      type: "object",
      additionalProperties: { type: "string", examples: commands.map((command) => command.id) },
    },
    settings: settings_schema(),
  };
}
