// Sets or removes one top-level key in TOML text and keeps every other byte: comments, blank lines, order and line endings.
// smol-toml's `stringify` would rewrite the whole file and drop the comments, so the edit works on lines. A parse of the
// text before and after then proves that nothing but the one key changed, and refuses the edit otherwise.
// A value is a scalar or a list of strings: every shape a setting outside the tables takes.

import { parse, TomlError } from "smol-toml";
import { RuntimeRefusal } from "../shared/command.ts";

export type TomlScalar = string | number | boolean;
export type TomlValue = TomlScalar | readonly string[];

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
// `[name]` or `[[name]]` with an optional comment. A line of a multi-line array that starts with `[` carries a comma, so it
// does not match. A case this misreads still cannot write a wrong file: the parse check refuses it.
const TABLE_HEADER = /^\s*\[\[?[^[\]=,]*\]\]?\s*(#.*)?$/;
const BLANK_OR_COMMENT = /^\s*(#.*)?$/;

type Line = { body: string; eol: string };

function split_lines(text: string): Line[] {
  return text === "" ? [] : text.split(/(?<=\n)/).map((line) => {
    const eol = line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "";
    return { body: line.slice(0, line.length - eol.length), eol };
  });
}

const join_lines = (lines: Line[]): string => lines.map((line) => line.body + line.eol).join("");

function key_line_pattern(key: string): RegExp {
  return new RegExp(`^(\\s*)(${key}|"${key}"|'${key}')(\\s*=\\s*)(.*)$`);
}

// The end of the scalar that starts `rest`, or undefined for one this editor does not rewrite (a multi-line string, an array or an inline table).
function scalar_length(rest: string): number | undefined {
  if (rest.startsWith('"""') || rest.startsWith("'''") || rest.startsWith("[") || rest.startsWith("{")) return undefined;
  if (rest.startsWith("'")) {
    const close = rest.indexOf("'", 1);
    return close < 0 ? undefined : close + 1;
  }
  if (rest.startsWith('"')) {
    for (let index = 1; index < rest.length; index += 1) {
      if (rest[index] === "\\") index += 1;
      else if (rest[index] === '"') return index + 1;
    }
    return undefined;
  }
  const comment = rest.indexOf("#");
  return (comment < 0 ? rest : rest.slice(0, comment)).trimEnd().length;
}

// The value that sets a key: the line it ends on, the text after it there, and whether a comment sits inside it.
type ValueEnd = { last: number; after: string; commented: boolean };

// Where the array that opens `rest`, the text after `=` on line `at`, closes. Undefined for an array that never closes or
// holds a multi-line string, which this scan does not follow.
function array_end(lines: Line[], at: number, rest: string): ValueEnd | undefined {
  let depth = 0;
  let commented = false;
  for (let index = at; index < lines.length; index += 1) {
    const body = index === at ? rest : lines[index]!.body;
    for (let column = 0; column < body.length; column += 1) {
      const char = body[column]!;
      if (body.startsWith('"""', column) || body.startsWith("'''", column)) return undefined;
      if (char === "#") {
        commented = true;
        break;
      }
      if (char === '"' || char === "'") {
        let close = column + 1;
        while (close < body.length && body[close] !== char) close += char === '"' && body[close] === "\\" ? 2 : 1;
        if (close >= body.length) return undefined;
        column = close;
      } else if (char === "[") {
        depth += 1;
      } else if (char === "]") {
        depth -= 1;
        if (depth === 0) return { last: index, after: body.slice(column + 1), commented };
      }
    }
  }
  return undefined;
}

function value_end(lines: Line[], at: number, rest: string): ValueEnd | undefined {
  if (rest.startsWith("[")) return array_end(lines, at, rest);
  const length = scalar_length(rest);
  return length === undefined ? undefined : { last: at, after: rest.slice(length), commented: false };
}

// JSON escapes every control character but DEL, which a TOML basic string also refuses unescaped.
function toml_value(value: TomlValue): string {
  if (typeof value === "object") return `[${value.map(toml_value).join(", ")}]`;
  if (typeof value === "string") return JSON.stringify(value).replace(/\x7f/g, "\\u007f");
  if (typeof value === "number" && !Number.isFinite(value)) throw new RuntimeRefusal(`${value} is not a TOML number`);
  return String(value);
}

export function same_value(left: unknown, right: unknown): boolean {
  if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && String(left) === String(right);
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => same_value(item, right[index]));
  }
  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    const names = Object.keys(left);
    return names.length === Object.keys(right).length && names.every((name) => Object.hasOwn(right, name) && same_value((left as Record<string, unknown>)[name], (right as Record<string, unknown>)[name]));
  }
  return Object.is(left, right);
}

