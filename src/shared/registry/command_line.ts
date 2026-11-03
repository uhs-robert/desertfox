// The one grammar for command text, shared by the command line and the config
// (`parse_binding.ts` adds the leading `:` on top). Values stay strings except
// `true` for a switch flag and `@source` markers; `check_args` coerces them.

import type { CommandDef, ContextSourceName, ParamDef } from "../command.ts";
import type { Invocation } from "../invocation.ts";
import type { EnumSources } from "./check_args.ts";
import { bare_word_param, CONTEXT_SOURCE_NAMES, is_dynamic_values, static_values } from "./params.ts";
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
  | { kind: "invocation"; invocation: Invocation }
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

// Flags come first, then the subject, which runs to the end of the line.
function parse_words(command: ParsedCommand, words: Token[], sources: EnumSources): ParseResult {
  const params = command.params ?? [];
  const command_word = command.name ?? command.id;
  const args: Record<string, unknown> = {};
  const error = (message: string): ParseResult => ({ kind: "error", error: message });
  const main = params.find((param) => param.main);
  const number_params = params.filter((param) => param.type === "int" || param.type === "float");
  const only_number = number_params.length === 1 ? number_params[0] : undefined;
  const bare_param = bare_word_param(command);
  let options_ended = false;
  // Only the first unmarked word can be the engine or the one required value.
  let bare_open = true;

  for (const [index, word] of words.entries()) {
    const unquoted = word.quoted_from === null;
    if (unquoted && !options_ended) {
      if (word.text === "-h" || word.text === "--help") return { kind: "help", usage: usage_line(command) };
      if (word.text === "--") {
        options_ended = true;
        continue;
      }
    }

    const number_param = only_number !== undefined && NUMBER_WORD.test(word.text) ? only_number : undefined;
    if (!options_ended && !number_param && looks_like_flag(word)) {
      const flag = read_flag(command_word, params, word);
      if ("error" in flag) return error(flag.error);
      if (Object.hasOwn(args, flag.param.name)) return error(`${flag.param.name} is set twice`);
      args[flag.param.name] = flag.value;
      continue;
    }

    if (unquoted && bare_open && !options_ended) {
      bare_open = false;
      if (bare_param && !Object.hasOwn(args, bare_param.name) && bare_word_values(bare_param, sources)?.includes(word.text)) {
        args[bare_param.name] = word.text;
        continue;
      }
    }
    if (unquoted && number_param && !Object.hasOwn(args, number_param.name)) {
      args[number_param.name] = word.text;
      continue;
    }

    if (!main) {
      const hint = number_params.length > 1 ? `, a bare number needs a command with one number param, write --name=value` : "";
      return error(`"${word.text}" is not a flag or subject of ${command_word}${hint}`);
    }
    if (Object.hasOwn(args, main.name)) return error(`${main.name} is set twice, quote text that has spaces`);
    const rest = words.slice(index);
    if (rest.length === 1) {
      const value = value_of(word.text, unquoted);
      if (typeof value === "object" && "error" in value) return error(value.error);
      args[main.name] = value;
    } else if (unquoted && word.text.startsWith("@")) {
      return error(`"${word.text}" is a source and cannot join other words, quote text that starts with @`);
    } else {
      args[main.name] = rest.map((token) => token.text).join(" ");
    }
    break;
  }

  const invocation: Invocation = { id: command.id };
  if (Object.keys(args).length > 0) invocation.args = args;
  return { kind: "invocation", invocation };
}

// The dash and the name must be unquoted. A quote may start only in the value after `=`.
function looks_like_flag(word: Token): boolean {
  if (word.text.length < 2 || !word.text.startsWith("-")) return false;
  if (word.quoted_from === null) return true;
  const equals = word.text.indexOf("=");
  return equals > 0 && word.quoted_from > equals;
}

type FlagResult = { param: ParamDef; value: unknown } | { error: string };

function read_flag(command_word: string, params: readonly ParamDef[], word: Token): FlagResult {
  const equals = word.text.indexOf("=");
  const head = equals < 0 ? word.text : word.text.slice(0, equals);
  const value_text = equals < 0 ? undefined : word.text.slice(equals + 1);
  const unknown = { error: `unknown flag "${head}" for ${command_word}, -h lists the flags` };
  const valued = (param: ParamDef, text: string): FlagResult => {
    const value = value_of(text, word.quoted_from === null);
    return typeof value === "object" && "error" in value ? value : { param, value };
  };

  if (head.startsWith("--")) {
    const name = head.slice(2);
    if (value_text !== undefined) {
      const param = PARAM_NAME_WORD.test(name) ? params.find((candidate) => candidate.name === name) : undefined;
      return param ? valued(param, value_text) : { error: `unknown param "${name}" for ${command_word}` };
    }
    const key = name.replaceAll("-", "_");
    const bool = params.find((param) => param.type === "bool" && param.name === key);
    if (bool) return { param: bool, value: true };
    const owner = params.find((param) => param.type === "enum" && static_values(param)?.includes(key));
    return owner ? { param: owner, value: key } : unknown;
  }

  const letter = head.slice(1);
  for (const param of params) {
    if (param.short === undefined) continue;
    if (typeof param.short === "string") {
      if (param.short !== letter) continue;
      if (param.type === "bool") return value_text === undefined ? { param, value: true } : { error: `${head} is a switch and takes no value` };
      return value_text === undefined ? { error: `${head} needs a value, write ${head}=VALUE` } : valued(param, value_text);
    }
    const value = Object.entries(param.short).find(([, short]) => short === letter)?.[0];
    if (value !== undefined) return value_text === undefined ? { param, value } : { error: `${head} takes no value` };
  }
  return unknown;
}

function bare_word_values(param: ParamDef, sources: EnumSources): readonly string[] | undefined {
  return is_dynamic_values(param.values) ? sources[param.values.from] : static_values(param);
}

// An unquoted `@name` is a context source the router fills in when the key is pressed.
function value_of(text: string, unquoted: boolean): string | { from: ContextSourceName } | { error: string } {
  if (!unquoted || !text.startsWith("@")) return text;
  const source = CONTEXT_SOURCE_NAMES.find((name) => name === text.slice(1));
  if (source) return { from: source };
  return { error: `unknown source "${text}" (known: ${CONTEXT_SOURCE_NAMES.map((name) => `@${name}`).join(", ")}), quote text that starts with @` };
}
