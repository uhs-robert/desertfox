// What each setting accepts, derived from its row in `settings_table.ts`: the build tool checks settings.toml with
// it, `:set` checks a typed value with it and the generator of `setting_completion.ts` reads names and values from it. Background
// and build tools import this module. The content script and the command line page must not: the first has a
// 17 KB budget and neither needs it.

import { BUILT_IN_PAGE, is_web_url } from "./config.ts";
import { is_choice_list, is_run_table } from "./invocation.ts";
import { parse_sequence } from "./keys/notation.ts";
import { MAX_BIND_CHOICES, MAX_BIND_STEPS } from "./table_constants.ts";
import { SETTINGS_TABLE, SITE_KEYMAP_MODES, type PerSiteName, type SettingName, type SettingRow } from "./settings_table.ts";
import { BUILT_IN_THEME_NAMES } from "./theme_names.ts";
import { parse_font_family } from "./theme/font_family.ts";
import { DESKTOP_THEME } from "./theme/roles.ts";

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
    if (rule.value === "bindings") {
      const binding_problem = bindings_problem(field_value);
      if (binding_problem === undefined) continue;
      return `has a field "${field}" that ${binding_problem}`;
    }
    if (rule.value === "site_modes") {
      const modes_problem = site_modes_problem(field_value);
      if (modes_problem === undefined) continue;
      return `has a field "${field}" that ${modes_problem}`;
    }
    if (rule.value === "mode_bindings") {
      const mode_problem = mode_bindings_problem(field_value);
      if (mode_problem === undefined) continue;
      return `has a field "${field}" that ${mode_problem}`;
    }
    if (is_text(field_value) && (rule.value !== "web_url" || is_web_url(field_value))) continue;
    if (rule.optional) return `has an empty or non-text "${field}"`;
    return rule.value === "web_url" ? `needs an http or https "${field}"` : `needs a non-empty "${field}"`;
  }
  for (const [name, spec] of Object.entries(columns)) {
    if (value[name] !== undefined && !spec.check(value[name])) return `has a field "${name}" that is not ${spec.expectation}`;
  }
  const clash = bind_keymap_clash(value);
  if (clash !== undefined) return `binds "${clash}" in both "bind" and "keymap.normal", and a key may be in only one of them`;
  const present = exclusive.filter((field) => value[field] !== undefined);
  return present.length > 1 ? `sets both ${join_words(present.map((field) => `"${field}"`), "and")}, and only one may be set` : undefined;
}

// What one step of a bind may be: command text, or an invocation as the build resolves it. `run` and a step list hold either.
function bind_steps_problem(steps: unknown): string | undefined {
  const list = Array.isArray(steps) ? steps : [steps];
  if (list.length === 0 || list.length > MAX_BIND_STEPS) return `has ${list.length === 0 ? "no step" : `more than ${MAX_BIND_STEPS} steps`}`;
  for (const [index, step] of list.entries()) {
    if (is_text(step)) continue;
    if (is_run_table(step)) return 'mixes choices ({ run } tables) with steps, and a list holds only one kind';
    if (!is_table(step) || !is_text(step.id)) return 'has a step that is neither a command string nor a table with an "id"';
    const unknown_field = Object.keys(step).find((name) => !["id", "args", "prompt", ...BIND_TEXT_FIELDS].includes(name));
    if (unknown_field !== undefined) return `has a step with the unknown field "${unknown_field}"`;
    if ((step.args !== undefined && !is_table(step.args)) || (step.prompt !== undefined && !is_table(step.prompt))) return 'has a step with "args" or "prompt" that is not a table';
    if (BIND_TEXT_FIELDS.some((name) => step[name] !== undefined && typeof step[name] !== "string")) return `has a step with ${TEXT_FIELDS_PHRASE} that is not text`;
    // A guard guards the whole bind and is read from its first step only, so on a later step it would be ignored.
    const guard = index === 0 ? undefined : GUARD_FIELDS.find((name) => step[name] !== undefined);
    if (guard !== undefined) return `has "${guard}" on step ${index + 1}, but only the first step can carry a guard (for choices, write a list of { run, ${guard} } tables)`;
  }
  return undefined;
}

const GUARD_FIELDS = ["when_focus", "when_present"];
const BIND_TEXT_FIELDS = ["label", "intent", ...GUARD_FIELDS];
const TEXT_FIELDS_PHRASE = 'a "label", "intent", "when_focus" or "when_present"';

// A choice's guards, on its `run` table or on its first step as the build stores it.
const has_guard = (choice: unknown): boolean => {
  const fields = is_run_table(choice) ? choice : Array.isArray(choice) && is_table(choice[0]) ? choice[0] : {};
  return GUARD_FIELDS.some((name) => fields[name] !== undefined);
};

