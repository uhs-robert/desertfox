// JSON Schemas for the data files, cut from `commands.json`, so an editor
// (Taplo reads them for TOML) completes command names and setting names.

import type { CommandMeta } from "../../src/shared/command.ts";
import { DEFAULT_SETTINGS, MODE_INDICATOR_VALUES, WHICH_KEY_BORDER_VALUES } from "../../src/shared/config.ts";
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
  const binding: Schema = { anyOf: [command_text, { type: "array", minItems: 1, items: { type: "string", minLength: 1 } }] };
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
      palette: { enum: [...PALETTE_NAMES], default: DEFAULT_SETTINGS.palette, description: "oasis.nvim palette for the mode badges. Light or dark follows the system theme" },
      search_prefixes: { ...prefix_pair_schema("here"), default: DEFAULT_SETTINGS.search_prefixes },
      container_prefixes: { ...prefix_pair_schema("reopen"), default: DEFAULT_SETTINGS.container_prefixes },
      home_page: { type: "string", minLength: 1, description: "URL that page.home opens" },
      default_engine: {
        type: "string",
        minLength: 1,
        default: DEFAULT_SETTINGS.default_engine,
        description: "Search engine that open.clipboard uses for text that is not a URL. Must name a defined engine",
      },
      new_tab_page: { type: "string", description: "Reserved" },
    },
    additionalProperties: false,
  };
}

export function build_schemas(commands: CommandMeta[]): Record<DataKind, Schema> {
  return {
    keymap: keymap_schema(commands),
    search_engines: {
      $schema: DRAFT,
      title: "OasisFox search engines",
      type: "object",
      additionalProperties: {
        type: "object",
        properties: { url: { type: "string", minLength: 1 }, label: { type: "string", minLength: 1 } },
        required: ["url", "label"],
        additionalProperties: false,
      },
    },
    command_aliases: {
      $schema: DRAFT,
      title: "OasisFox command aliases",
      type: "object",
      additionalProperties: { type: "string", examples: commands.map((command) => command.id) },
    },
    settings: settings_schema(),
  };
}
