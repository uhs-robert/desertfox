// JSON Schemas for the data files, cut from `commands.json`, so an editor
// (Taplo reads them for TOML) completes command names and setting names.

import type { CommandMeta } from "../../src/shared/command.ts";
import { SETTING_DOCS } from "../../src/shared/settings_docs.ts";
import { SETTINGS_TABLE, type SettingName, type SettingRow } from "../../src/shared/settings_table.ts";
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
    title: "DesertFox keymap",
    type: "object",
    properties: {
      ...Object.fromEntries(KEYMAP_MODES.map((mode) => [mode, mode_bindings])),
      search_keys: { ...string_map, description: "Last key to search engine name" },
      container_keys: { ...string_map, description: "Last key to container name" },
      site_keys: {
        type: "object",
        description: "Last key to the search engines it uses, one per site. s/<key> searches with the first engine whose hosts list the page",
        additionalProperties: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
      },
      modifiers: {
        type: "object",
        description: "Key sequence of a modifier to the args it adds to a variant of each key in its group, for example ;r = { rapid = true }. label names the group",
        additionalProperties: {
          type: "object",
          properties: { label: { type: "string", minLength: 1 } },
          additionalProperties: { type: ["string", "number", "boolean"] },
          minProperties: 1,
        },
      },
      group_names: { ...string_map, description: "Key sequence of a group to the name which-key shows for it" },
    },
    additionalProperties: false,
  };
}

const non_empty_text: Schema = { type: "string", minLength: 1 };

function value_schema(row: SettingRow): Schema {
  switch (row.kind) {
    case "boolean":
      return { type: "boolean" };
    case "enum":
      return { enum: [...row.values] };
    case "number":
      return { type: row.whole ? "integer" : "number", minimum: row.min };
    case "text":
      return non_empty_text;
    case "line":
      return { type: "string", minLength: row.min_length, maxLength: row.max_length, pattern: "^[^\\r\\n]+$" };
    case "text_list":
      return { type: "array", items: non_empty_text };
    case "enum_list":
      return { type: "array", items: { enum: [...row.values] }, uniqueItems: true };
    case "text_table":
      return { type: "object", properties: Object.fromEntries(row.keys.map((key) => [key, non_empty_text])), required: [...row.keys], additionalProperties: false };
    case "table_list": {
      // A JSON Schema `pattern` has no case flag, so it refuses an upper-case scheme that the check takes.
      const field_schema = (value: "text" | "web_url"): Schema => (value === "web_url" ? { type: "string", pattern: "^https?://\\S+$" } : non_empty_text);
      return {
        type: "array",
        items: {
          type: "object",
          properties: Object.fromEntries(Object.entries(row.fields).map(([field, rule]) => [field, field_schema(rule.value)])),
          required: Object.entries(row.fields).filter(([, rule]) => !rule.optional).map(([field]) => field),
          additionalProperties: false,
        },
      };
    }
    case "custom":
      return row.schema;
  }
}

function setting_schema(name: SettingName): Schema {
  const row: SettingRow = SETTINGS_TABLE[name];
  return { ...value_schema(row), ...("default" in row && { default: row.default }), description: SETTING_DOCS[name] };
}

export function settings_schema(): Schema {
  return {
    $schema: DRAFT,
    title: "DesertFox settings",
    type: "object",
    properties: Object.fromEntries((Object.keys(SETTINGS_TABLE) as SettingName[]).map((name) => [name, setting_schema(name)])),
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
  return { $schema: DRAFT, title: "DesertFox search engines", type: "object", additionalProperties: engine };
}

export function build_schemas(commands: CommandMeta[]): Record<DataKind, Schema> {
  return {
    keymap: keymap_schema(commands),
    search_engines: search_engines_schema(),
    command_aliases: {
      $schema: DRAFT,
      title: "DesertFox command aliases",
      type: "object",
      additionalProperties: { type: "string", examples: commands.map((command) => command.id) },
    },
    settings: settings_schema(),
  };
}
