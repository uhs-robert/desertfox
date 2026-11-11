// Every setting, written once: its kind, its values and its default. `settings_schema.ts` derives the check, the
// expectation text and the listed values from a row, `src/shared/config_build/schemas.ts` derives the editor schema,
// `just settings-defaults` writes the defaults to `default_settings.ts`, and the `Settings` type follows below.
// Data only, so the bundles that check settings (the command line page among them) carry no prose: the editor
// descriptions live in `settings_docs.ts`.

import { BUILT_IN_PAGE, FALLBACK_ENGINE_NAME } from "./table_constants.ts";
import { BUILT_IN_THEME_NAMES } from "./theme_names.ts";
import { LIGHT_INTENSITIES } from "./theme/roles.ts";

type EnumValue = string | number | boolean;

export type SettingRow = (
  | { kind: "boolean"; default: boolean }
  | { kind: "enum"; values: readonly EnumValue[]; default: EnumValue }
  // `whole` refuses a fraction. `unit` names what the number counts, for the expectation text.
  | { kind: "number"; whole?: true; min: number; unit?: string; default: number }
  // A non-empty string. `expectation` says what it names. No default means an absent setting stays absent.
  | { kind: "text"; expectation: string; default?: string }
  // Text on one line, its length counted in code points. `suggestions` are what the command line offers, not a limit.
  | { kind: "line"; min_length: number; max_length: number; suggestions: readonly string[]; default: string }
  | { kind: "text_list"; expectation: string; default: readonly string[] }
  // Each value at most once, in any order.
  | { kind: "enum_list"; values: readonly string[]; default: readonly string[] }
  // A table of exactly these keys, each a non-empty string.
  | { kind: "text_table"; keys: readonly string[]; default: Readonly<Record<string, string>> }
  // A list of tables with these fields. A `web_url` field takes an http or https URL. A `keys` field takes key sequences in keymap notation, split by spaces.
  // The fields in `exclusive` refuse to appear together in one table.
  | { kind: "table_list"; fields: Readonly<Record<string, { value: "text" | "web_url" | "keys"; optional?: true }>>; exclusive?: readonly string[]; default: readonly [] }
  // A string whose check and expectation sit in `settings_schema.ts`, with the editor schema fragment here.
  | { kind: "custom"; schema: Readonly<Record<string, unknown>>; default: string }
) & {
  // `:set` refuses it. The row says why.
  settable?: false;
};

