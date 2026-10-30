// JSON Schemas for the data files, cut from `commands.json`, so an editor
// completes command ids, args and setting names.

import type { CommandMeta, ParamDef } from "../../src/shared/command.ts";
import { COMMAND_ID_PATTERN } from "../../src/shared/registry/index.ts";
import { DEFAULT_SETTINGS } from "../../src/shared/config.ts";
import { KEYMAP_MODES } from "./merge.ts";
import type { DataKind } from "./source_files.ts";

type Schema = Record<string, unknown>;

const DRAFT = "http://json-schema.org/draft-07/schema#";

function param_schema(param: ParamDef): Schema {
  const context_source: Schema = {
    type: "object",
    properties: { from: { enum: ["current_url", "selection", "clipboard"] } },
    required: ["from"],
    additionalProperties: false,
  };
  let value_schema: Schema;
  switch (param.type) {
    case "int":
      value_schema = { type: "integer" };
      break;
    case "float":
      value_schema = { type: "number" };
      break;
    case "bool":
      value_schema = { type: "boolean" };
      break;
    case "enum":
    case "string":
      value_schema = Array.isArray(param.values) && param.type === "enum" ? { enum: param.values } : { type: "string" };
      break;
  }
  const schema = param.type === "string" ? { anyOf: [value_schema, context_source] } : value_schema;
  return { ...schema, description: param.name };
}

function prompt_schema(param_names: string[] | undefined): Schema {
  return {
    type: "object",
    description: "Phase 2: the key opens the command line with this command typed in and this param to fill",
    properties: {
      param: param_names ? { enum: param_names } : { type: "string" },
      prefill: {
        type: "object",
        description: "Text the prompt starts with",
        properties: { from: { enum: ["current_url", "selection", "clipboard"] } },
        required: ["from"],
        additionalProperties: false,
      },
    },
    required: ["param"],
    additionalProperties: false,
  };
}

function invocation_schema(command: CommandMeta): Schema {
  const properties = Object.fromEntries((command.params ?? []).map((param) => [param.name, param_schema(param)]));
  return {
    type: "object",
    description: command.intent,
    properties: {
      id: { const: command.id },
      args: { type: "object", properties, additionalProperties: false },
      count: { type: "integer", minimum: 1 },
      prompt: prompt_schema((command.params ?? []).map((param) => param.name)),
    },
    required: ["id"],
    additionalProperties: false,
  };
}

function keymap_schema(commands: CommandMeta[]): Schema {
  const snippet_invocation: Schema = {
    type: "object",
    description: "A snippet command",
    properties: {
      id: { type: "string", pattern: COMMAND_ID_PATTERN.source },
      args: { type: "object" },
      count: { type: "integer", minimum: 1 },
      prompt: prompt_schema(undefined),
    },
    required: ["id"],
    additionalProperties: false,
  };
  const invocation: Schema = { oneOf: [...commands.map(invocation_schema), snippet_invocation] };
  const binding: Schema = { anyOf: [{ type: "null" }, invocation, { type: "array", items: invocation }] };
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
    },
    additionalProperties: false,
  };
}

function prefix_pair_schema(first_key: string): Schema {
  const prefix = { type: "string", minLength: 1 };
  return { type: "object", properties: { [first_key]: prefix, new_tab: prefix }, required: [first_key, "new_tab"], additionalProperties: false };
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
