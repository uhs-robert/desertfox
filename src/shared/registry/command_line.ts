// The one grammar for command text, shared by the command line and the config
// (`parse_binding.ts` adds the leading `:` on top). Values stay strings except
// switches and `@source` markers; `check_args` coerces them.

import type { CommandDef, ContextSourceName, ParamDef } from "../command.ts";
import type { Invocation } from "../invocation.ts";
import type { EnumSources } from "./check_args.ts";
import { CONTEXT_SOURCE_NAMES, is_dynamic_values, static_values } from "./params.ts";
import { usage_line } from "./usage.ts";

export type Token = {
  text: string;
  // Index in `text` of the first quoted or escaped character, or null when none was.
  // A quoted word is always free text, never a param name, switch, value word or @source.
  quoted_from: number | null;
};

// Shell rules: single quotes are literal, double quotes allow \" \\ \$ and \`,
// a backslash outside quotes escapes the next character.
export function tokenize(text: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  let current: Token | null = null;
  const start_quote = (): Token => {
    current ??= { text: "", quoted_from: null };
    current.quoted_from ??= current.text.length;
    return current;
  };
  const add = (char: string): void => {
    current ??= { text: "", quoted_from: null };
    current.text += char;
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index] as string;
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = null;
      index += 1;
    } else if (char === "'") {
      const close = text.indexOf("'", index + 1);
      if (close < 0) return { error: "unterminated ' quote" };
      start_quote().text += text.slice(index + 1, close);
      index = close + 1;
    } else if (char === '"') {
      const quoted = start_quote();
      index += 1;
      for (;;) {
        const inner = text[index];
        if (inner === undefined) return { error: 'unterminated " quote' };
        if (inner === '"') break;
        if (inner === "\\" && '"\\$`'.includes(text[index + 1] ?? "")) index += 1;
        quoted.text += text[index];
        index += 1;
      }
      index += 1;
    } else if (char === "\\") {
      if (index + 1 >= text.length) return { error: "backslash at the end of the line" };
      start_quote().text += text[index + 1];
      index += 2;
    } else {
      add(char);
      index += 1;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

const PARAM_NAME_WORD = /^[a-z][a-z0-9_]*$/;
const NUMBER_WORD = /^-?\d+(\.\d+)?$/;

export type ParseResult =
  | { kind: "invocation"; invocation: Invocation; warnings?: string[] }
  | { kind: "help"; usage: string }
  | { kind: "error"; error: string };

// `sources` holds the runtime lists (search engines), the same ones `check_args`
// takes. Without a list, a bare word cannot pick a value from it.
// Only the lookup is needed, so a page without the registry can parse from `commands.json`.
export type CommandLookup = { find: (word: string) => ParsedCommand | undefined };
type ParsedCommand = Pick<CommandDef, "id" | "name" | "params">;

export function parse_command_line(registry: CommandLookup, text: string, sources: EnumSources = {}): ParseResult {
  const tokens = tokenize(text);
  if (!Array.isArray(tokens)) return { kind: "error", error: tokens.error };
  const [first, ...words] = tokens;
  if (!first) return { kind: "error", error: "empty command line" };
  const command = registry.find(first.text);
  if (!command) return { kind: "error", error: `unknown command "${first.text}"` };
  return parse_words(command, words, sources);
}

function parse_words(command: ParsedCommand, words: Token[], sources: EnumSources): ParseResult {
  const params = command.params ?? [];
  const command_word = command.name ?? command.id;
  const args: Record<string, unknown> = {};
  const warnings: string[] = [];
  const error = (message: string): ParseResult => ({ kind: "error", error: message });
  const main = params.find((param) => param.main);
  const number_params = params.filter((param) => param.type === "int" || param.type === "float");
  const only_number = number_params.length === 1 ? number_params[0] : undefined;

  for (const [index, word] of words.entries()) {
    if (word.quoted_from === null && (word.text === "-h" || word.text === "--help")) {
      return { kind: "help", usage: usage_line(command) };
    }

    const equals = word.text.indexOf("=");
    const name = equals > 0 ? word.text.slice(0, equals) : "";
    if (PARAM_NAME_WORD.test(name) && (word.quoted_from === null || word.quoted_from > equals)) {
      const param = params.find((candidate) => candidate.name === name);
      if (!param) return error(`unknown param "${name}" for ${command_word}`);
      if (Object.hasOwn(args, param.name)) return error(`${name} is set twice`);
      const value = value_of(word.text.slice(equals + 1), word.quoted_from === null);
      if (typeof value === "object" && "error" in value) return error(value.error);
      args[name] = value;
      continue;
    }

    if (word.quoted_from === null) {
      const named = params.filter((param) => word_names_param(param, word.text, sources));
      if (named.length > 1) return error(`"${word.text}" fits ${named.map((param) => param.name).join(" and ")}, write name=value`);
      const [param] = named;
      // A runtime list is open-ended, so once its param is set the word is more likely text.
      const taken_by_list = param !== undefined && Object.hasOwn(args, param.name) && is_dynamic_values(param.values);
      if (param && !taken_by_list) {
        if (Object.hasOwn(args, param.name)) return error(`${param.name} is set twice`);
        args[param.name] = param.type === "bool" ? true : word.text;
        continue;
      }
      if (only_number && !Object.hasOwn(args, only_number.name) && NUMBER_WORD.test(word.text)) {
        args[only_number.name] = word.text;
        continue;
      }
      if (taken_by_list && main) {
        warnings.push(`${main.name} starts with "${word.text}", which is also a value of ${param?.name}, write ${main.name}="..." to say so`);
      }
    }

    if (!main) {
      const hint = number_params.length > 1 ? `, a bare number needs a command with one number param, write name=value` : "";
      return error(`"${word.text}" is not a value, switch or param of ${command_word}${hint}`);
    }
    if (Object.hasOwn(args, main.name)) return error(`${main.name} is set twice, quote text that has spaces`);
    // The main value runs to the end of the line, so a query needs no quotes.
    const rest = words.slice(index);
    if (rest.length === 1) {
      const value = value_of(word.text, word.quoted_from === null);
      if (typeof value === "object" && "error" in value) return error(value.error);
      args[main.name] = value;
    } else if (word.quoted_from === null && word.text.startsWith("@")) {
      return error(`"${word.text}" is a source and cannot join other words, quote text that starts with @`);
    } else {
      args[main.name] = rest.map((token) => token.text).join(" ");
    }
    break;
  }

  const invocation: Invocation = { id: command.id };
  if (Object.keys(args).length > 0) invocation.args = args;
  return warnings.length > 0 ? { kind: "invocation", invocation, warnings } : { kind: "invocation", invocation };
}

// A bare word names a switch by its name and an enum param by one of its values.
function word_names_param(param: ParamDef, word: string, sources: EnumSources): boolean {
  if (param.type === "bool") return param.name === word;
  if (param.type !== "enum") return false;
  const values = is_dynamic_values(param.values) ? sources[param.values.from] : static_values(param);
  return values?.includes(word) ?? false;
}

// An unquoted `@name` is a context source the router fills in when the key is pressed.
function value_of(text: string, unquoted: boolean): string | { from: ContextSourceName } | { error: string } {
  if (!unquoted || !text.startsWith("@")) return text;
  const source = CONTEXT_SOURCE_NAMES.find((name) => name === text.slice(1));
  if (source) return { from: source };
  return { error: `unknown source "${text}" (known: ${CONTEXT_SOURCE_NAMES.map((name) => `@${name}`).join(", ")}), quote text that starts with @` };
}
