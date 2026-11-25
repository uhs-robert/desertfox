// JSON Schemas for the data files, cut from `commands.json`, so an editor
// (Taplo reads them for TOML) completes command names and setting names.

import type { CommandMeta } from "../command.ts";
import { MAX_QUICKMARK_URL_CHARS, QUICKMARK_KEY } from "../quickmark_names.ts";
import { DEFAULT_KEYMAP } from "../keys/default_keymap.ts";
import { resolve_key_docs } from "../key_docs.ts";
import { compile_keymap } from "../keys/compiler.ts";
import { SETTING_DOCS, SETTING_HELP } from "../settings_docs.ts";
import { PER_SITE_SETTING_NAMES } from "../settings_schema.ts";
import { MAX_BIND_CHOICES, MAX_BIND_STEPS } from "../table_constants.ts";
import { SETTINGS_TABLE, SITE_KEYMAP_MODES, type SettingName, type SettingRow } from "../settings_table.ts";
import { ENGINE_KEYWORD } from "../engines/resolve.ts";
import { KEYMAP_MODES } from "../keymap.ts";
import type { DataKind } from "../config_kinds.ts";

type Schema = Record<string, unknown>;

// What `label_problem` accepts: not blank after trimming and no control characters.
const ONE_LINE_TEXT: Schema = { type: "string", minLength: 1, pattern: "^(?!\\s*$)[^\\u0000-\\u001F\\u007F-\\u009F]*$" };

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
    description: "A binding with the label and the hover text which-key shows for it, instead of those of the command",
    properties: { run: { anyOf: [command_text, command_list] }, label: ONE_LINE_TEXT, intent: ONE_LINE_TEXT },
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
          properties: { label: ONE_LINE_TEXT },
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

const WHEN_FOCUS: Schema = { ...non_empty_text, description: "A CSS selector. The bind runs only while nothing has focus or the focused element sits on or inside a match, and the key runs the binding it replaced otherwise" };
const OTHERWISE: Schema = { enum: ["page"], description: "With \"page\", the key goes to the page when every guard fails, in place of the binding the bind replaced" };
const WHEN_PRESENT: Schema = { ...non_empty_text, description: "A CSS selector. The bind runs only while the page shows a match, and the key runs the next choice or the binding it replaced otherwise" };

// The formats of a keymap binding, plus the invocation table `{ id, args }` that the build stores and a saved edit exports.
const BIND_STEP: Schema = {
  anyOf: [non_empty_text, { type: "object", properties: { id: non_empty_text, args: { type: "object" }, prompt: { type: "object" }, label: ONE_LINE_TEXT, intent: ONE_LINE_TEXT, when_focus: WHEN_FOCUS, when_present: WHEN_PRESENT, otherwise: OTHERWISE }, required: ["id"], additionalProperties: false }],
};
const BIND_STEPS: Schema = { type: "array", minItems: 1, maxItems: MAX_BIND_STEPS, items: BIND_STEP };
const BIND_RUN: Schema = { type: "object", properties: { run: { anyOf: [BIND_STEP, BIND_STEPS] }, label: ONE_LINE_TEXT, intent: ONE_LINE_TEXT, when_focus: WHEN_FOCUS, when_present: WHEN_PRESENT, otherwise: OTHERWISE }, required: ["run"], additionalProperties: false };

const BINDINGS_SCHEMA: Schema = {
  type: "object",
  minProperties: 1,
  additionalProperties: {
    anyOf: [BIND_STEP, BIND_STEPS, BIND_RUN, { type: "array", minItems: 1, maxItems: MAX_BIND_CHOICES, items: { anyOf: [BIND_RUN, BIND_STEPS] }, description: "Choices, each guarded by when_present or when_focus: the first whose guards hold runs, else the binding it replaced" }],
  },
};

// One site mode: a badge label and a bind table.
const SITE_MODES_SCHEMA: Schema = {
  type: "object",
  minProperties: 1,
  propertyNames: { pattern: "^(?!off$)[a-z][a-z0-9_]*$" },
  additionalProperties: { type: "object", properties: { label: ONE_LINE_TEXT, bind: BINDINGS_SCHEMA, sticky: { type: "boolean" } }, required: ["label", "bind"], additionalProperties: false },
};