function parsed(text: string, label: string): Record<string, unknown> {
  try {
    return parse(text) as Record<string, unknown>;
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    throw new RuntimeRefusal(`${label} does not parse (line ${error.line}), so DesertFox leaves it as it is. Fix it first.`);
  }
}

// The one top-level line that sets `key`, if any. A key set twice never gets here: the parse refuses it first.
function find_key(lines: Line[], key: string, label: string): { header: number; at: number | undefined } {
  if (!BARE_KEY.test(key)) throw new RuntimeRefusal(`${key} is not a top-level key. This editor changes top-level keys only.`);
  const pattern = key_line_pattern(key);
  const header = lines.findIndex((line) => TABLE_HEADER.test(line.body));
  const top_end = header < 0 ? lines.length : header;
  const found = lines.flatMap((line, index) => (pattern.test(line.body) ? [index] : []));
  if (found.some((index) => index >= top_end)) throw new RuntimeRefusal(`${label} sets ${key} inside a table. Move it above the first [table] line.`);
  return { header: top_end, at: found[0] };
}

// Proves the edit: `key` holds `value` (or is gone for undefined) and every other key parses as before.
function checked(before: string, after: string, key: string, value: TomlValue | undefined, label: string): string {
  const old_data = parsed(before, label);
  let new_data: Record<string, unknown>;
  try {
    new_data = parse(after) as Record<string, unknown>;
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    throw new RuntimeRefusal(`${label} has a layout DesertFox cannot edit safely around ${key}, so it leaves the file as it is. Set ${key} there by hand.`);
  }
  const { [key]: _old, ...old_rest } = old_data;
  const { [key]: new_value, ...new_rest } = new_data;
  const key_right = value === undefined ? !Object.hasOwn(new_data, key) : same_value(new_value, value);
  if (!key_right || !same_value(old_rest, new_rest)) throw new RuntimeRefusal(`${label} has a layout DesertFox cannot edit safely around ${key}, so it leaves the file as it is. Set ${key} there by hand.`);
  return after;
}

// Replaces the value of the top-level `key`, or adds `key = value` after the last top-level line when the text lacks it.
// The added line goes above the comment and blank lines that lead into the first table, so those stay with their table.
// An array over several lines becomes one line, unless a comment sits inside it, which the one line would lose.
export function set_top_level_key(text: string, key: string, value: TomlValue, label = "The file"): string {
  parsed(text, label);
  const lines = split_lines(text);
  const { header, at } = find_key(lines, key, label);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const assignment = `${key} = ${toml_value(value)}`;
  if (at !== undefined) {
    const [, indent, name, equals, rest] = key_line_pattern(key).exec(lines[at]!.body)!;
    const end = value_end(lines, at, rest!);
    if (end === undefined || end.commented || !BLANK_OR_COMMENT.test(end.after)) throw new RuntimeRefusal(`${label} gives ${key} a value DesertFox does not rewrite. Set it there by hand.`);
    lines.splice(at, end.last - at + 1, { body: `${indent}${name}${equals}${toml_value(value)}${end.after}`, eol: lines[end.last]!.eol });
    return checked(text, join_lines(lines), key, value, label);
  }
  if (text === "") return checked(text, `${assignment}\n`, key, value, label);
  let insert_at = header;
  while (insert_at > 0 && BLANK_OR_COMMENT.test(lines[insert_at - 1]!.body)) insert_at -= 1;
  if (insert_at === lines.length) {
    // The text has no final newline: the new line starts one and keeps the file without one at the end, as it was.
    const last = lines[lines.length - 1]!;
    if (last.eol === "") return checked(text, `${text}${eol}${assignment}`, key, value, label);
  }
  lines.splice(insert_at, 0, { body: assignment, eol });
  return checked(text, join_lines(lines), key, value, label);
}

// Drops the lines that set the top-level `key`, comments inside its value included. Text without the key comes back as it is.
export function remove_top_level_key(text: string, key: string, label = "The file"): string {
  parsed(text, label);
  const lines = split_lines(text);
  const { at } = find_key(lines, key, label);
  if (at === undefined) return text;
  const rest = key_line_pattern(key).exec(lines[at]!.body)![4]!;
  const last = rest.startsWith("[") ? array_end(lines, at, rest)?.last : at;
  if (last === undefined) throw new RuntimeRefusal(`${label} gives ${key} a value DesertFox does not rewrite. Remove it there by hand.`);
  lines.splice(at, last - at + 1);
  return checked(text, join_lines(lines), key, undefined, label);
}
