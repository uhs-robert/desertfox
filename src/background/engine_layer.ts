// Builds the config with the engines layer in. The layer goes in as the files an export of it writes, so one merge and one check path (`build_config`) serves the running config, the export and a re-import.

import type { CommandMeta } from "../shared/command.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { ConfigRefusal, KEPT_CURRENT, build_files_config } from "./config_reload.ts";
import type { FilesSlot, LoadedConfig } from "./config_load.ts";
import { layer_files } from "./config_transfer.ts";
import type { EngineEdits } from "./edit_layers.ts";

// The build names the files it reads. The layer has no file for a user without the native host, so a problem names the Search engines section instead.
const LAYER_FILE = /\S*(?:search_engines|keymap)\.d\/\S*zz-saved-edits\.toml/g;
const in_section_terms = (problem: string): string => problem.replace(LAYER_FILE, "the Search engines section");

// A piece of the layer the build left out. `signature` identifies its content, so a piece that is still broken after a later edit of the same name counts as the same one only when it is unchanged.
export type DroppedPiece = { name: string; signature: string; problems: string[] };

export type LayeredBuild = {
  stored: FilesSlot;
  loaded: LoadedConfig;
  // The part of the layer the build took. Equal to the layer unless `dropped` is not empty.
  kept: EngineEdits;
  dropped: DroppedPiece[];
};

const top_name = (name: string): string => name.split(".")[0]!;

// The layer cut into pieces that stand alone: an engine table with its key letters, and the letters that name an engine of the files.
function pieces_of(edits: EngineEdits): { name: string; edits: EngineEdits }[] {
  const letters = Object.entries(edits.letters ?? {});
  const named = Object.entries(edits.engines ?? {}).map(([name, table]) => ({
    name,
    edits: { engines: { [name]: table }, letters: Object.fromEntries(letters.filter(([, engine]) => top_name(engine) === name)) },
  }));
  const orphans = letters.filter(([, engine]) => !Object.hasOwn(edits.engines ?? {}, top_name(engine)));
  return [...named, ...orphans.map(([letter, engine]) => ({ name: `key ${letter}`, edits: { letters: { [letter]: engine } } }))];
}

const joined = (a: EngineEdits, b: EngineEdits): EngineEdits => ({ engines: { ...a.engines, ...b.engines }, letters: { ...a.letters, ...b.letters } });

function build_with(files: ConfigFiles, dir_label: string, commands: CommandMeta[], edits: EngineEdits) {
  return build_files_config({ ...files, ...layer_files(files, {}, edits) }, dir_label, commands, "layer");
}

// A piece that conflicts is left out with its problems, so a later edit of the files never leaves the browser with no engines. The files alone were built before, so they pass.
// The save of an edit refuses what `fresh_drops` finds, so the layer in force only ever holds pieces that built or were already broken.
export function build_layered(files: ConfigFiles, dir_label: string, commands: CommandMeta[], edits: EngineEdits): LayeredBuild {
  try {
    return { ...build_with(files, dir_label, commands, edits), kept: edits, dropped: [] };
  } catch (error) {
    if (!(error instanceof ConfigRefusal)) throw error;
  }
  let kept: EngineEdits = {};
  const dropped: DroppedPiece[] = [];
  let built = build_with(files, dir_label, commands, kept);
  for (const piece of pieces_of(edits)) {
    try {
      const next = joined(kept, piece.edits);
      built = build_with(files, dir_label, commands, next);
      kept = next;
    } catch (error) {
      if (!(error instanceof ConfigRefusal)) throw error;
      dropped.push({ name: piece.name, signature: JSON.stringify(piece.edits), problems: (error.problems.length > 0 ? error.problems : [error.message]).map(in_section_terms) });
    }
  }
  return { ...built, kept, dropped };
}

// The pieces `build` leaves out that `before` did not: what an edit breaks. An edit refuses on these and not on a piece that was already broken, or the user could never remove one broken engine while another stayed.
export const fresh_drops = (build: LayeredBuild, before: DroppedPiece[]): DroppedPiece[] => build.dropped.filter((piece) => !before.some((known) => known.signature === piece.signature));

export const dropped_warning = (piece: DroppedPiece): string => `engines: ${piece.name} left out, ${piece.problems[0]}`;

// Every problem, since the form shows them all.
export function refusal_of(pieces: DroppedPiece[]): ConfigRefusal {
  const problems = pieces.flatMap((piece) => piece.problems);
  return new ConfigRefusal(`${KEPT_CURRENT.layer} ${problems.length} problem(s): ${problems.join("; ")}`, problems);
}