// A table of binds per keymap mode a site row can bind.
const MODE_BINDINGS_SCHEMA: Schema = {
  type: "object",
  minProperties: 1,
  properties: Object.fromEntries(SITE_KEYMAP_MODES.map((mode) => [mode, BINDINGS_SCHEMA])),
  additionalProperties: false,
};

type TableFields = Extract<SettingRow, { kind: "table_list" }>["fields"];

// `columns` holds the schema of each extra column a row may set: the per-site settings of a site table.
function table_list_schema(fields: TableFields, exclusive: readonly string[] | undefined, columns: Record<string, Schema>): Schema {
  // A JSON Schema `pattern` has no case flag, so it refuses an upper-case scheme that the check takes.
  const field_schema = (value: TableFields[string]["value"]): Schema => (value === "web_url" ? { type: "string", pattern: "^https?://\\S+$" } : value === "boolean" ? { type: "boolean" } : value === "bindings" ? BINDINGS_SCHEMA : value === "site_modes" ? SITE_MODES_SCHEMA : value === "mode_bindings" ? MODE_BINDINGS_SCHEMA : non_empty_text);
  return {
    type: "array",
    items: {
      type: "object",
      properties: { ...Object.fromEntries(Object.entries(fields).map(([field, rule]) => [field, field_schema(rule.value)])), ...columns },
      required: Object.entries(fields).filter(([, rule]) => !rule.optional).map(([field]) => field),
      additionalProperties: false,
      // Exactly two exclusive fields: `not` with `required` refuses a table that sets both.
      ...(exclusive?.length === 2 ? { not: { required: [...exclusive] } } : {}),
    },
  };
}

function value_schema(row: SettingRow): Schema {
  switch (row.kind) {
    case "boolean":
      return { type: "boolean" };
    case "enum":
      return { enum: [...row.values] };
    case "number":
      return { type: row.whole ? "integer" : "number", minimum: row.min, ...(row.max === undefined ? {} : { maximum: row.max }) };
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
    case "table_list":
      return table_list_schema(row.fields, row.exclusive, {});
    case "site_table":
      return table_list_schema(row.fields, row.exclusive, Object.fromEntries(PER_SITE_SETTING_NAMES.map((name) => [name, value_schema(SETTINGS_TABLE[name])])));
    case "custom":
      return row.schema;
  }
}

// The long text leans on the summary for its subject, so an editor tooltip without the summary starts mid-thought.
function setting_schema(name: SettingName, keys: (text: string) => string): Schema {
  const row: SettingRow = SETTINGS_TABLE[name];
  return { ...value_schema(row), ...("default" in row && { default: row.default }), description: keys(`${SETTING_HELP[name].summary} ${SETTING_DOCS[name]}`) };
}

// An editor has no live keymap, so the prose names the keys the add-on ships with.
function default_key_docs(commands: CommandMeta[]): (text: string) => string {
  const { compiled } = compile_keymap(DEFAULT_KEYMAP, {}, (id) => {
    const command = commands.find((candidate) => candidate.id === id);
    return command && { runs_in: "content" as const, label: command.label, count: command.count ?? "ignore", params: command.params ?? [] };
  });
  return (text) => resolve_key_docs(text, compiled, commands, true);
}

export function settings_schema(commands: CommandMeta[]): Schema {
  const keys = default_key_docs(commands);
  return {
    $schema: DRAFT,
    title: "DesertFox settings",
    type: "object",
    properties: Object.fromEntries((Object.keys(SETTINGS_TABLE) as SettingName[]).map((name) => [name, setting_schema(name, keys)])),
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
      keyword: { type: "string", pattern: ENGINE_KEYWORD.source, description: "Short word, unique across engines. The open-anything finder uses it. Children do not inherit it" },
      reverse: { type: "string", minLength: 1, maxLength: 200, description: "Regular expression with one capture group, matched against the whole results page address, that reads the query back. Only needed when the url template cannot say it. Children do not inherit it" },
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
    quickmarks: {
      $schema: DRAFT,
      title: "DesertFox quickmarks",
      type: "object",
      patternProperties: { [QUICKMARK_KEY.source]: { type: "string", minLength: 1, maxLength: MAX_QUICKMARK_URL_CHARS, description: "The address `go<key>` and `gn<key>` open" } },
      additionalProperties: false,
    },
    settings: settings_schema(commands),
  };
}
