// What each setting accepts, in one place: the build tool checks settings.toml with it, `:set` checks a typed value
// with it and the command line completes names and values from it. Background, extension pages and build tools import
// this module. The content script must not: it has a 15 KB budget and needs none of this.

import { BUILT_IN_PAGE, is_web_url, MODE_INDICATOR_VALUES, WHICH_KEY_BORDER_VALUES } from "./config.ts";
import type { Settings } from "./config.ts";
import { BUILT_IN_THEME_NAMES } from "./theme_names.ts";
import { LIGHT_INTENSITIES } from "./theme/roles.ts";

export type SettingSpec = {
  check: (value: unknown) => boolean;
  // What a valid value looks like, in the words of a problem message: "expected <expectation>".
  expectation: string;
  // One word per list item on the command line, instead of one value.
  is_list?: boolean;
  // A table of several values. A live change could collide with other keys, so `:set` refuses it.
  is_group?: boolean;
  // A boolean `:set name!` flips. The value is what an absent setting reads as.
  flips_from_absent?: boolean;
  // Values the command line offers for the second word. A function, and short lists only: the command line page bundles this module, so it must not import the theme color tables (25 KB). The theme names come from the names-only `theme_names.ts`.
  listed_values?: () => readonly string[];
};

const is_text = (value: unknown): value is string => typeof value === "string" && value !== "";
const is_whole = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const is_boolean = (value: unknown): boolean => typeof value === "boolean";

function is_prefix_pair(value: unknown, first_key: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join() !== [first_key, "tab"].sort().join()) return false;
  return Object.values(value).every(is_text);
}

const true_or_false = ["true", "false"] as const;

export const SETTING_SPECS: Record<keyof Settings, SettingSpec> = {
  which_key_delay_ms: { check: (value) => typeof value === "number" && Number.isFinite(value) && value >= 0, expectation: "a number of milliseconds, 0 or more" },
  which_key_border: { check: (value) => (WHICH_KEY_BORDER_VALUES as readonly unknown[]).includes(value), expectation: '"square", "round" or "chamfer"', listed_values: () => WHICH_KEY_BORDER_VALUES },
  hint_letters: { check: (value) => typeof value === "string" && new Set(value).size === value.length && value.length >= 2, expectation: "a string of 2 or more distinct letters" },
  ignore_sites: { check: (value) => Array.isArray(value) && value.every(is_text), expectation: "a list of match pattern strings", is_list: true },
  mode_indicator: { check: (value) => (MODE_INDICATOR_VALUES as readonly unknown[]).includes(value), expectation: '"always", "not_normal" or "off"', listed_values: () => MODE_INDICATOR_VALUES },
  palette: { check: is_text, expectation: "a theme name", listed_values: () => BUILT_IN_THEME_NAMES },
  light_intensity: { check: (value) => (LIGHT_INTENSITIES as readonly unknown[]).includes(value), expectation: "a whole number from 1 to 5", listed_values: () => LIGHT_INTENSITIES.map(String) },
  search_prefixes: { check: (value) => is_prefix_pair(value, "here"), expectation: '{"here": "...", "tab": "..."} with non-empty strings', is_group: true },
  container_prefixes: { check: (value) => is_prefix_pair(value, "reopen"), expectation: '{"reopen": "...", "tab": "..."} with non-empty strings', is_group: true },
  home_page: { check: is_text, expectation: "a non-empty URL string" },
  default_engine: { check: is_text, expectation: "the name of a search engine" },
  new_tab_page: { check: (value) => is_text(value) && (value === BUILT_IN_PAGE || is_web_url(value)), expectation: `"${BUILT_IN_PAGE}" or an http or https URL`, listed_values: () => [BUILT_IN_PAGE] },
  completion_all_windows: { check: is_boolean, expectation: "true or false", flips_from_absent: false, listed_values: () => true_or_false },
  cmdline_prompt: { check: (value) => typeof value === "string" && [...value].length >= 1 && [...value].length <= 8 && !/[\r\n]/.test(value), expectation: "a string of 1 to 8 characters on one line", listed_values: () => ["caret", "colon"] },
  open_completion: { check: (value) => Array.isArray(value) && new Set(value).size === value.length && value.every((source) => source === "bookmarks" || source === "history"), expectation: 'a list of "bookmarks" and "history" with no repeat', is_list: true, listed_values: () => ["bookmarks", "history"] },
  history_completion_max: { check: (value) => is_whole(value) && value >= 0, expectation: "a whole number, 0 or more" },
  newtab_clock: { check: (value) => is_boolean(value) || value === "analog" || value === "digital", expectation: 'true, false, "analog" or "digital"', listed_values: () => ["true", "false", "analog", "digital"] },
  newtab_date: { check: is_boolean, expectation: "true or false", flips_from_absent: true, listed_values: () => true_or_false },
  newtab_clock_format: { check: (value) => value === 12 || value === 24, expectation: "12 or 24", listed_values: () => ["12", "24"] },
  open_quick_start_on_install: { check: is_boolean, expectation: "true or false", flips_from_absent: true, listed_values: () => true_or_false },
};

export const SETTING_NAMES = Object.keys(SETTING_SPECS) as (keyof Settings)[];

export function is_setting_name(name: string): name is keyof Settings {
  return Object.hasOwn(SETTING_SPECS, name);
}

export type ParsedSetting = { value: unknown } | { error: string };

// A list takes one item per word. A single value tries the typed text, then the number it spells, then true or false,
// and keeps the first that the check accepts. So `300` is a number for a delay and a string for hint letters, and
// `true` is a boolean for `newtab_clock` and text for `cmdline_prompt`.
export function parse_setting_words(name: keyof Settings, words: readonly string[]): ParsedSetting {
  const spec = SETTING_SPECS[name];
  if (spec.is_list) return spec.check([...words]) ? { value: [...words] } : { error: `${name}: expected ${spec.expectation}` };
  const text = words.join(" ");
  const candidates: unknown[] = [text];
  if (text.trim() !== "" && Number.isFinite(Number(text))) candidates.push(Number(text));
  if (text === "true" || text === "false") candidates.push(text === "true");
  const value = candidates.find((candidate) => spec.check(candidate));
  return value === undefined ? { error: `${name}: expected ${spec.expectation}` } : { value };
}
