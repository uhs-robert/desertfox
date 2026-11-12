// Every setting, written once: its kind, its values and its default. `settings_schema.ts` derives the check, the
// expectation text and the listed values from a row, `src/shared/config_build/schemas.ts` derives the editor schema,
// `just settings-defaults` writes the defaults to `default_settings.ts`, and the `Settings` type follows below.
// Data only, so the bundles that check settings (the command line page among them) carry no prose: the editor
// descriptions live in `settings_docs.ts`.

import type { BoundInvocation } from "./invocation.ts";
import { BUILT_IN_PAGE, DEFAULT_SITE_ROW_NAMES, FALLBACK_ENGINE_NAME } from "./table_constants.ts";
import { BUILT_IN_THEME_NAMES } from "./theme_names.ts";
import { DESKTOP_PALETTE, LIGHT_INTENSITIES } from "./theme/roles.ts";

type EnumValue = string | number | boolean;

// A table from a key sequence to a binding, in the formats of a keymap entry: a command string, a list of steps, a `{ run, label, intent }` table. The build resolves the text into invocations (`BoundInvocation`), which is also what the shipped rows write. The compiler checks each command and its args with the registry validator.
export type BindStep = string | BoundInvocation;
export type BindingTable = Readonly<Record<string, BindStep | readonly BindStep[] | { run: BindStep | readonly BindStep[]; label?: string; intent?: string }>>;

// A site mode: its badge label and its own table of binds, in the same formats as `bind`.
export type SiteModeTable = Readonly<Record<string, { label: string; bind: BindingTable }>>;

type TableFields = Readonly<Record<string, { value: "text" | "web_url" | "keys" | "boolean" | "bindings" | "site_modes"; optional?: true }>>;

export type SettingRow = (
  | { kind: "boolean"; default: boolean }
  | { kind: "enum"; values: readonly EnumValue[]; default: EnumValue }
  // `whole` refuses a fraction. `unit` names what the number counts, for the expectation text. No default means an absent setting stays absent.
  | { kind: "number"; whole?: true; min: number; max?: number; unit?: string; default?: number }
  // A non-empty string. `expectation` says what it names. No default means an absent setting stays absent.
  | { kind: "text"; expectation: string; default?: string }
  // Text on one line, its length counted in code points. `suggestions` are what the command line offers, not a limit.
  | { kind: "line"; min_length: number; max_length: number; suggestions: readonly string[]; default: string }
  // `key_sequences` makes each entry a key sequence in keymap notation, checked with the key parser.
  | { kind: "text_list"; expectation: string; key_sequences?: true; default: readonly string[] }
  // Each value at most once, in any order.
  | { kind: "enum_list"; values: readonly string[]; default: readonly string[] }
  // A table of exactly these keys, each a non-empty string.
  | { kind: "text_table"; keys: readonly string[]; default: Readonly<Record<string, string>> }
  // A list of tables with these fields. A `web_url` field takes an http or https URL. A `keys` field takes key sequences in keymap notation, split by spaces. A `bindings` field takes a table from a key sequence to a binding as the keymap writes it.
  // The fields in `exclusive` refuse to appear together in one table.
  | { kind: "table_list"; fields: TableFields; exclusive?: readonly string[]; default: readonly [] }
  // A table_list whose rows also take every `per_site` setting as an optional column.
  | { kind: "site_table"; fields: TableFields; exclusive?: readonly string[]; default: readonly [] }
  // A string whose check and expectation sit in `settings_schema.ts`, with the editor schema fragment here.
  | { kind: "custom"; schema: Readonly<Record<string, unknown>>; default: string }
) & {
  // `:set` refuses it. The row says why.
  settable?: false;
  // A `site_rules` row may set it, checked by this setting's own check. On the sites the row names, its value beats every global layer, `:set --temp` included.
  per_site?: true;
};