// What is wrong with one binding, worded to follow `binds "<key>" `.
function binding_problem(binding: unknown): string | undefined {
  if (is_choice_list(binding)) {
    if (binding.length > MAX_BIND_CHOICES) return `to more than ${MAX_BIND_CHOICES} choices`;
    for (const [index, choice] of binding.entries()) {
      if (is_choice_list(choice)) return `in choice ${index + 1} to another list of choices`;
      const problem = binding_problem(choice);
      if (problem !== undefined) return `in choice ${index + 1} ${problem}`;
      // The first choice whose guards hold runs, so a choice without a guard ends the list.
      if (index < binding.length - 1 && !has_guard(choice)) return `in choice ${index + 1} with no "when_present" or "when_focus", so the choices after it never run`;
    }
    return undefined;
  }
  if (is_run_table(binding)) {
    const unknown_field = Object.keys(binding).find((name) => !["run", ...BIND_TEXT_FIELDS].includes(name));
    if (unknown_field !== undefined) return `with the unknown field "${unknown_field}"`;
    if (BIND_TEXT_FIELDS.some((name) => binding[name] !== undefined && typeof binding[name] !== "string")) return `with ${TEXT_FIELDS_PHRASE} that is not text`;
  }
  const problem = bind_steps_problem(is_run_table(binding) ? binding.run : binding);
  return problem === undefined ? undefined : `to something that ${problem}`;
}

// Whether each key is valid notation and each value is a binding as the keymap writes it: a command string, a list of steps, a `{ run, label, intent, when_focus, when_present }` table, or an invocation table `{ id, args }`, which is what the build stores. A site row bind may also be a list of choices. Whether the command exists and takes the args is the compiler's check, with the registry validator.
function bindings_problem(value: unknown): string | undefined {
  if (!is_table(value) || Object.keys(value).length === 0) return "is not a table of keys to commands";
  for (const [key, binding] of Object.entries(value)) {
    const { error } = parse_sequence(key);
    if (error !== undefined) return `binds "${key}", which ${error}`;
    const problem = binding_problem(binding);
    if (problem !== undefined) return `binds "${key}" ${problem}`;
  }
  return undefined;
}

// One table of binds per keymap mode, each following the rules of the `bind` column. Only the modes a site row can bind are accepted.
function mode_bindings_problem(value: unknown): string | undefined {
  if (!is_table(value) || Object.keys(value).length === 0) return "is not a table of keymap modes to binds";
  for (const [mode, table] of Object.entries(value)) {
    if (!(SITE_KEYMAP_MODES as readonly string[]).includes(mode)) return `names the mode "${mode}", which a site row cannot bind (use ${join_words(SITE_KEYMAP_MODES.map((name) => `"${name}"`), "or")})`;
    const problem = bindings_problem(table);
    if (problem !== undefined) return `has the mode "${mode}" whose table ${problem}`;
  }
  return undefined;
}

// `bind` is the short form of `keymap.normal`, so a key in both is a mistake. Keys are compared as the keymap reads them, so `<c-a>` and `<C-a>` meet. Whether each table is valid is checked before this runs, so a table that is not valid is skipped.
function bind_keymap_clash(row: Record<string, unknown>): string | undefined {
  const normal = is_table(row.keymap) ? row.keymap.normal : undefined;
  if (!is_table(row.bind) || !is_table(normal)) return undefined;
  const written = new Map<string, string>();
  for (const key of Object.keys(row.bind)) written.set(parse_sequence(key).tokens?.join("") ?? key, key);
  return Object.keys(normal).find((key) => written.has(parse_sequence(key).tokens?.join("") ?? key));
}

// The rule of the editor schema's ONE_LINE_TEXT: not blank, no control character.
const is_one_line_text = (value: unknown): value is string => typeof value === "string" && /^(?!\s*$)[^\u0000-\u001F\u007F-\u009F]+$/.test(value);

// A mode name goes in `mode.site <name>`, and `off` there ends the mode, so a mode cannot take it.
const SITE_MODE_NAME = /^[a-z][a-z0-9_]*$/;

