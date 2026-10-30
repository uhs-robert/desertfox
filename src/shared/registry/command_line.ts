// Command line text to an Invocation. Values stay strings except switches;
// `check_args` coerces them.

import type { CommandDef, ParamDef } from "../command.ts";
import type { Invocation } from "../invocation.ts";
import type { Registry } from "./define.ts";
import { positional_params } from "./params.ts";
import { usage_line } from "./usage.ts";

export type ParseResult =
  | { kind: "invocation"; invocation: Invocation }
  | { kind: "help"; usage: string }
  | { kind: "error"; error: string };

export type Token = {
  text: string;
  // The first character was quoted or escaped, so the word is never a flag.
  literal: boolean;
};

// Shell rules: single quotes are literal, double quotes allow \" \\ \$ and \`,
// a backslash outside quotes escapes the next character.
export function tokenize(text: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  let current: Token | null = null;
  const add = (char: string, quoted: boolean): void => {
    current ??= { text: "", literal: quoted };
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
      current ??= { text: "", literal: true };
      current.text += text.slice(index + 1, close);
      index = close + 1;
    } else if (char === '"') {
      current ??= { text: "", literal: true };
      index += 1;
      for (;;) {
        const inner = text[index];
        if (inner === undefined) return { error: 'unterminated " quote' };
        if (inner === '"') break;
        if (inner === "\\" && '"\\$`'.includes(text[index + 1] ?? "")) index += 1;
        current.text += text[index];
        index += 1;
      }
      index += 1;
    } else if (char === "\\") {
      if (index + 1 >= text.length) return { error: "backslash at the end of the line" };
      add(text[index + 1] as string, true);
      index += 2;
    } else {
      add(char, false);
      index += 1;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

type FlagTarget =
  | { kind: "param"; param: ParamDef }
  | { kind: "no_param"; param: ParamDef }
  | { kind: "preset"; sets: Record<string, string | number | boolean> };

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
  const args: Record<string, unknown> = {};
  const set_by = new Map<string, string>();
  const positional_words: string[] = [];

  const set = (param_name: string, value: unknown, written_as: string): string | null => {
    const earlier = set_by.get(param_name);
    if (earlier) return `${earlier} and ${written_as} both set ${param_name}`;
    set_by.set(param_name, written_as);
    args[param_name] = value;
    return null;
  };
  const error = (message: string): ParseResult => ({ kind: "error", error: message });

  let flags_ended = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as Token;
    if (flags_ended || word.literal || !word.text.startsWith("-") || word.text === "-") {
      positional_words.push(word.text);
      continue;
    }
    if (word.text === "--") {
      flags_ended = true;
      continue;
    }
    if (word.text === "-h" || word.text === "--help") return { kind: "help", usage: usage_line(command) };

    const is_long = word.text.startsWith("--");
    if (!is_long && /^-\d/.test(word.text) && !find_target(command, word.text[1] as string, false)) {
      positional_words.push(word.text);
      continue;
    }

    const names = is_long ? [word.text.slice(2)] : [...word.text.slice(1)];
    for (let name_index = 0; name_index < names.length; name_index += 1) {
      let name = names[name_index] as string;
      let attached_value: string | undefined;
      if (is_long) {
        const equals = name.indexOf("=");
        if (equals >= 0) {
          attached_value = name.slice(equals + 1);
          name = name.slice(0, equals);
        }
      }
      const written_as = is_long ? `--${name}` : `-${name}`;
      const target = find_target(command, name, is_long);
      if (!target) return error(`unknown flag ${written_as}`);

      if (target.kind === "preset") {
        if (attached_value !== undefined) return error(`${written_as} takes no value`);
        for (const [param_name, value] of Object.entries(target.sets)) {
          const problem = set(param_name, value, written_as);
          if (problem) return error(problem);
        }
      } else if (target.kind === "no_param") {
        if (attached_value !== undefined) return error(`${written_as} takes no value`);
        const problem = set(target.param.name, false, written_as);
        if (problem) return error(problem);
      } else if (target.param.type === "bool") {
        const switch_value = attached_value ?? true;
        if (typeof switch_value === "string" && switch_value !== "true" && switch_value !== "false") {
          return error(`${written_as} takes true or false, got "${switch_value}"`);
        }
        const problem = set(target.param.name, switch_value === "false" ? false : true, written_as);
        if (problem) return error(problem);
      } else {
        let value = attached_value;
        if (value === undefined) {
          const last_name = name_index === names.length - 1;
          const next = words[index + 1];
          if (!last_name || !next) return error(`${written_as} needs a value`);
          value = next.text;
          index += 1;
        }
        const problem = set(target.param.name, value, written_as);
        if (problem) return error(problem);
      }
    }
  }

  const positionals = positional_params(command);
  const rest_param = positionals.find((param) => param.rest);
  const plain = rest_param ? positionals.filter((param) => param !== rest_param) : positionals;
  if (!rest_param && positional_words.length > plain.length) {
    return error(`too many words, "${positional_words[plain.length]}" has no param`);
  }
  plain.forEach((param, position) => {
    const word = positional_words[position];
    if (word !== undefined) args[param.name] = word;
  });
  if (rest_param && positional_words.length > plain.length) {
    args[rest_param.name] = positional_words.slice(plain.length).join(" ");
  }

  const invocation: Invocation = { id: command.id };
  if (Object.keys(args).length > 0) invocation.args = args;
  return { kind: "invocation", invocation };
}

function find_target(command: CommandDef, name: string, is_long: boolean): FlagTarget | undefined {
  for (const preset of command.flags ?? []) {
    if (is_long ? preset.long === name : preset.short === name) return { kind: "preset", sets: preset.sets };
  }
  for (const param of command.params ?? []) {
    if (!param.flag) continue;
    if (is_long ? param.name === name : param.flag.short === name) return { kind: "param", param };
    if (is_long && param.type === "bool" && name === `no-${param.name}`) return { kind: "no_param", param };
  }
  return undefined;
}
