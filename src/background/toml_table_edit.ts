// Replaces the rows of a top-level `[[key]]` list in TOML text and keeps every row that stays as it was, byte for byte: its comments, its layout and its place.
// Only the blocks of rows that leave are dropped, and only the rows that arrive are written. A parse of the text before and after
// then proves that the list holds exactly the new rows and no other key changed, and refuses the edit otherwise.

import { BLANK_OR_COMMENT, checked, find_key, join_lines, parsed, remove_top_level_key, same_value, set_top_level_key, split_lines, TABLE_HEADER, toml_key, toml_value } from "./toml_key_edit.ts";
import type { Line, TomlValue } from "./toml_key_edit.ts";
import { RuntimeRefusal } from "../shared/command.ts";

export type TomlRow = { readonly [field: string]: TomlValue | undefined };

// A row's own comment lines right above its header (`own_comment_start`), the header, and its lines up to the last one that is not blank or a comment, child tables (`[key.x]`, `[[key.x]]`) included.
// The comments and blank lines after it stay out: they most often lead into whatever comes next.
type Block = { start: number; end: number };

// Past this many old rows times new rows between the common start and end, the rows in between are replaced whole rather than paired one by one.
const MAX_PAIRING_CELLS = 250_000;

// `key` is a bare key: `find_key` refuses any other first.
const row_header = (key: string) => new RegExp(`^\\s*\\[\\[\\s*(${key}|"${key}"|'${key}')\\s*\\]\\]\\s*(#.*)?$`);
const child_header = (key: string) => new RegExp(`^\\s*\\[\\[?\\s*(${key}|"${key}"|'${key}')\\s*\\.`);
const COMMENT = /^\s*#/;

const without_absent = (row: TomlRow): Record<string, TomlValue> => Object.fromEntries(Object.entries(row).filter((entry): entry is [string, TomlValue] => entry[1] !== undefined));

// One text per row value whatever the order of its fields, as `same_value` compares them.
const row_identity = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === "object" && item !== null && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => (left < right ? -1 : 1))) : item));

function blocks_of(lines: Line[], key: string): Block[] {
  const own = row_header(key);
  const child = child_header(key);
  const headers = lines.flatMap((line, index) => (own.test(line.body) ? [index] : []));
  const blocks: Block[] = [];
  for (const header of headers) {
    let next = header + 1;
    while (next < lines.length && !(TABLE_HEADER.test(lines[next]!.body) && !child.test(lines[next]!.body))) next += 1;
    let end = next - 1;
    while (end > header && BLANK_OR_COMMENT.test(lines[end]!.body)) end -= 1;
    blocks.push({ start: own_comment_start(lines, header, blocks.at(-1)), end });
  }
  return blocks;
}

// Where the comment lines right over a row's header start, when they sit between that row and the row before it in the list, and so describe it.
// A comment over the first row, or after a root key or another table, is the file's or the list's: it stays where it is when the row goes or moves.
function own_comment_start(lines: Line[], header: number, previous: Block | undefined): number {
  let start = header;
  while (start > 0 && COMMENT.test(lines[start - 1]!.body)) start -= 1;
  if (start === header || previous === undefined) return header;
  let above = start - 1;
  while (above > previous.end && lines[above]!.body.trim() === "") above -= 1;
  return above === previous.end ? start : header;
}

// The rows of `old` that stay, as pairs of indices into `old` and `next`: a longest common run, so a row edited in place or moved is one removal and one insertion.
// The common start and end pair first, so a click that adds or removes one row costs one pass. A large middle that still differs is replaced whole.
function kept_pairs(old: readonly unknown[], next: readonly unknown[]): [number, number][] {
  let head = 0;
  while (head < old.length && head < next.length && same_value(old[head], next[head])) head += 1;
  let tail = 0;
  while (tail < old.length - head && tail < next.length - head && same_value(old[old.length - 1 - tail], next[next.length - 1 - tail])) tail += 1;
  const old_middle = old.length - head - tail;
  const next_middle = next.length - head - tail;
  const pairs: [number, number][] = Array.from({ length: head }, (_, index) => [index, index]);
  if (old_middle * next_middle <= MAX_PAIRING_CELLS) pairs.push(...middle_pairs(old.slice(head, head + old_middle), next.slice(head, head + next_middle)).map(([i, j]): [number, number] => [i + head, j + head]));
  for (let index = tail; index > 0; index -= 1) pairs.push([old.length - index, next.length - index]);
  return pairs;
}

