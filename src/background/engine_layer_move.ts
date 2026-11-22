// The move of the engines layer that older versions kept in the browser (`desertfox_engine_edits`) into the Engines page's two files, and of a saved `default_engine` edit into settings.toml.
// The start runs it (`move_engine_layer` in `config_start.ts`) until nothing is left. The layer loads after every engine and keymap.d file, and the page's files load after the usual numbered ones, so the move keeps what runs. A piece that cannot move stays in the layer, which keeps building over the files.

import { TomlError } from "smol-toml";
import { RuntimeRefusal } from "../shared/command.ts";
import type { SettingOverrides } from "../shared/config.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { nodes_of_file } from "../shared/engines/resolve.ts";
import { ConfigRefusal } from "./config_reload.ts";
import { EDIT_LAYERS } from "./edit_layers.ts";
import type { EngineEdits } from "./edit_layers.ts";
import { ENGINE_FILE, later_file_defining, owned_engines, with_owned_engines } from "./engine_file.ts";
import type { EngineTables } from "./engine_file.ts";
import { KEYS_FILE, keys_file_after_setting, owned_letters, with_owned_letters } from "./engine_keys_file.ts";
import type { Letters } from "./engine_keys_file.ts";
import { SETTINGS_FILE, settings_d_file_that_sets, with_setting_in_files } from "./settings_file.ts";

const is_table = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const top_name = (name: string): string => name.split(".")[0]!;

// One engine table with the letters that name it or its children, or one letter that names an engine of the files.
type Piece = { name: string; engines: EngineTables; letters: Letters };

function pieces_of(layer: EngineEdits): Piece[] {
  const letters = Object.entries(layer.letters ?? {});
  const engines = layer.engines ?? {};
  const named = Object.entries(engines).map(([name, table]) => ({ name, engines: { [name]: table }, letters: Object.fromEntries(letters.filter(([, engine]) => top_name(engine) === name)) }));
  const orphans = letters.filter(([, engine]) => !Object.hasOwn(engines, top_name(engine))).map(([letter, engine]) => ({ name: `key ${letter}`, engines: {}, letters: { [letter]: engine } }));
  return [...named, ...orphans];
}

// A table inside an engine table is a child unless it is `params` or holds only `only`, as `nodes_of_file` reads it.
const is_child = (key: string, value: unknown): boolean => is_table(value) && key !== "params" && Object.keys(value).join() !== "only";

// `over` laid on `under` as the build merges two files: per engine path, so a child `under` has and `over` lacks stays. The fields of a path come whole from `over` when its table is a node of its own.
// Only a table that holds children and no fields is implicit, as `nodes_of_file` reads it. An empty table (`images = {}`) is a node, so it drops the old fields and inherits from its parent.
export function merged_by_path(under: Record<string, unknown> | undefined, over: Record<string, unknown>): Record<string, unknown> {
  if (under === undefined) return over;
  const fields_of = (table: Record<string, unknown>) => Object.entries(table).filter(([key, value]) => !is_child(key, value));
  const over_fields = fields_of(over);
  const over_is_node = over_fields.length > 0 || !Object.entries(over).some(([key, value]) => is_child(key, value));
  const merged: Record<string, unknown> = Object.fromEntries(over_is_node ? over_fields : fields_of(under));
  // A child and a field of one name (a narrowing `repo = { only = [...] }` beside a `repo` child) are two nodes in two files, and one table cannot hold both.
  const clash = (key: string) => new ConfigRefusal(`A child table and a field of the engine share the name ${key}, and one table cannot hold both.`);
  for (const [key, value] of Object.entries(under)) {
    if (!is_child(key, value)) continue;
    if (Object.hasOwn(merged, key)) throw clash(key);
    merged[key] = value;
  }
  for (const [key, value] of Object.entries(over)) {
    if (!is_child(key, value)) continue;
    const below = merged[key];
    if (below !== undefined && !is_child(key, below)) throw clash(key);
    merged[key] = is_table(below) ? merged_by_path(below, value as Record<string, unknown>) : value;
  }
  return merged;
}

// `files` with one piece moved into the page's files, and what the user learns about it. A letter that a later keymap.d file binds to another engine stays out: the page shows no letter that searches something else.
function with_piece(files: ConfigFiles, piece: Piece): { files: ConfigFiles; notes: string[] } {
  const owned = owned_engines(files);
  const engines = { ...owned };
  const notes: string[] = [];
  for (const [name, table] of Object.entries(piece.engines)) {
    engines[name] = merged_by_path(owned[name], table);
    for (const node of nodes_of_file(ENGINE_FILE, { [name]: engines[name] }, [])) {
      const later = later_file_defining(files, node.path);
      if (later !== undefined) notes.push(`${later} defines the engine ${node.path} too, and it now wins over the one saved in the browser.`);
    }
  }
  const letters = owned_letters(files);
  for (const [letter, engine] of Object.entries(piece.letters)) {
    const later = keys_file_after_setting(files, letter, engine);
    if (later === undefined) letters[letter] = engine;
    else notes.push(`${later} binds the key letter ${letter} to another engine, so the letter that searched ${engine} is dropped.`);
  }
  const moved = Object.keys(piece.engines).length > 0 ? with_owned_engines(files, engines) : files;
  return { files: with_owned_letters(moved, letters), notes };
}

