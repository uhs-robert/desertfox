// The one grammar for command text, shared by the command line and the config
// (`parse_binding.ts` adds the leading `:` on top). Values stay strings except
// `true` for a switch flag and `@source` markers; `check_args` coerces them.

import type { CommandDef, ContextSourceName, ParamDef } from "../command.ts";
import type { Invocation } from "../invocation.ts";
import type { EnumSources } from "./check_shape.ts";
import { bare_word_param, CONTEXT_SOURCE_NAMES, is_dynamic_values, positional_params, static_values } from "./params.ts";
import { usage_line } from "./usage.ts";

export type Token = {
  text: string;
  // Index in the tokenized text where the raw word begins, so a verbatim param can take the raw text from here.
  start: number;
  // Index in `text` of the first quoted or escaped character, or null when none was.
  // A quoted word is always free text, never a param name, switch, value word or @source.
  quoted_from: number | null;
};

type Read = { token: Token; end: number } | { error: string; start: number } | undefined;

// Reads the word that starts at or after `from`, or nothing at the end of the text.
// Shell rules: single quotes are literal, double quotes allow \" \\ \$ and \`,
// a backslash outside quotes escapes the next character.
function read_token(text: string, from: number): Read {
  let index = from;
  while (index < text.length && /\s/.test(text[index] as string)) index += 1;
  if (index >= text.length) return undefined;
  const token: Token = { text: "", quoted_from: null, start: index };
  const start_quote = (): Token => {
    token.quoted_from ??= token.text.length;
    return token;
  };
  while (index < text.length && !/\s/.test(text[index] as string)) {
    const char = text[index] as string;
    if (char === "'") {
      const close = text.indexOf("'", index + 1);
      if (close < 0) return { error: "unterminated ' quote", start: token.start };
      start_quote().text += text.slice(index + 1, close);
      index = close + 1;
    } else if (char === '"') {
      const quoted = start_quote();
      index += 1;
      for (;;) {
        const inner = text[index];
        if (inner === undefined) return { error: 'unterminated " quote', start: token.start };
        if (inner === '"') break;
        if (inner === "\\" && '"\\$`'.includes(text[index + 1] ?? "")) index += 1;
        quoted.text += text[index];
        index += 1;
      }
      index += 1;
    } else if (char === "\\") {
      if (index + 1 >= text.length) return { error: "backslash at the end of the line", start: token.start };
      start_quote().text += text[index + 1];
      index += 2;
    } else {
      token.text += char;
      index += 1;
    }
  }
  return { token, end: index };
}

export function tokenize(text: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  for (let read = read_token(text, 0); read; read = read_token(text, read.end)) {
    if ("error" in read) return read;
    tokens.push(read.token);
  }
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
  return parse_line(registry, text, sources).result;
}

// `subject_start` is where the verbatim subject begins in `text`, for completion to hand the raw rest to.
// A command with a verbatim param reads its words lazily, so text after the subject never needs to tokenize.
// Any other command tokenizes the whole line first, so a quote error comes before a flag error.
export function parse_line(registry: CommandLookup, text: string, sources: EnumSources = {}): { result: ParseResult; command?: ParsedCommand; subject_start?: number } {
  const fail = (error: string) => ({ result: { kind: "error", error } as const });
  const first = read_token(text, 0);
  if (!first) return fail("empty command line");
  if ("error" in first) return fail(first.error);
  const command = registry.find(first.token.text);
  if (!command) return fail(`unknown command "${first.token.text}"`);
  if (!(command.params ?? []).some((param) => param.verbatim)) {
    const all = tokenize(text);
    if (!Array.isArray(all)) return fail(all.error);
  }
  let end = first.end;
  const pull = (): Read => {
    const read = read_token(text, end);
    if (read && "token" in read) end = read.end;
    return read;
  };
  const found: { subject_start?: number } = {};
  return { result: parse_words(command, pull, text, sources, found), command, ...found };
}

// Flags come first, then the subject, which runs to the end of the line. `pull` reads the next word of `text`.
function parse_words(command: ParsedCommand, pull: () => Read, text: string, sources: EnumSources, found: { subject_start?: number }): ParseResult {
  const params = command.params ?? [];
  const command_word = command.name ?? command.id;
  const args: Record<string, unknown> = {};
  const error = (message: string): ParseResult => ({ kind: "error", error: message });
  const main = params.find((param) => param.main);
  const number_params = params.filter((param) => param.type === "int" || param.type === "float");
  const only_number = number_params.length === 1 ? number_params[0] : undefined;
  const bare_param = bare_word_param(command);
  const positional = positional_params(command);
  let options_ended = false;
  // Only the first unmarked word can be the engine or the one required value.
  let bare_open = true;

  for (let read = pull(); read; read = pull()) {
    if ("error" in read) {
      // The first word of a verbatim subject may hold an open quote or a trailing backslash, which is plain text there. A dash word is a flag attempt and keeps the error.
      if (!main?.verbatim || text[read.start] === "-" || positional.some((param) => !Object.hasOwn(args, param.name))) return error(read.error);
      found.subject_start = read.start;
      args[main.name] = text.slice(read.start).trimEnd();
      break;
    }
    const word = read.token;
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

    // A required strict param takes the word whatever it says, so a typo reads "name expects one of ..." instead of landing in the subject.
    const next_positional = positional.find((param) => !Object.hasOwn(args, param.name));
    if (next_positional) {
      const value = value_of(word.text, unquoted);
      if (typeof value === "object" && "error" in value) return error(value.error);
      args[next_positional.name] = value;
      continue;
    }

    if (!main) {
      const hint = number_params.length > 1 ? `, a bare number needs a command with one number param, write --name=value` : "";
      return error(`"${word.text}" is not a flag or subject of ${command_word}${hint}`);
    }
    if (Object.hasOwn(args, main.name)) return error(`${main.name} is set twice, quote text that has spaces`);
    if (main.verbatim) {
      // The raw text keeps quotes, backslashes and inner spacing. A leading `@name` stays text too.
      found.subject_start = word.start;
      args[main.name] = text.slice(word.start).trimEnd();
      break;
    }
    const rest = [word];
    for (let more = pull(); more && "token" in more; more = pull()) rest.push(more.token);
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

export function read_flag(command_word: string, params: readonly ParamDef[], word: Token): FlagResult {
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
    const key = name.replaceAll("-", "_");
    if (value_text !== undefined) {
      const param = PARAM_NAME_WORD.test(key) ? params.find((candidate) => candidate.name === key) : undefined;
      return param ? valued(param, value_text) : { error: `unknown param "${name}" for ${command_word}` };
    }
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