// Each mode is a table with a `label` for the badge and a `bind` table that follows the rules of the `bind` column.
function site_modes_problem(value: unknown): string | undefined {
  if (!is_table(value) || Object.keys(value).length === 0) return "is not a table of mode names to modes";
  for (const [name, mode] of Object.entries(value)) {
    if (!SITE_MODE_NAME.test(name) || name === "off") return `names the mode "${name}", which is not a lowercase word other than "off"`;
    if (!is_table(mode)) return `has the mode "${name}", which is not a table`;
    const unknown_field = Object.keys(mode).find((field) => field !== "label" && field !== "bind" && field !== "sticky");
    if (unknown_field !== undefined) return `has the mode "${name}" with the unknown field "${unknown_field}"`;
    if (!is_one_line_text(mode.label)) return `has the mode "${name}" with no one-line "label"`;
    if (mode.sticky !== undefined && typeof mode.sticky !== "boolean") return `has the mode "${name}" with a "sticky" that is not true or false`;
    const problem = bindings_problem(mode.bind);
    if (problem !== undefined) return `has the mode "${name}" with a "bind" that ${problem}`;
  }
  return undefined;
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
  const optional_kind = (value: string): string => (value === "keys" ? " of key sequences" : value === "bindings" ? " of keys to commands" : value === "site_modes" ? " of modes that each have a label plus a bind" : value === "mode_bindings" ? " of binds per mode" : value === "boolean" ? " of true or false" : "");
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
      const range = row.max === undefined ? `${row.min} or more` : `from ${row.min} to ${row.max}`;
      return { check: (value) => is_number(value) && value >= row.min && value <= (row.max ?? Infinity), expectation: `a ${row.whole ? "whole number" : "number"}${row.unit ? ` of ${row.unit}` : ""}, ${range}` };
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
      return { check: (value) => Array.isArray(value) && value.every((item) => is_text(item) && (!row.key_sequences || parse_sequence(item).error === undefined)), expectation: row.expectation };
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

const FONT_FAMILY_EXPECTATION = "up to 8 font names separated by commas, at most 200 characters, or empty for none";

const CUSTOM_RULES: Record<CustomName, Rule> = {
  hint_letters: { check: (value) => typeof value === "string" && new Set(value).size === value.length && value.length >= 2 && !value.includes("/"), expectation: "a string of 2 or more distinct letters, without /" },
  editor_ext: { check: (value) => typeof value === "string" && /^[A-Za-z0-9]{0,10}$/.test(value), expectation: "a file extension of up to 10 letters or digits, without a dot, or empty for none" },
  scroll_selector: { check: (value) => typeof value === "string", expectation: "a CSS selector, or empty for none" },
  focus_on_load: { check: (value) => typeof value === "string", expectation: "a CSS selector, or empty for none" },
  theme: { check: is_text, expectation: "a theme name", listed_values: () => [DESKTOP_THEME, ...BUILT_IN_THEME_NAMES] },
  font_family: { check: (value) => parse_font_family(value) !== undefined, expectation: FONT_FAMILY_EXPECTATION },
  font_family_mono: { check: (value) => parse_font_family(value) !== undefined, expectation: FONT_FAMILY_EXPECTATION },
  new_tab_page: { check: (value) => is_text(value) && (value === BUILT_IN_PAGE || is_web_url(value)), expectation: `"${BUILT_IN_PAGE}" or an http or https URL`, listed_values: () => [BUILT_IN_PAGE] },
};

function spec_of(name: SettingName, row: SettingRow): SettingSpec {
  const rule = row.kind === "custom" ? CUSTOM_RULES[name as CustomName] : rule_of(row);
  return { ...rule, is_list: row.kind === "text_list" || row.kind === "enum_list", settable: row.settable !== false, is_toggle: row.kind === "boolean" };
}

export const SETTING_NAMES = Object.keys(SETTINGS_TABLE) as SettingName[];
const BROWSER_KEPT_KINDS: ReadonlySet<string> = new Set(["site_table", "text_table"]);

// Built before the site table's spec, which checks each per-site column with these. A per-site setting is never a site table itself.
export const PER_SITE_SETTING_NAMES = SETTING_NAMES.filter((name): name is PerSiteName => (SETTINGS_TABLE[name] as SettingRow).per_site === true);
const PER_SITE_SPECS: ColumnSpecs = Object.fromEntries(PER_SITE_SETTING_NAMES.map((name) => [name, spec_of(name, SETTINGS_TABLE[name])]));

export const SETTING_SPECS = Object.fromEntries(SETTING_NAMES.map((name) => [name, spec_of(name, SETTINGS_TABLE[name])])) as Record<SettingName, SettingSpec>;

// Each of these is a consent the user gives on this machine, so a file from elsewhere must not switch it on, and a change stays in the browser.
export const CONSENT_SETTINGS = ["bridge", "bridge_share_tabs", "host_auto_update", "newtab_ip_info"] as const;

// The settings that `:set`, `:toggle`, `:unset` and the pages write into settings.toml (`change_setting` with layer `file`) rather than into the saved edits.
// Every settable scalar, list and `[[table]]` list but `site_rules`: a Reset of it would drop every hand-written rule, so the popup changes its rows one at a time (`change_site_rule_in_file`).
export const FILE_WRITTEN_SETTINGS: ReadonlySet<string> = new Set<SettingName>(
  SETTING_NAMES.filter((name) => SETTING_SPECS[name].settable && !BROWSER_KEPT_KINDS.has(SETTINGS_TABLE[name].kind) && !(CONSENT_SETTINGS as readonly string[]).includes(name)),
);

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