// What the move changes: the files, the saved edits, the paths it changed (the page's engine file first) and what stays in the layer.
// `notes` are for the user: a hand file that now wins over a moved engine or letter, and a piece left in the layer with the reason.
export type EngineLayerMove = { files: ConfigFiles; saved: SettingOverrides; paths: string[]; left: EngineEdits; notes: string[] };

// `problems_of` builds files and gives the build's problems, none when they build.
// A piece the build refuses, or one a hand file at the page's path blocks, stays in the layer, so nothing is lost and a later start tries again.
// `saved` comes back as the same object when the saved `default_engine` stays: a `settings.d` file that sets it would win over settings.toml, and a value the build refuses stays a saved edit too.
export function engine_layer_moved(stored: unknown, files: ConfigFiles, saved: SettingOverrides, problems_of: (files: ConfigFiles) => string[]): EngineLayerMove {
  const pieces = pieces_of(EDIT_LAYERS.engines.check(stored));
  const notes: string[] = [];
  const left: Piece[] = [];
  let moved = files;
  const with_piece_built = (base: ConfigFiles, piece: Piece): { files: ConfigFiles; notes: string[] } | { problem: string } => {
    try {
      const next = with_piece(base, piece);
      const problem = problems_of(next.files)[0];
      return problem === undefined ? next : { problem };
    } catch (error) {
      if (!(error instanceof ConfigRefusal)) throw error;
      return { problem: error.message };
    }
  };
  // One build when every piece fits. Otherwise one piece at a time, so a clash leaves that piece and not the whole layer.
  const together = all_pieces_moved(files, pieces, problems_of);
  if (together) {
    moved = together.files;
    notes.push(...together.notes);
  } else {
    for (const piece of pieces) {
      const next = with_piece_built(moved, piece);
      if ("problem" in next) {
        left.push(piece);
        notes.push(`The ${Object.keys(piece.engines).length > 0 ? `engine ${piece.name}` : piece.name} saved in the browser stays there, as the config refuses it: ${next.problem} Fix that, and the next start moves it.`);
        continue;
      }
      moved = next.files;
      notes.push(...next.notes);
    }
  }
  const remaining: EngineEdits = {
    ...(left.some((piece) => Object.keys(piece.engines).length > 0) && { engines: Object.assign({}, ...left.map((piece) => piece.engines)) as EngineTables }),
    ...(left.some((piece) => Object.keys(piece.letters).length > 0) && { letters: Object.assign({}, ...left.map((piece) => piece.letters)) as Letters }),
  };
  const { files: settled, saved: saved_after } = with_default_engine_moved(moved, saved, problems_of);
  const paths = [ENGINE_FILE, KEYS_FILE, SETTINGS_FILE].filter((path) => settled[path] !== files[path]);
  return { files: settled, saved: saved_after, paths, left: remaining, notes };
}

// Every piece moved, or undefined when the build or a hand file at a page path refuses the whole.
function all_pieces_moved(files: ConfigFiles, pieces: Piece[], problems_of: (files: ConfigFiles) => string[]): { files: ConfigFiles; notes: string[] } | undefined {
  if (pieces.length === 0) return undefined;
  let moved = { files, notes: [] as string[] };
  try {
    for (const piece of pieces) {
      const next = with_piece(moved.files, piece);
      moved = { files: next.files, notes: [...moved.notes, ...next.notes] };
    }
  } catch (error) {
    if (!(error instanceof ConfigRefusal)) throw error;
    return undefined;
  }
  return problems_of(moved.files).length === 0 ? moved : undefined;
}

function with_default_engine_moved(files: ConfigFiles, saved: SettingOverrides, problems_of: (files: ConfigFiles) => string[]): { files: ConfigFiles; saved: SettingOverrides } {
  const engine = saved.default_engine;
  if (typeof engine !== "string" || settings_d_file_that_sets(files, "default_engine") !== undefined) return { files, saved };
  let next: ConfigFiles;
  try {
    next = with_setting_in_files(files, "default_engine", engine);
  } catch (error) {
    if (!(error instanceof RuntimeRefusal || error instanceof TomlError)) throw error;
    return { files, saved };
  }
  if (problems_of(next).length > 0) return { files, saved };
  const { default_engine: _moved, ...kept } = saved;
  return { files: next, saved: kept };
}
