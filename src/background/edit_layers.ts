// The browser edit layers over the config files, one storage key per kind. Each one wins over the files and survives a reload, an import and a files editor save.
// Saved settings are not in this table: they have their own temp layer, schema and host mirror (`config_load.ts`). They share only the change queue and the publish.

import { parse_sequence, to_firefox_shortcut } from "../shared/keys/index.ts";
import type { KeymapMode } from "../shared/keymap.ts";
import { KEYMAP_MODES } from "../shared/config_build/merge.ts";
import { theme_name_shape_problem } from "../shared/theme/base16.ts";
import { ROLES } from "../shared/theme/roles.ts";
import type { RoleColors, Theme } from "../shared/theme/roles.ts";
import { local_theme_problem, parse_color } from "../shared/theme/theme_file.ts";
import { ALIAS_EDITS_STORAGE_KEY, ENGINE_EDITS_STORAGE_KEY, KEYMAP_EDITS_STORAGE_KEY, THEME_EDITS_STORAGE_KEY } from "./storage_keys.ts";

// Mode to key sequence to the command text, as keymap.toml writes it. `""` unbinds a default or file binding.
export type KeymapEdits = Partial<Record<KeymapMode, Record<string, string>>>;

// The search engines the browser adds, in the shape search_engines.toml and keymap.toml write them, so an export is `stringify` of each part.
// `engines` is a table per engine name with child tables inside, and the build is the only judge of the fields. `letters` maps a key letter to an engine name, as `[search_keys]` does: the form's key letter lives and dies with its engine, and keymap.d carries it on export.
export type EngineEdits = { engines?: Record<string, Record<string, unknown>>; letters?: Record<string, string> };

// The command aliases the browser adds, alias name to command id, as command_aliases.toml writes them. The build checks the name and the target.
export type AliasEdits = Record<string, string>;

// The themes the base16 importer saved, by theme name. Each has every role filled. Unlike the engines and aliases they do not go through the config build: `publish` lays them over the theme files, and an export writes each as `themes/<name>.toml`.
export type ThemeEdits = Record<string, Theme>;

// A layer with nothing in it is left out of `load_layers` unless it is `keymap`, which every reader already expects.
export type EditLayers = { keymap: KeymapEdits; engines?: EngineEdits; aliases?: AliasEdits; themes?: ThemeEdits };
export type LayerKind = keyof EditLayers;
export type LayerOf<K extends LayerKind> = NonNullable<EditLayers[K]>;

type LayerSpec<K extends LayerKind> = {
  storage_key: string;
  // Keeps what is still valid. A stored value from an older version or a hand edit is dropped, not trusted.
  check: (stored: unknown) => LayerOf<K>;
  optional: boolean;
};

const is_record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// A Firefox shortcut takes one chord Firefox accepts, so `browser` keys get its check, as the config build does.
export function key_problem(mode: KeymapMode, keys: string): string | undefined {
  return mode === "browser" ? to_firefox_shortcut(keys).error : parse_sequence(keys).error;
}

// The sequence as the compiled tree spells it, so `<A-J>` and `<A-j>` are one edit and replace the default `<A-j>`.
export function normalized_keys(mode: KeymapMode, keys: string): { keys: string; tokens: string[] } | { problem: string } {
  const problem = key_problem(mode, keys);
  if (problem !== undefined) return { problem };
  const tokens = parse_sequence(keys).tokens!;
  return { keys: tokens.join(""), tokens };
}

function checked_keymap_edits(stored: unknown): KeymapEdits {
  if (!is_record(stored)) return {};
  const edits: KeymapEdits = {};
  for (const [mode, table] of Object.entries(stored)) {
    if (!(KEYMAP_MODES as readonly string[]).includes(mode) || !is_record(table)) continue;
    const kept = Object.entries(table).filter(([keys, text]) => keys !== "" && typeof text === "string" && key_problem(mode as KeymapMode, keys) === undefined);
    if (kept.length > 0) edits[mode as KeymapMode] = by_spelling(Object.fromEntries(kept) as Record<string, string>);
  }
  return edits;
}

// A key that does not parse keeps its spelling. The compile warns about it.
export const spelling_of = (keys: string): string => parse_sequence(keys).tokens?.join("") ?? keys;

