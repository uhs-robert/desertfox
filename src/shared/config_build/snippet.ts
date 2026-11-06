// Turns a snippet file into a registry-shaped entry. The header is the leading
// run of `// key: value` lines. The whole file stays as the code text.
//
// Grammar chosen here, because the design shows one example only:
//   param: <name> <type> [main] [rest] [default=<value>] [values=a,b,c] [short=<letter>]
// `main` marks the one free-text param a bare word fills, as in the command grammar.
// `short=p` gives a bool or valued param the flag `-p`. An enum maps values to letters: `short=tab:t,window:w`.
// A bare `default=` word that names a context source (current_url, selection,
// clipboard) is that source. A double-quoted default is always a literal string.

import type { ContextSourceName, Mode, ParamDef, ParamType, ParamValue } from "../command.ts";
import { SLOTS } from "../engines/index.ts";
import type { SnippetEntry } from "../config.ts";

const PARAM_TYPES: readonly string[] = ["int", "float", "string", "bool", "enum"];
const CONTEXT_SOURCES: readonly string[] = ["current_url", "selection", "clipboard"];
const SINGLE_KEYS = ["id", "label", "intent", "name", "modes", "requires"] as const;
// Only the modes where a key press reaches a page command. Insert, ignore, hint and cmdline take typed text.
const SNIPPET_MODES: readonly string[] = ["normal", "caret", "visual", "visual_line"];
const REPEAT_KEYS = ["matches", "param"] as const;
const HEADER_LINE = /^\/\/\s*([a-z_]+)\s*:\s*(.*?)\s*$/;

function parse_value(raw: string, type: ParamType): ParamValue | undefined {
  if (type === "int") return /^-?\d+$/.test(raw) ? Number(raw) : undefined;
  if (type === "float") return raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  if (type === "bool") return raw === "true" ? true : raw === "false" ? false : undefined;
  return raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

function parse_short(raw: string, type: ParamType, name: string, where: string, problems: string[]): NonNullable<ParamDef["short"]> {
  if (type !== "enum") return raw;
  const map: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [value, letter, ...extra] = pair.split(":");
    if (!value || !letter || extra.length > 0) problems.push(`${where}: short "${pair}" on "${name}" must be value:letter`);
    else map[value] = letter;
  }
  return map;
}

function parse_param_words(words: string[], name: string, where: string, problems: string[]): ParamDef | undefined {
  const [type_word, ...options] = words;
  if (!type_word || !PARAM_TYPES.includes(type_word)) {
    problems.push(`${where}: "${name}" needs a type, one of ${PARAM_TYPES.join(", ")}`);
    return undefined;
  }
  const type = type_word as ParamType;
  const param: ParamDef = { name, type };
  for (const option of options) {
    if (option === "main") {
      param.main = true;
    } else if (option === "rest") {
      param.rest = true;
    } else if (option.startsWith("values=")) {
      param.values = option.slice("values=".length).split(",").filter(Boolean);
    } else if (option.startsWith("short=")) {
      param.short = parse_short(option.slice("short=".length), type, name, where, problems);
    } else if (option.startsWith("default=")) {
      const raw = option.slice("default=".length);
      if (type === "string" && CONTEXT_SOURCES.includes(raw)) {
        param.default = { from: raw as ContextSourceName };
      } else {
        const value = parse_value(raw, type);
        if (value === undefined) problems.push(`${where}: default "${raw}" is not a ${type}`);
        else param.default = value;
      }
    } else {
      problems.push(`${where}: unknown option "${option}" on "${name}"`);
    }
  }
  if (type === "enum" && !Array.isArray(param.values)) problems.push(`${where}: enum "${name}" needs values=a,b,c`);
  if (param.rest && type !== "string") problems.push(`${where}: only a string param can be rest`);
  return param;
}

function parse_param_line(line: string, where: string, problems: string[]): ParamDef | undefined {
  const [name, ...words] = line.split(/\s+/);
  if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
    problems.push(`${where}: param name "${name ?? ""}" must be lowercase with underscores`);
    return undefined;
  }
  return parse_param_words(words, name, where, problems);
}

function parse_modes(raw: string, where: string, problems: string[]): Mode[] {
  const names = raw.split(",").map((word) => word.trim());
  const unknown = names.filter((word) => !SNIPPET_MODES.includes(word));
  if (unknown.length > 0) {
    problems.push(`${where}: unknown mode "${unknown.join(", ")}" in modes, use ${SNIPPET_MODES.join(", ")}`);
  }
  return [...new Set(names.filter((word) => SNIPPET_MODES.includes(word)))] as Mode[];
}

// The snippet check reads the tab address only, so a slot that needs the title cannot be required.
const REQUIRABLE_SLOTS = Object.keys(SLOTS).filter((name) => SLOTS[name]?.kind === "page" && name !== "title");

function parse_requires(raw: string, where: string, problems: string[]): string[] {
  const names = raw.split(",").map((word) => word.trim()).filter(Boolean);
  const unknown = names.filter((word) => !REQUIRABLE_SLOTS.includes(word));
  if (unknown.length > 0) problems.push(`${where}: unknown slot "${unknown.join(", ")}" in requires, use ${REQUIRABLE_SLOTS.join(", ")}`);
  return [...new Set(names.filter((word) => REQUIRABLE_SLOTS.includes(word)))];
}

export function parse_snippet(file: string, text: string, problems: string[]): SnippetEntry | undefined {
  const problems_before = problems.length;
  const single = new Map<string, string>();
  const repeated = new Map<string, { line_number: number; value: string }[]>();

  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("//")) break;
    const match = line.match(HEADER_LINE);
    if (!match?.[1]) continue;
    const [, key, value = ""] = match;
    if ((SINGLE_KEYS as readonly string[]).includes(key)) {
      if (single.has(key)) problems.push(`${file}:${index + 1}: header "${key}" appears twice`);
      single.set(key, value);
    } else if ((REPEAT_KEYS as readonly string[]).includes(key)) {
      repeated.set(key, [...(repeated.get(key) ?? []), { line_number: index + 1, value }]);
    } else {
      problems.push(`${file}:${index + 1}: unknown header "${key}"`);
    }
  }

  for (const required of ["id", "label", "intent"]) {
    if (!single.get(required)) problems.push(`${file}: header "${required}" is missing`);
  }
  const matches = (repeated.get("matches") ?? []).map((entry) => entry.value).filter(Boolean);
  if (matches.length === 0) problems.push(`${file}: header "matches" is missing`);

  const params: ParamDef[] = [];
  for (const { line_number, value } of repeated.get("param") ?? []) {
    const param = parse_param_line(value, `${file}:${line_number}`, problems);
    if (param) params.push(param);
  }
  const seen_names = new Set<string>();
  for (const param of params) {
    if (seen_names.has(param.name)) problems.push(`${file}: param "${param.name}" is defined twice`);
    seen_names.add(param.name);
  }
  const modes_line = single.get("modes");
  const modes = modes_line === undefined ? [] : parse_modes(modes_line, `${file}: header "modes"`, problems);
  const requires_line = single.get("requires");
  const requires = requires_line === undefined ? [] : parse_requires(requires_line, `${file}: header "requires"`, problems);
  if (problems.length > problems_before) return undefined;

  const entry: SnippetEntry = {
    id: single.get("id") ?? "",
    label: single.get("label") ?? "",
    intent: single.get("intent") ?? "",
    matches,
    code: text,
  };
  const name = single.get("name");
  if (name) entry.name = name;
  if (params.length > 0) entry.params = params;
  if (modes.length > 0) entry.modes = modes;
  if (requires.length > 0) entry.requires = requires;
  return entry;
}
