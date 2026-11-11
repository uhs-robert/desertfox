// What each setting accepts, derived from its row in `settings_table.ts`: the build tool checks settings.toml with
// it, `:set` checks a typed value with it and the generator of `setting_completion.ts` reads names and values from it. Background
// and build tools import this module. The content script and the command line page must not: the first has a
// 16 KB budget and neither needs it.

import { BUILT_IN_PAGE, is_web_url } from "./config.ts";
import { parse_sequence } from "./keys/notation.ts";
import { SETTINGS_TABLE, type PerSiteName, type SettingName, type SettingRow } from "./settings_table.ts";
import { BUILT_IN_THEME_NAMES } from "./theme_names.ts";

export type SettingSpec = {
  check: (value: unknown) => boolean;
  // What a valid value looks like, in the words of a problem message: "expected <expectation>".
  expectation: string;
  // One word per list item on the command line, instead of one value.
  is_list: boolean;
  // Whether `:set` takes it.
  settable: boolean;
  // A boolean `:toggle` flips.
  is_toggle: boolean;
  // Names what failed in a value that `check` refused, for a value with parts such as a list of tables. Appended to the expectation in the build problem.
  explain?: (value: unknown) => string | undefined;
  // Values the command line offers for the second word. A function, and short lists only: `tools/build_setting_completion.ts` calls it once and stores the result, so the command line page does not bundle this module. Keep it off the theme color tables (25 KB): the theme names come from the names-only `theme_names.ts`.
  listed_values?: () => readonly string[];
};

type Rule = Pick<SettingSpec, "check" | "expectation" | "explain" | "listed_values">;

