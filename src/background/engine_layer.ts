// Builds the config with the engines and aliases layers in. Each layer goes in as the files an export of it writes, so one merge and one check path (`build_config`) serves the running config, the export and a re-import.

import type { CommandMeta } from "../shared/command.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { ConfigRefusal, KEPT_CURRENT, build_files_config } from "./config_reload.ts";
import type { FilesSlot, LoadedConfig } from "./config_load.ts";
import { layer_files } from "./config_transfer.ts";
import type { AliasEdits, EngineEdits } from "./edit_layers.ts";

// The build names the files it reads. The layer has no file for a user without the native host, so a problem names the section instead.
const ENGINES_FILE = /\S*(?:search_engines|keymap)\.d\/\S*zz-saved-edits\.toml/g;
const ALIASES_FILE = /\S*command_aliases\.d\/\S*zz-saved-edits\.toml/g;
const in_section_terms = (problem: string): string => problem.replace(ENGINES_FILE, "the Search engines section").replace(ALIASES_FILE, "the Aliases section");

// A piece of a layer the build left out. `signature` identifies its content, so a piece that is still broken after a later edit of the same name counts as the same one only when it is unchanged.
// `kind` is the layer it came from, so an engine and an alias of one name stay apart.
export type DroppedPiece = { kind: "engines" | "aliases"; name: string; signature: string; problems: string[] };

export type LayeredBuild = {
  stored: FilesSlot;
  loaded: LoadedConfig;
  // The part of each layer the build took. Equal to the layer unless `dropped` is not empty.
  kept: EngineEdits;
  kept_aliases: AliasEdits;
  dropped: DroppedPiece[];
};

const top_name = (name: string): string => name.split(".")[0]!;

type Layers = { engines: EngineEdits; aliases: AliasEdits };
type Piece = { kind: DroppedPiece["kind"]; name: string; layers: Layers };

// The layers cut into pieces that stand alone: an engine table with its key letters, the letters that name an engine of the files, and each alias.
function pieces_of({ engines, aliases }: Layers): Piece[] {
  const letters = Object.entries(engines.letters ?? {});
  const named: Piece[] = Object.entries(engines.engines ?? {}).map(([name, table]) => ({
    kind: "engines",
    name,
    layers: { engines: { engines: { [name]: table }, letters: Object.fromEntries(letters.filter(([, engine]) => top_name(engine) === name)) }, aliases: {} },
  }));
  const orphans: Piece[] = letters.filter(([, engine]) => !Object.hasOwn(engines.engines ?? {}, top_name(engine))).map(([letter, engine]) => ({ kind: "engines", name: `key ${letter}`, layers: { engines: { letters: { [letter]: engine } }, aliases: {} } }));
  const named_aliases: Piece[] = Object.entries(aliases).map(([name, target]) => ({ kind: "aliases", name, layers: { engines: {}, aliases: { [name]: target } } }));
  return [...named, ...orphans, ...named_aliases];
}

const joined = (a: Layers, b: Layers): Layers => ({ engines: { engines: { ...a.engines.engines, ...b.engines.engines }, letters: { ...a.engines.letters, ...b.engines.letters } }, aliases: { ...a.aliases, ...b.aliases } });

// A table the TOML writer cannot write (an array holding `null`, say) refuses like a conflict, so the piece-by-piece build can leave it out.
function build_with(files: ConfigFiles, dir_label: string, commands: CommandMeta[], layers: Layers) {
  let layer: ConfigFiles;
  try {
    layer = layer_files(files, {}, layers.engines, layers.aliases);
  } catch (error) {
    throw new ConfigRefusal(`${KEPT_CURRENT.layer} A browser edit holds a value that cannot be saved: ${error instanceof Error ? error.message : String(error)}`);
  }
  return build_files_config({ ...files, ...layer }, dir_label, commands, "layer");
}

// A piece that conflicts is left out with its problems, so a later edit of the files never leaves the browser with no engines. The files alone were built before, so they pass.
// The save of an edit refuses what `fresh_drops` finds, so the layers in force only ever hold pieces that built or were already broken.
export function build_layered(files: ConfigFiles, dir_label: string, commands: CommandMeta[], engines: EngineEdits, aliases: AliasEdits = {}): LayeredBuild {
  const all: Layers = { engines, aliases };
  try {
    return { ...build_with(files, dir_label, commands, all), kept: engines, kept_aliases: aliases, dropped: [] };
  } catch (error) {
    if (!(error instanceof ConfigRefusal)) throw error;
  }
  let kept: Layers = { engines: {}, aliases: {} };
  const dropped: DroppedPiece[] = [];
  let built = build_with(files, dir_label, commands, kept);
  for (const piece of pieces_of(all)) {
    try {
      const next = joined(kept, piece.layers);
      built = build_with(files, dir_label, commands, next);
      kept = next;
    } catch (error) {
      if (!(error instanceof ConfigRefusal)) throw error;
      dropped.push({ kind: piece.kind, name: piece.name, signature: JSON.stringify(piece.layers), problems: (error.problems.length > 0 ? error.problems : [error.message]).map(in_section_terms) });
    }
  }
  return { ...built, kept: kept.engines, kept_aliases: kept.aliases, dropped };
}

// The pieces `build` leaves out that `before` did not: what an edit breaks. An edit refuses on these and not on a piece that was already broken, or the user could never remove one broken engine while another stayed.
export const fresh_drops = (build: LayeredBuild, before: DroppedPiece[]): DroppedPiece[] => build.dropped.filter((piece) => !before.some((known) => known.signature === piece.signature));

export const dropped_warning = (piece: DroppedPiece): string => `${piece.kind}: ${piece.name} left out, ${piece.problems[0]}`;

// Every problem, since the form shows them all.
export function refusal_of(pieces: DroppedPiece[]): ConfigRefusal {
  const problems = pieces.flatMap((piece) => piece.problems);
  return new ConfigRefusal(`${KEPT_CURRENT.layer} ${problems.length} problem(s): ${problems.join("; ")}`, problems);
}