function middle_pairs(old: readonly unknown[], next: readonly unknown[]): [number, number][] {
  const lengths = Array.from({ length: old.length + 1 }, () => new Array<number>(next.length + 1).fill(0));
  for (let i = old.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) lengths[i]![j] = same_value(old[i], next[j]) ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < old.length && j < next.length; ) {
    if (same_value(old[i], next[j])) pairs.push([i++, j++]);
    else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) i += 1;
    else j += 1;
  }
  return pairs;
}

const row_lines = (key: string, row: Record<string, TomlValue>, eol: string): Line[] => [
  { body: `[[${toml_key(key)}]]`, eol },
  ...Object.entries(row).map(([field, value]) => ({ body: `${toml_key(field)} = ${toml_value(value)}`, eol })),
];

const same_shape = (left: Record<string, TomlValue>, right: Record<string, TomlValue>): boolean => left.site !== undefined && left.site === right.site && Object.keys(left).join() === Object.keys(right).join();

// The block's lines with each changed string value rewritten before its trailing comment, or undefined when a change is not a one-line string.
function with_values_of(block: readonly Line[], old_row: Record<string, TomlValue>, next_row: Record<string, TomlValue>, eol: string): Line[] | undefined {
  const bodies = block.map((line) => line.body);
  for (const [field, value] of Object.entries(next_row)) {
    if (same_value(old_row[field], value)) continue;
    const name = toml_key(field).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const line_pattern = new RegExp(`^(\\s*${name}\\s*=\\s*)"(?:[^"\\\\]|\\\\.)*"(.*)$`);
    const at = bodies.findIndex((body) => line_pattern.test(body));
    if (typeof value !== "string" || at < 0) return undefined;
    bodies[at] = bodies[at]!.replace(line_pattern, (_whole, head: string, tail: string) => `${head}${toml_value(value)}${tail}`);
  }
  return bodies.map((body) => ({ body, eol }));
}

const BLANK: (eol: string) => Line = (eol) => ({ body: "", eol });

const layout_refusal = (label: string, key: string) =>
  new RuntimeRefusal(`${label} has a layout DesertFox cannot edit safely around [[${key}]], so it leaves the file as it is. Change ${key} there by hand.`);

// Sets the top-level list `key` to `rows`. Rows written as `[[key]]` blocks keep that form, and a list written as one inline array stays one.
// An empty list is written `key = []`, so it reads as cleared, not as unset. `remove_table_rows` removes the key instead.
export function set_table_rows(text: string, key: string, rows: readonly TomlRow[], label = "The file"): string {
  if (rows.length > 0) return replaced_rows(text, key, rows.map(without_absent), label);
  // A list written as one inline array keeps its line and its comment.
  if (find_key(split_lines(text), key, label).at !== undefined) return set_top_level_key(text, key, [], label);
  return set_top_level_key(replaced_rows(text, key, [], label), key, [], label);
}

// Removes every row of the top-level list `key`, and the key with them.
export const remove_table_rows = (text: string, key: string, label = "The file"): string => replaced_rows(text, key, [], label);

