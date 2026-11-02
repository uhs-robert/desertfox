// The one grammar for command text, shared by the command line and the config
// (`parse_binding.ts` adds the leading `:` on top). Values stay strings except
// switches and `@source` markers; `check_args` coerces them.

import type { CommandDef, ContextSourceName, ParamDef } from "../command.ts";
import type { Invocation } from "../invocation.ts";
import type { Registry } from "./define.ts";
import { CONTEXT_SOURCE_NAMES } from "./params.ts";
import { usage_line } from "./usage.ts";

export type ParseResult =
  | { kind: "invocation"; invocation: Invocation }
  | { kind: "help"; usage: string }
  | { kind: "error"; error: string };

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

// Params the grammar reads. `main` is the one param a bare free word fills.
export type GrammarParam = ParamDef & { main?: boolean };

const PARAM_NAME_WORD = /^[a-z][a-z0-9_]*$/;

export function parse_command_line(registry: Registry, text: string): ParseResult {
  const tokens = tokenize(text);
  if (!Array.isArray(tokens)) return { kind: "error", error: tokens.error };
  const [first, ...words] = tokens;
  if (!first) return { kind: "error", error: "empty command line" };
  const command = registry.find(first.text);
  if (!command) return { kind: "error", error: `unknown command "${first.text}"` };
  return parse_words(command, words);
}

function parse_words(command: CommandDef, words: Token[]): ParseResult {
  const params = (command.params ?? []) as readonly GrammarParam[];
  const command_word = command.name ?? command.id;
  const args: Record<string, unknown> = {};
  const error = (message: string): ParseResult => ({ kind: "error", error: message });
  const main = params.find((param) => param.main);

  for (const word of words) {
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
      const named = params.filter((param) => word_names_param(param, word.text));
      if (named.length > 1) return error(`"${word.text}" fits ${named.map((param) => param.name).join(" and ")}, write name=value`);
      const [param] = named;
      if (param) {
        if (Object.hasOwn(args, param.name)) return error(`${param.name} is set twice`);
        args[param.name] = param.type === "bool" ? true : word.text;
        continue;
      }
    }

    if (!main) return error(`"${word.text}" is not a value, switch or param of ${command_word}`);
    if (Object.hasOwn(args, main.name)) return error(`${main.name} is set twice, quote text that has spaces`);
    const value = value_of(word.text, word.quoted_from === null);
    if (typeof value === "object" && "error" in value) return error(value.error);
    args[main.name] = value;
  }

  const invocation: Invocation = { id: command.id };
  if (Object.keys(args).length > 0) invocation.args = args;
  return { kind: "invocation", invocation };
}

// A bare word names a switch by its name and an enum param by one of its fixed values.
function word_names_param(param: GrammarParam, word: string): boolean {
  if (param.type === "bool") return param.name === word;
  return param.type === "enum" && Array.isArray(param.values) && param.values.includes(word);
}

// An unquoted `@name` is a context source the router fills in when the key is pressed.
function value_of(text: string, unquoted: boolean): string | { from: ContextSourceName } | { error: string } {
  if (!unquoted || !text.startsWith("@")) return text;
  const source = CONTEXT_SOURCE_NAMES.find((name) => name === text.slice(1));
  if (source) return { from: source };
  return { error: `unknown source "${text}" (known: ${CONTEXT_SOURCE_NAMES.map((name) => `@${name}`).join(", ")}), quote text that starts with @` };
}