export const SETTINGS_TABLE = {
  which_key_delay_ms: { kind: "number", min: 0, unit: "milliseconds", default: 300 },
  which_key_repeat: { kind: "boolean", default: true },
  which_key_border: { kind: "enum", values: ["square", "round", "chamfer"], default: "square" },
  // Global only: the compiled keymap carries it, and the content script compares the typed keys with it. An exact match skips the delayed open, so a prefix that also has a longer reach (`g` of `gg`) does not open its panel after the delay. An instant redraw still shows it.
  which_key_skip: { kind: "text_list", expectation: "a list of key prefixes in keymap notation", key_sequences: true, default: [] },
  hint_letters: { kind: "custom", schema: { type: "string", minLength: 2 }, default: "asdfghjkl" },
  hint_key_line: { kind: "boolean", default: true },
  // CSS selectors. Each frame resolves them against its own address. A selector that does not parse is skipped with a notice when hints start.
  hint_add: { kind: "text_list", expectation: "a list of CSS selectors", default: [], per_site: true },
  hint_remove: { kind: "text_list", expectation: "a list of CSS selectors", default: [], per_site: true },
  // Each frame resolves it against its own address, so a frame of another site follows its own rows.
  blur_on_load: { kind: "boolean", default: false, per_site: true },
  // CSS selectors for what counts as a text field in a frame, so insert mode follows focus there. `editable_add` makes matches count, `editable_remove` makes them not count and wins. With `editable_remove_unsized` the removal holds only while the element has no width.
  editable_add: { kind: "text_list", expectation: "a list of CSS selectors", default: [], per_site: true },
  editable_remove: { kind: "text_list", expectation: "a list of CSS selectors", default: [], per_site: true },
  editable_remove_unsized: { kind: "boolean", default: false, per_site: true },
  // Each frame resolves it against its own address. Set it only for sites whose editor handles Escape itself: in a field, insert mode then keeps Escape for the page and ends when the page drops the field.
  escape_to_page: { kind: "boolean", default: false, per_site: true },
  // A CSS selector for the element that the scroll commands scroll on the site, for an app with an inner scroll area. It wins over the focus chain. A match that cannot scroll on the axis, a selector that does not parse and no match all leave the usual choice.
  scroll_selector: { kind: "custom", schema: { type: "string" }, default: "", per_site: true },
  // Each column resolves on its own: the first row whose `site` matches the page and that sets the column decides it. `pass` and `only` form one column, the key rule.
  // `bind` is the one column that merges key by key: for each key, the first matching row that binds it decides. It binds normal-mode keys and runs before `pass` and `only` prune the tree.
  // `modes.<name> = { label, bind }` is a site mode: a set of binds laid over normal mode while `mode.site <name>` has it on. The first row that has the mode decides it, whole. Escape, any key DesertFox does not cancel, a mousedown, any mode change and a keymap update end it.
  // `off = true` turns every normal-mode key off, and so does a row that sets nothing but `site`.
  // Settable, though `:set` has no typed form for a list of tables: the popup saves rows, and a saved edit of an unsettable setting is dropped when the edits load.
  site_rules: { kind: "site_table", fields: { site: { value: "text" }, off: { value: "boolean", optional: true }, pass: { value: "keys", optional: true }, only: { value: "keys", optional: true }, bind: { value: "bindings", optional: true }, modes: { value: "site_modes", optional: true } }, exclusive: ["pass", "only"], default: [] },
  // Names of the site rows that ship with DesertFox (`src/background/default_site_rows.ts`) to turn off.
  default_site_rows_off: { kind: "enum_list", values: DEFAULT_SITE_ROW_NAMES, default: [] },
  // Matched as lowercase text of a link or button, in order: an earlier entry wins. A 1 or 2 character entry must be the whole text.
  // "back" stays out of the prev list: it would match a "Back to top" footer link on a page with no previous page.
  next_patterns: { kind: "text_list", expectation: "a list of link texts", default: ["next", "more", "newer", ">", "\u203a", "\u2192", "\u00bb", "\u226b", ">>"] },
  prev_patterns: { kind: "text_list", expectation: "a list of link texts", default: ["prev", "previous", "older", "<", "\u2039", "\u2190", "\u00ab", "\u226a", "<<"] },
  // A name, or a prefix before a final `*`, compared in lowercase. An empty list turns the stripping off on every site, whatever `strip_tracking` says.
  strip_tracking_params: { kind: "text_list", expectation: "a list of query parameter names", default: ["utm_*", "fbclid", "gclid", "dclid", "msclkid", "mc_eid", "igshid", "yclid", "_hsenc", "_hsmi", "mkt_tok"] },
  // Whether copying a web address from the site drops the `strip_tracking_params` names. A site row turns it off (all sites except those) or, with the global value off, on (no site except those).
  strip_tracking: { kind: "boolean", default: true, per_site: true },
  // No default: a tab keeps the zoom Firefox remembers for the site until a site row or `:set` gives one. Firefox's own zoom range.
  zoom: { kind: "number", min: 0.3, max: 5, per_site: true },
  // The quality rule for site players (see `src/background/media_quality.ts`): `off` leaves the site alone, `auto` hands the choice to the site, `max` and `min` take an end, a height takes the highest level at or below it.
  media_quality: { kind: "enum", values: ["off", "auto", "max", "min", 144, 240, 360, 480, 720, 1080, 1440, 2160, 4320], default: "max", per_site: true },
  // The file extension of the scratch file `text.edit_external` opens, so the editor picks a filetype. The empty default means the file has no extension.
  editor_ext: { kind: "custom", schema: { type: "string", pattern: "^[A-Za-z0-9]{0,10}$" }, default: "", per_site: true },
  mode_indicator: { kind: "enum", values: ["always", "not_normal", "off"], default: "always" },
  // The theme names are examples, not an enum: a theme file in the config directory takes any name. `desktop` follows the palette the desktop pushed over the bridge.
  palette: { kind: "custom", schema: { type: "string", minLength: 1, examples: [DESKTOP_PALETTE, ...BUILT_IN_THEME_NAMES] }, default: "oasis_moonlight" },
  light_intensity: { kind: "enum", values: LIGHT_INTENSITIES, default: 3 },
  // A live change to a prefix could collide with other keys, so `:set` refuses the prefix tables.
  search_prefixes: { kind: "text_table", keys: ["here", "tab"], default: { here: "s", tab: "S" }, settable: false },
  container_prefixes: { kind: "text_table", keys: ["reopen", "tab"], default: { reopen: "c", tab: "C" }, settable: false },
  // No default: without one, `page.home` refuses.
  home_page: { kind: "text", expectation: "a non-empty URL string" },
  default_engine: { kind: "text", expectation: "the name of a search engine", default: FALLBACK_ENGINE_NAME },
  new_tab_page: { kind: "custom", schema: { type: "string", pattern: `^(${BUILT_IN_PAGE}|https?://\\S+)$` }, default: BUILT_IN_PAGE },
  // Opens the native bridge port. Needs the optional `nativeMessaging` permission and the bridge host, see host/README.md.
  bridge: { kind: "boolean", default: false },
  // Lets bridge programs list tabs (titles and addresses of normal windows), activate, close and capture them, and run a command on a chosen tab. Needs `bridge`.
  bridge_share_tabs: { kind: "boolean", default: false },
  // Consent to update the native hosts to the extension's version on connect. Asked once from the :native.install page, off until then.
  host_auto_update: { kind: "boolean", default: false },
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

type FieldValue<F> = F extends { value: "boolean" } ? boolean : F extends { value: "bindings" } ? BindingTable : F extends { value: "site_modes" } ? SiteModeTable : F extends { value: "text" | "web_url" | "keys" } ? string : never;
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
                : Row extends { kind: "site_table"; fields: infer Fields }
                  ? Simplify<TableOf<Fields> & PerSiteValues>[]
                  : never;

export type PerSiteName = { [K in SettingName]: Table[K] extends { per_site: true } ? K : never }[SettingName];
type PerSiteValues = { -readonly [K in PerSiteName]?: ValueOf<Table[K]> };

type HasDefault<Row> = Row extends { default: unknown } ? true : false;

// Every setting with a default is always present in the settings in force. Only a setting without one is optional.
export type Settings = Simplify<
  { -readonly [K in SettingName as HasDefault<Table[K]> extends true ? K : never]: ValueOf<Table[K]> } & {
    -readonly [K in SettingName as HasDefault<Table[K]> extends true ? never : K]?: ValueOf<Table[K]>;
  }
>;