const is_text = (value: unknown): value is string => typeof value === "string" && value !== "";
const is_table = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// "a", "a or b", "a, b or c".
function join_words(words: readonly string[], last_join: string): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} ${last_join} ${words.at(-1)}`;
}

// A string value quoted, any other as written.
const value_words = (values: readonly unknown[]): string[] => values.map((value) => (typeof value === "string" ? `"${value}"` : String(value)));

// Three or more whole numbers in a row read as a range: "a whole number from 1 to 5".
function enum_expectation(values: readonly unknown[]): string {
  const is_run = values.length >= 3 && values.every((value, index) => Number.isInteger(value) && value === (values[0] as number) + index);
  return is_run ? `a whole number from ${values[0]} to ${values.at(-1)}` : join_words(value_words(values), "or");
}

type TableFields = Extract<SettingRow, { kind: "table_list" }>["fields"];

// The checks of the settings a site table row may set as extra columns, by setting name.
type ColumnSpecs = Readonly<Record<string, Pick<SettingSpec, "check" | "expectation">>>;

// What is wrong with one table, or undefined when it is fine. A field the row does not name is a typo.
function table_problem(fields: TableFields, exclusive: readonly string[], columns: ColumnSpecs, value: unknown): string | undefined {
  if (!is_table(value)) return "is not a table";
  const unknown_field = Object.keys(value).find((key) => !Object.hasOwn(fields, key) && !Object.hasOwn(columns, key));
  if (unknown_field !== undefined) return `has the unknown field "${unknown_field}"`;
  for (const [field, rule] of Object.entries(fields)) {
    const field_value = value[field];
    if (rule.optional && field_value === undefined) continue;
    if (rule.value === "boolean") {
      if (typeof field_value === "boolean") continue;
      return `has a field "${field}" that is not true or false`;
    }
    if (rule.value === "keys" && is_text(field_value)) {
      const key_problem = keys_problem(field_value);
      if (key_problem !== undefined) return `has a field "${field}" that ${key_problem}`;
      continue;
    }
    if (is_text(field_value) && (rule.value !== "web_url" || is_web_url(field_value))) continue;
    if (rule.optional) return `has an empty or non-text "${field}"`;
    return rule.value === "web_url" ? `needs an http or https "${field}"` : `needs a non-empty "${field}"`;
  }
  for (const [name, spec] of Object.entries(columns)) {
    if (value[name] !== undefined && !spec.check(value[name])) return `has a field "${name}" that is not ${spec.expectation}`;
  }
  const present = exclusive.filter((field) => value[field] !== undefined);
  return present.length > 1 ? `sets both ${join_words(present.map((field) => `"${field}"`), "and")}, and only one may be set` : undefined;
}

// Key sequences split by spaces, each in keymap notation.
function keys_problem(text: string): string | undefined {
  const words = text.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return "lists no key";
  for (const word of words) {
    const { error } = parse_sequence(word);
    if (error !== undefined) return `has "${word}", which ${error}`;
  }
  return undefined;
}

// A problem names the item by its `label` when it has one. `columns` are the per-site settings of a site table, empty for a plain list of tables.
export function table_list_rule(fields: TableFields, exclusive: readonly string[], columns: ColumnSpecs = {}): Rule {
  const explain = (value: unknown): string | undefined => {
    if (!Array.isArray(value)) return "it is not a list of tables";
    for (const [index, item] of value.entries()) {
      const problem = table_problem(fields, exclusive, columns, item);
      if (problem === undefined) continue;
      const label = typeof item?.label === "string" && item.label !== "" ? ` ("${item.label}")` : "";
      return `item ${index + 1}${label} ${problem}`;
    }
    return undefined;
  };
  const optional_kind = (value: string): string => (value === "keys" ? " of key sequences" : value === "boolean" ? " of true or false" : "");
  const field_words = Object.entries(fields).map(([field, rule]) => {
    const kind = rule.value === "web_url" ? "an http or https " : rule.value === "keys" ? "key sequences in " : "";
    return rule.optional ? `an optional "${field}"${optional_kind(rule.value)}` : `${kind}"${field}"`;
  });
  const column_words = Object.keys(columns).length > 0 ? ["any per-site setting"] : [];
  return { check: (value) => explain(value) === undefined, explain, expectation: `a list of tables with ${join_words([...field_words, ...column_words], "and")}` };
}

// Code points, not UTF-16 units, so an emoji counts once.
const line_length = (text: string): number => [...text].length;

function rule_of(row: Exclude<SettingRow, { kind: "custom" }>): Rule {
  switch (row.kind) {
    case "boolean":
      return { check: (value) => typeof value === "boolean", expectation: "true or false", listed_values: () => ["true", "false"] };
    case "enum":
      return { check: (value) => (row.values as readonly unknown[]).includes(value), expectation: enum_expectation(row.values), listed_values: () => row.values.map(String) };
    case "number": {
      const is_number = (value: unknown): value is number => typeof value === "number" && (row.whole ? Number.isInteger(value) : Number.isFinite(value));
      return { check: (value) => is_number(value) && value >= row.min, expectation: `a ${row.whole ? "whole number" : "number"}${row.unit ? ` of ${row.unit}` : ""}, ${row.min} or more` };
    }
    case "text":
      return { check: is_text, expectation: row.expectation };
    case "line":
      return {
        check: (value) => typeof value === "string" && line_length(value) >= row.min_length && line_length(value) <= row.max_length && !/[\r\n]/.test(value),
        expectation: `a string of ${row.min_length} to ${row.max_length} characters on one line`,
        listed_values: () => row.suggestions,
      };
    case "text_list":
      return { check: (value) => Array.isArray(value) && value.every(is_text), expectation: row.expectation };
    case "enum_list":
      return {
        check: (value) => Array.isArray(value) && new Set(value).size === value.length && value.every((item) => row.values.includes(item)),
        expectation: `a list of ${join_words(value_words(row.values), "and")} with no repeat`,
        listed_values: () => row.values,
      };
    case "text_table": {
      const sorted_keys = [...row.keys].sort().join();
      return {
        check: (value) => is_table(value) && Object.keys(value).sort().join() === sorted_keys && Object.values(value).every(is_text),
        expectation: `{${row.keys.map((key) => `"${key}": "..."`).join(", ")}} with non-empty strings`,
      };
    }
    case "table_list":
      return table_list_rule(row.fields, row.exclusive ?? []);
    case "site_table":
      return table_list_rule(row.fields, row.exclusive ?? [], PER_SITE_SPECS);
  }
}

type CustomName = { [K in SettingName]: (typeof SETTINGS_TABLE)[K] extends { kind: "custom" } ? K : never }[SettingName];

const CUSTOM_RULES: Record<CustomName, Rule> = {
  hint_letters: { check: (value) => typeof value === "string" && new Set(value).size === value.length && value.length >= 2 && !value.includes("/"), expectation: "a string of 2 or more distinct letters, without /" },
  palette: { check: is_text, expectation: "a theme name", listed_values: () => BUILT_IN_THEME_NAMES },
  new_tab_page: { check: (value) => is_text(value) && (value === BUILT_IN_PAGE || is_web_url(value)), expectation: `"${BUILT_IN_PAGE}" or an http or https URL`, listed_values: () => [BUILT_IN_PAGE] },
};

function spec_of(name: SettingName, row: SettingRow): SettingSpec {
  const rule = row.kind === "custom" ? CUSTOM_RULES[name as CustomName] : rule_of(row);
  return { ...rule, is_list: row.kind === "text_list" || row.kind === "enum_list", settable: row.settable !== false, is_toggle: row.kind === "boolean" };
}

export const SETTING_NAMES = Object.keys(SETTINGS_TABLE) as SettingName[];

// Built before the site table's spec, which checks each per-site column with these. A per-site setting is never a site table itself.
export const PER_SITE_SETTING_NAMES = SETTING_NAMES.filter((name): name is PerSiteName => (SETTINGS_TABLE[name] as SettingRow).per_site === true);
const PER_SITE_SPECS: ColumnSpecs = Object.fromEntries(PER_SITE_SETTING_NAMES.map((name) => [name, spec_of(name, SETTINGS_TABLE[name])]));

export const SETTING_SPECS = Object.fromEntries(SETTING_NAMES.map((name) => [name, spec_of(name, SETTINGS_TABLE[name])])) as Record<SettingName, SettingSpec>;

export function is_setting_name(name: string): name is SettingName {
  return Object.hasOwn(SETTINGS_TABLE, name);
}

export type ParsedSetting = { value: unknown } | { error: string };

// What a person types after a setting name: a list takes one word per item and `[]` is the empty list, because an empty value shows the setting instead.
export function parse_setting_text(name: SettingName, text: string): ParsedSetting {
  const spec = SETTING_SPECS[name];
  return parse_setting_words(name, spec.is_list ? (text === "[]" ? [] : text.split(/\s+/)) : [text]);
}

// A list takes one item per word. A single value tries the typed text, then the number it spells, then true or false,
// and keeps the first that the check accepts. So `300` is a number for a delay and a string for hint letters, and
// `true` is a boolean for `newtab_clock` and text for `cmdline_prompt`.
export function parse_setting_words(name: SettingName, words: readonly string[]): ParsedSetting {
  const spec = SETTING_SPECS[name];
  if (spec.is_list) return spec.check([...words]) ? { value: [...words] } : { error: `${name}: expected ${spec.expectation}` };
  const text = words.join(" ");
  const candidates: unknown[] = [text];
  if (text.trim() !== "" && Number.isFinite(Number(text))) candidates.push(Number(text));
  if (text === "true" || text === "false") candidates.push(text === "true");
  const value = candidates.find((candidate) => spec.check(candidate));
  return value === undefined ? { error: `${name}: expected ${spec.expectation}` } : { value };
}