// The text with the list `key` holding `next`, or without the key for none.
function replaced_rows(text: string, key: string, next: readonly Record<string, TomlValue>[], label: string): string {
  const data = parsed(text, label);
  const lines = split_lines(text);
  if (find_key(lines, key, label).at !== undefined) return next.length === 0 ? remove_top_level_key(text, key, label) : set_top_level_key(text, key, next, label);
  const old = data[key] ?? [];
  if (!Array.isArray(old)) throw layout_refusal(label, key);
  const blocks = blocks_of(lines, key);
  // A header the scan finds inside a multi-line string, or one it misses, makes the counts differ.
  if (blocks.length !== old.length) throw layout_refusal(label, key);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const pairs = kept_pairs(old, next);
  const kept_old = new Set(pairs.map(([i]) => i));
  const kept_new_to_old = new Map(pairs.map(([i, j]) => [j, i]));
  const dropped = new Set<number>();
  for (const [index, block] of blocks.entries()) {
    if (kept_old.has(index)) continue;
    for (let line = block.start; line <= block.end; line += 1) dropped.add(line);
  }
  // The first line at or after each index that no dropped block holds, in one pass from the end. The blank lines dropped below lie before their own block, so they never change it.
  const kept_from = new Array<number>(lines.length + 1).fill(lines.length);
  for (let index = lines.length - 1; index >= 0; index -= 1) kept_from[index] = dropped.has(index) ? kept_from[index + 1]! : index;
  // The blank line that led into a dropped block goes with it when a blank line or the end follows.
  // So a row added after the last row, where a blank line or the end came next, and removed again leaves the text as it was.
  for (const [index, block] of blocks.entries()) {
    if (kept_old.has(index)) continue;
    const after = kept_from[block.end + 1]!;
    const before = block.start - 1;
    if (before >= 0 && !dropped.has(before) && lines[before]!.body.trim() === "" && (after >= lines.length || lines[after]!.body.trim() === "")) dropped.add(before);
    // A dropped block that opened the text takes the blank line after it, so the text does not start with one.
    else if (before < 0 && after < lines.length && lines[after]!.body.trim() === "") dropped.add(after);
  }

  // A row that leaves one place and arrives at another takes its own lines along: its comment and its layout.
  const dropped_rows = new Map<string, number[]>();
  for (const [i, row] of old.entries()) {
    if (kept_old.has(i)) continue;
    const identity = row_identity(row);
    const same_rows = dropped_rows.get(identity) ?? [];
    same_rows.push(i);
    dropped_rows.set(identity, same_rows);
  }
  for (const same_rows of dropped_rows.values()) same_rows.reverse();
  const lines_of = (j: number): Line[] => {
    // Each list holds its rows last first, so the earliest dropped copy of a row moves first.
    const source = dropped_rows.get(row_identity(next[j]))?.pop();
    if (source === undefined) return edited_in_place(j) ?? row_lines(key, next[j]!, eol);
    const { start, end } = blocks[source]!;
    return lines.slice(start, end + 1).map((line) => ({ body: line.body, eol }));
  };
  // A dropped row of the same site and fields that differs only in string values gives its lines to the new row, so a comment on the line stays.
  const edited_in_place = (j: number): Line[] | undefined => {
    const row = next[j]!;
    for (const same_rows of dropped_rows.values()) {
      const at = same_rows.findIndex((i) => same_shape(old[i] as Record<string, TomlValue>, row));
      if (at < 0) continue;
      const source = same_rows[at]!;
      const rewritten = with_values_of(lines.slice(blocks[source]!.start, blocks[source]!.end + 1), old[source] as Record<string, TomlValue>, row, eol);
      if (rewritten === undefined) return undefined;
      same_rows.splice(at, 1);
      return rewritten;
    }
    return undefined;
  };

  // Each new row goes after the block of the kept row before it, above the first block when no kept row comes before it, or at the end when the text has no block.
  const after_block = new Map<number, Line[]>();
  const above_first: Line[] = [];
  const at_end: Line[] = [];
  let previous_kept: number | undefined;
  for (const j of next.keys()) {
    const kept = kept_new_to_old.get(j);
    if (kept !== undefined) {
      previous_kept = kept;
      continue;
    }
    // A first block that is dropped and followed by a blank line or the end hands that blank line to the new row.
    const first_after = blocks[0] === undefined ? undefined : lines[blocks[0].end + 1];
    const takes_slot = !kept_old.has(0) && (first_after === undefined || first_after.body.trim() === "");
    if (previous_kept === undefined && blocks.length > 0) above_first.push(...lines_of(j), ...(takes_slot && above_first.length === 0 ? [] : [BLANK(eol)]));
    else if (previous_kept === undefined) at_end.push(...(at_end.length > 0 ? [BLANK(eol)] : []), ...lines_of(j));
    else {
      const bucket = after_block.get(previous_kept) ?? [];
      bucket.push(BLANK(eol), ...lines_of(j));
      after_block.set(previous_kept, bucket);
    }
  }

  const block_ending_at = new Map(blocks.map((block, index) => [block.end, index]));
  const out: Line[] = [];
  const first_at = blocks[0]?.start ?? lines.length;
  for (const [index, line] of lines.entries()) {
    if (index === first_at) out.push(...above_first);
    if (!dropped.has(index)) out.push(line);
    const block_index = block_ending_at.get(index);
    const added = block_index === undefined ? undefined : after_block.get(block_index);
    if (added) {
      // A block on the last line without a newline gets one, and the text still ends without one.
      if (line.eol === "") {
        out[out.length - 1] = { body: line.body, eol };
        added[added.length - 1] = { ...added.at(-1)!, eol: "" };
      }
      out.push(...added);
    }
  }
  if (at_end.length > 0) {
    const last = out.at(-1);
    // A text without a final newline keeps none.
    if (last && last.eol === "") {
      out[out.length - 1] = { body: last.body, eol };
      at_end[at_end.length - 1] = { ...at_end.at(-1)!, eol: "" };
    }
    if (last && last.body.trim() !== "") out.push(BLANK(eol));
    out.push(...at_end);
  }
  // A dropped last line that ended the text without a newline leaves the new last line without one.
  if (lines.at(-1)?.eol === "" && dropped.has(lines.length - 1) && out.length > 0) out[out.length - 1] = { ...out.at(-1)!, eol: "" };
  return checked(text, join_lines(out), key, next.length === 0 ? undefined : next, label);
}