// A mode table keyed by `spelling_of`, so a file's `<C-D>` and an edit's `<C-d>` meet. Of two spellings of one key the later wins, as in the compile.
export function by_spelling<V>(table: Record<string, V>): Record<string, V> {
  return Object.fromEntries(Object.entries(table).map(([keys, value]) => [spelling_of(keys), value]));
}

function checked_engine_edits(stored: unknown): EngineEdits {
  if (!is_record(stored)) return {};
  const edits: EngineEdits = {};
  const engines = is_record(stored.engines) ? Object.entries(stored.engines).filter(([name, table]) => name !== "" && !name.includes(".") && is_record(table)) : [];
  if (engines.length > 0) edits.engines = Object.fromEntries(engines) as Record<string, Record<string, unknown>>;
  // One key per letter, as `s` and `S` take it: a letter that is not one key token would bind nothing.
  const letters = is_record(stored.letters) ? Object.entries(stored.letters).filter(([letter, name]) => parse_sequence(letter).tokens?.length === 1 && typeof name === "string" && name !== "") : [];
  if (letters.length > 0) edits.letters = Object.fromEntries(letters) as Record<string, string>;
  return edits;
}

// Only the shape. The build judges the name and the target, and drops an entry it refuses.
function checked_alias_edits(stored: unknown): AliasEdits {
  if (!is_record(stored)) return {};
  return Object.fromEntries(Object.entries(stored).filter(([name, target]) => name !== "" && typeof target === "string" && target !== "")) as AliasEdits;
}

// Keeps a theme that is whole and has a usable name, with only the role keys, as #rrggbb. A broken one is dropped, so a hand-edited or half-written store never reaches the compile or the export.
function checked_theme_edits(stored: unknown): ThemeEdits {
  if (!is_record(stored)) return {};
  const kept: ThemeEdits = {};
  for (const [name, theme] of Object.entries(stored)) {
    if (theme_name_shape_problem(name) !== undefined || local_theme_problem(theme) !== undefined) continue;
    const table = (variant: "dark" | "light") => Object.fromEntries(ROLES.map((role) => [role, parse_color((theme as Record<string, Record<string, unknown>>)[variant]![role])])) as RoleColors;
    kept[name] = { dark: table("dark"), light: table("light") };
  }
  return kept;
}

export const EDIT_LAYERS: { [K in LayerKind]: LayerSpec<K> } = {
  keymap: { storage_key: KEYMAP_EDITS_STORAGE_KEY, check: checked_keymap_edits, optional: false },
  engines: { storage_key: ENGINE_EDITS_STORAGE_KEY, check: checked_engine_edits, optional: true },
  aliases: { storage_key: ALIAS_EDITS_STORAGE_KEY, check: checked_alias_edits, optional: true },
  themes: { storage_key: THEME_EDITS_STORAGE_KEY, check: checked_theme_edits, optional: true },
};

// The engines layer, empty when none is stored.
export const engine_edits_of = (layers: EditLayers): EngineEdits => layers.engines ?? {};
export const has_engine_edits = (edits: EngineEdits): boolean => Object.keys(edits.engines ?? {}).length > 0 || Object.keys(edits.letters ?? {}).length > 0;

export const alias_edits_of = (layers: EditLayers): AliasEdits => layers.aliases ?? {};

// The layers the build folds into the config: the ones that are files of the config folder when exported.
export const has_build_edits = (layers: EditLayers): boolean => has_engine_edits(engine_edits_of(layers)) || Object.keys(alias_edits_of(layers)).length > 0;

const KINDS = Object.keys(EDIT_LAYERS) as LayerKind[];

export async function load_layers(): Promise<EditLayers> {
  const stored = await browser.storage.local.get(KINDS.map((kind) => EDIT_LAYERS[kind].storage_key));
  const checked = KINDS.map((kind) => [kind, EDIT_LAYERS[kind].check(stored[EDIT_LAYERS[kind].storage_key])] as const);
  return Object.fromEntries(checked.filter(([kind, layer]) => !EDIT_LAYERS[kind].optional || Object.keys(layer).length > 0)) as EditLayers;
}

// One `set`, so the kinds never part.
export async function store_layers(layers: EditLayers): Promise<void> {
  await browser.storage.local.set(Object.fromEntries(KINDS.map((kind) => [EDIT_LAYERS[kind].storage_key, layers[kind] ?? {}])));
}
