// Replaces the rows of a top-level `[[key]]` list in TOML text and keeps every row that stays as it was, byte for byte: its comments, its layout and its place.
// Only the blocks of rows that leave are dropped, and only the rows that arrive are written. A parse of the text before and after
// then proves that the list holds exactly the new rows and no other key changed, and refuses the edit otherwise.

import { RuntimeRefusal } from "../shared/command.ts";
import { BLANK_OR_COMMENT, find_key, join_lines, parsed, remove_top_level_key, same_value, set_top_level_key, split_lines, TABLE_HEADER, toml_key, toml_value } from "./toml_key_edit.ts";
import type { Line, TomlValue } from "./toml_key_edit.ts";

export type TomlRow = { readonly [field: string]: TomlValue | undefined };

// A row's header to its last line that is not blank or a comment, child tables (`[key.x]`, `[[key.x]]`) included.
// The comments and blank lines after it stay out: they most often lead into whatever comes next.
type Block = { start: number; end: number };

// `key` is a bare key: `find_key` refuses any other first.
const row_header = (key: string) => new RegExp(`^\\s*\\[\\[\\s*(${key}|"${key}"|'${key}')\\s*\\]\\]\\s*(#.*)?$`);
const child_header = (key: string) => new RegExp(`^\\s*\\[\\[?\\s*(${key}|"${key}"|'${key}')\\s*\\.`);

const without_absent = (row: TomlRow): Record<string, TomlValue> => Object.fromEntries(Object.entries(row).filter((entry): entry is [string, TomlValue] => entry[1] !== undefined));

function blocks_of(lines: Line[], key: string): Block[] {
  const own = row_header(key);
  const child = child_header(key);
  const starts = lines.flatMap((line, index) => (own.test(line.body) ? [index] : []));
  return starts.map((start) => {
    let next = start + 1;
    while (next < lines.length && !(TABLE_HEADER.test(lines[next]!.body) && !child.test(lines[next]!.body))) next += 1;
    let end = next - 1;
    while (end > start && BLANK_OR_COMMENT.test(lines[end]!.body)) end -= 1;
    return { start, end };
  });
}

// The rows of `old` that stay, as pairs of indices into `old` and `next`: a longest common run, so a row edited in place or moved is one removal and one insertion.
function kept_pairs(old: readonly unknown[], next: readonly unknown[]): [number, number][] {
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

const BLANK: (eol: string) => Line = (eol) => ({ body: "", eol });

const layout_refusal = (label: string, key: string) =>
  new RuntimeRefusal(`${label} has a layout DesertFox cannot edit safely around [[${key}]], so it leaves the file as it is. Change ${key} there by hand.`);

// Sets the top-level list `key` to `rows`. Rows written as `[[key]]` blocks keep that form, and a list written as one inline array stays one.
// An empty list removes the key, as a list that is not set reads as empty.
export function set_table_rows(text: string, key: string, rows: readonly TomlRow[], label = "The file"): string {
  const data = parsed(text, label);
  const next = rows.map(without_absent);
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
  const dropped = new Set<number>();
  for (const [index, block] of blocks.entries()) {
    if (kept_old.has(index)) continue;
    for (let line = block.start; line <= block.end; line += 1) dropped.add(line);
  }
  // The blank line that led into a dropped block goes with it when a blank line or the end follows, so a row added and removed again leaves the text as it was.
  for (const [index, block] of blocks.entries()) {
    if (kept_old.has(index)) continue;
    let after = block.end + 1;
    while (after < lines.length && dropped.has(after)) after += 1;
    const before = block.start - 1;
    if (before >= 0 && !dropped.has(before) && lines[before]!.body.trim() === "" && (after >= lines.length || lines[after]!.body.trim() === "")) dropped.add(before);
  }

  // Each new row goes after the block of the kept row before it, above the first block when no kept row comes before it, or at the end when the text has no block.
  const after_block = new Map<number, Line[]>();
  const above_first: Line[] = [];
  const at_end: Line[] = [];
  let previous_kept: number | undefined;
  let pair_at = 0;
  for (const [j, row] of next.entries()) {
    if (pair_at < pairs.length && pairs[pair_at]![1] === j) {
      previous_kept = pairs[pair_at]![0];
      pair_at += 1;
      continue;
    }
    if (previous_kept === undefined && blocks.length > 0) above_first.push(...row_lines(key, row, eol), BLANK(eol));
    else if (previous_kept === undefined) at_end.push(...(at_end.length > 0 ? [BLANK(eol)] : []), ...row_lines(key, row, eol));
    else after_block.set(previous_kept, [...(after_block.get(previous_kept) ?? []), BLANK(eol), ...row_lines(key, row, eol)]);
  }

  const out: Line[] = [];
  // Above the first block, and above the comment lines right over its header, which describe it.
  let first_at = blocks[0]?.start ?? lines.length;
  while (first_at > 0 && /^\s*#/.test(lines[first_at - 1]!.body)) first_at -= 1;
  for (const [index, line] of lines.entries()) {
    if (index === first_at) out.push(...above_first);
    if (!dropped.has(index)) out.push(line);
    const block_index = blocks.findIndex((block) => block.end === index);
    const added = block_index >= 0 ? after_block.get(block_index) : undefined;
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
  return checked_rows(text, join_lines(out), key, next, label);
}

// Proves the edit: `key` holds `rows` (or is gone for none) and every other key parses as before.
function checked_rows(before: string, after: string, key: string, rows: readonly Record<string, TomlValue>[], label: string): string {
  const { [key]: _old, ...old_rest } = parsed(before, label);
  let new_data: Record<string, unknown>;
  try {
    new_data = parsed(after, label);
  } catch {
    throw layout_refusal(label, key);
  }
  const { [key]: new_rows, ...new_rest } = new_data;
  const rows_right = rows.length === 0 ? !Object.hasOwn(new_data, key) : same_value(new_rows, rows);
  if (!rows_right || !same_value(old_rest, new_rest)) throw layout_refusal(label, key);
  return after;
}