export const SETTINGS_TABLE = {
  which_key_delay_ms: { kind: "number", min: 0, unit: "milliseconds", default: 300 },
  which_key_border: { kind: "enum", values: ["square", "round", "chamfer"], default: "square" },
  hint_letters: { kind: "custom", schema: { type: "string", minLength: 2 }, default: "asdfghjkl" },
  // The first row whose `site` matches the page wins. `pass` lists keys that go to the page, `only` lists the only keys that stay on, and a row with neither turns every normal-mode key off.
  // Settable, though `:set` has no typed form for a list of tables: the popup saves rows, and a saved edit of an unsettable setting is dropped when the edits load.
  site_rules: { kind: "table_list", fields: { site: { value: "text" }, pass: { value: "keys", optional: true }, only: { value: "keys", optional: true } }, exclusive: ["pass", "only"], default: [] },
  // Matched as lowercase text of a link or button, in order: an earlier entry wins. A 1 or 2 character entry must be the whole text.
  // "back" stays out of the prev list: it would match a "Back to top" footer link on a page with no previous page.
  next_patterns: { kind: "text_list", expectation: "a list of link texts", default: ["next", "more", "newer", ">", "\u203a", "\u2192", "\u00bb", "\u226b", ">>"] },
  prev_patterns: { kind: "text_list", expectation: "a list of link texts", default: ["prev", "previous", "older", "<", "\u2039", "\u2190", "\u00ab", "\u226a", "<<"] },
  mode_indicator: { kind: "enum", values: ["always", "not_normal", "off"], default: "always" },
  // The theme names are examples, not an enum: a theme file in the config directory takes any name.
  palette: { kind: "custom", schema: { type: "string", minLength: 1, examples: BUILT_IN_THEME_NAMES }, default: "oasis_moonlight" },
  light_intensity: { kind: "enum", values: LIGHT_INTENSITIES, default: 3 },
  // A live change to a prefix could collide with other keys, so `:set` refuses the prefix tables.
  search_prefixes: { kind: "text_table", keys: ["here", "tab"], default: { here: "s", tab: "S" }, settable: false },
  container_prefixes: { kind: "text_table", keys: ["reopen", "tab"], default: { reopen: "c", tab: "C" }, settable: false },
  // No default: without one, `page.home` refuses.
  home_page: { kind: "text", expectation: "a non-empty URL string" },
  default_engine: { kind: "text", expectation: "the name of a search engine", default: FALLBACK_ENGINE_NAME },
  new_tab_page: { kind: "custom", schema: { type: "string", pattern: `^(${BUILT_IN_PAGE}|https?://\\S+)$` }, default: BUILT_IN_PAGE },
  completion_all_windows: { kind: "boolean", default: false },
  cmdline_prompt: { kind: "line", min_length: 1, max_length: 8, suggestions: ["caret", "colon"], default: "caret" },
  open_completion: { kind: "enum_list", values: ["bookmarks", "history"], default: ["bookmarks", "history"] },
  // List order is display order. An empty list hides the status area.
  statusbar_widgets: { kind: "enum_list", values: ["url", "scroll", "tabs"], default: ["url", "scroll", "tabs"] },
  history_completion_max: { kind: "number", whole: true, min: 0, default: 10 },
  history_list_max: { kind: "number", whole: true, min: 0, default: 20 },
  // `true` means analog, as it did before the digital face.
  newtab_clock: { kind: "enum", values: [true, false, "analog", "digital"], default: true },
  newtab_date: { kind: "boolean", default: true },
  newtab_clock_format: { kind: "enum", values: [12, 24], default: 12 },
  newtab_bookmarks: { kind: "boolean", default: false },
  newtab_bookmarks_max: { kind: "number", whole: true, min: 0, default: 8 },
  newtab_recent_tabs: { kind: "boolean", default: false },
  newtab_recent_tabs_max: { kind: "number", whole: true, min: 0, default: 8 },
  // A list of tables has no typed form, so `:set` refuses it.
  newtab_links: { kind: "table_list", fields: { label: { value: "text" }, url: { value: "web_url" }, group: { value: "text", optional: true } }, default: [], settable: false },
} as const satisfies Record<string, SettingRow>;

type Table = typeof SETTINGS_TABLE;
export type SettingName = keyof Table;

type Simplify<T> = { [K in keyof T]: T[K] };

type FieldValue<F> = F extends { value: "text" | "web_url" | "keys" } ? string : never;
type TableOf<Fields> = Simplify<
  { -readonly [K in keyof Fields as Fields[K] extends { optional: true } ? never : K]: FieldValue<Fields[K]> } & {
    -readonly [K in keyof Fields as Fields[K] extends { optional: true } ? K : never]?: FieldValue<Fields[K]>;
  }
>;

type ValueOf<Row> = Row extends { kind: "boolean" }
  ? boolean
  : Row extends { kind: "enum"; values: readonly (infer Value)[] }
    ? Value
    : Row extends { kind: "number" }
      ? number
      : Row extends { kind: "text" | "line" | "custom" }
        ? string
        : Row extends { kind: "text_list" }
          ? string[]
          : Row extends { kind: "enum_list"; values: readonly (infer Value)[] }
            ? Value[]
            : Row extends { kind: "text_table"; keys: readonly (infer Key extends string)[] }
              ? { [K in Key]: string }
              : Row extends { kind: "table_list"; fields: infer Fields }
                ? TableOf<Fields>[]
                : never;

type HasDefault<Row> = Row extends { default: unknown } ? true : false;

// Every setting with a default is always present in the settings in force. Only a setting without one is optional.
export type Settings = Simplify<
  { -readonly [K in SettingName as HasDefault<Table[K]> extends true ? K : never]: ValueOf<Table[K]> } & {
    -readonly [K in SettingName as HasDefault<Table[K]> extends true ? never : K]?: ValueOf<Table[K]>;
  }
>;
