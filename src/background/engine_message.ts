// The Search engines section's messages: the engines the page added, and one change of them (add, remove, the starter set).
// A change goes through `change_engine_file` in `startup.ts`: the page's engines live in `search_engines.d/zz-desertfox.toml` (`engine_file.ts`), which the copy holds and the native host writes, as a `:set` writes settings.toml.
// The key letters stay in the browser's engines layer, and so do the engines an older version added there until a save moves one into the file.

import type { MergedConfig } from "../shared/config.ts";
import { field_problems } from "../shared/engine_fields.ts";
import { parse_toml_text } from "../shared/config_build/source_files.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import type { ChangeEngines, ChangeEnginesAnswer, EngineRow, ListEnginesAnswer } from "../shared/messages.ts";
import { ConfigRefusal, failure, KEPT_CURRENT } from "./config_reload.ts";
import type { AliasEdits, EngineEdits } from "./edit_layers.ts";
import { ENGINE_FILE, hand_file_defining, owned_engines, with_owned_engines } from "./engine_file.ts";
import type { EngineTables } from "./engine_file.ts";
import { dropped_warning, fresh_drops, refusal_of } from "./engine_layer.ts";
import type { DroppedPiece, LayeredBuild } from "./engine_layer.ts";
import { outcome_note } from "./settings_file.ts";
import type { FileWriteOutcome } from "./settings_file.ts";

// Read in the change queue (`read_engine_state`). `engines` is the browser's engines layer. `aliases` and `kept_aliases` ride along because one build covers both layers.
export type EngineState = { config: MergedConfig; files: ConfigFiles; engines: EngineEdits; aliases: AliasEdits; kept: EngineEdits; kept_aliases: AliasEdits; dropped: DroppedPiece[] };

// What a change sees in its turn of the change queue. `trial` builds other files and engines layer under the aliases in force and changes nothing. It throws a ConfigRefusal when the files alone do not build.
export type EngineTurn = { files: ConfigFiles; config: MergedConfig; layer: EngineEdits; dropped: DroppedPiece[]; trial: (files: ConfigFiles, layer: EngineEdits) => LayeredBuild };
// The files and engines layer after a change.
export type EnginePlan = { files: ConfigFiles; layer: EngineEdits };

export type EngineMessageDeps = {
  read_engine_state: () => Promise<EngineState>;
  // No `file` in the answer: the page's file stayed as it was.
  change_engine_file: <R>(plan: (turn: EngineTurn) => EnginePlan | { done: R }) => Promise<{ done: R } | { file?: FileWriteOutcome }>;
  // The text of examples/engines.toml, which the build ships.
  read_starter: () => Promise<string>;
};

const is_table = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const top_name = (name: string): string => name.split(".")[0]!;

function rows_of(tables: EngineTables, layer: EngineEdits, dropped: DroppedPiece[]): EngineRow[] {
  const letters = Object.entries(layer.letters ?? {});
  return Object.entries(tables).map(([name, table]) => {
    const letter = letters.find(([, engine]) => engine === name)?.[0];
    const left_out = dropped.find((piece) => piece.kind === "engines" && piece.name === name)?.problems[0];
    const children = Object.entries(table).filter(([key, value]) => key !== "params" && is_table(value) && Object.keys(value).join() !== "only").length;
    return {
      name,
      url: typeof table.url === "string" ? table.url : "",
      label: typeof table.label === "string" ? table.label : name,
      ...(typeof table.keyword === "string" && { keyword: table.keyword }),
      ...(letter !== undefined && { letter }),
      children,
      ...(left_out !== undefined && { left_out }),
    };
  });
}

// The layer without the engine `name` and the letters that name it.
function layer_without(layer: EngineEdits, name: string): EngineEdits {
  const { [name]: _gone, ...engines } = layer.engines ?? {};
  return { engines, letters: Object.fromEntries(Object.entries(layer.letters ?? {}).filter(([, engine]) => top_name(engine) !== name)) };
}

// The trial of a change: a files problem, or a layer piece the change breaks, refuses it. A piece the files already broke stays out of the way, so it can still be removed.
function checked(turn: EngineTurn, plan: EnginePlan): EnginePlan {
  let build: LayeredBuild;
  try {
    build = turn.trial(plan.files, plan.layer);
  } catch (error) {
    if (!(error instanceof ConfigRefusal) || error.problems.length === 0) throw error;
    throw new ConfigRefusal(`${KEPT_CURRENT.layer} ${error.problems.length} problem(s): ${error.problems.join("; ")}`, error.problems);
  }
  const fresh = fresh_drops(build, turn.dropped);
  if (fresh.length > 0) throw refusal_of(fresh);
  return plan;
}

const hand_managed = (path: string, name: string, verb: string) => new ConfigRefusal(`The engine ${name} is in ${path}, which this page does not change. ${verb} it there.`);

// The end of a save's reply about the page's file.
const save_note = (file: FileWriteOutcome): string => (file.kind === "written" ? ` to ${ENGINE_FILE}` : outcome_note(file, ENGINE_FILE));

// The end of a remove's reply about the page's file.
function removal_note(file: FileWriteOutcome, deleted: boolean): string {
  if (file.kind !== "written") return outcome_note(file, ENGINE_FILE);
  return deleted ? `. ${ENGINE_FILE} held no other engine, so it is deleted` : ` from ${ENGINE_FILE}`;
}

export function create_engine_messages(deps: EngineMessageDeps) {
  async function list(): Promise<ListEnginesAnswer> {
    try {
      const state = await deps.read_engine_state();
      return { ok: true, engines: rows_of({ ...owned_engines(state.files), ...state.engines.engines }, state.engines, state.dropped) };
    } catch (error) {
      return failure(error);
    }
  }

  // The form edits four fields. The rest of an engine table (label, hosts, fallback, params, children) is the starter set's or the user's, so a save merges into the table it had and never replaces it.
  // An engine an older version kept in the browser layer moves into the file with the save.
  async function set(request: Extract<ChangeEngines, { action: "set" }>): Promise<string> {
    const name = String(request.name);
    const keyword = typeof request.keyword === "string" && request.keyword !== "" ? request.keyword : undefined;
    const letter = typeof request.letter === "string" && request.letter !== "" ? request.letter : undefined;
    const problems = field_problems({ name, url: String(request.url), keyword, letter });
    if (problems.length > 0) throw new ConfigRefusal(`Engine not saved: ${problems[0]}`, problems);
    let taken: string | undefined;
    const change = await deps.change_engine_file((turn) => {
      const hand_file = hand_file_defining(turn.files, name);
      if (hand_file !== undefined) throw hand_managed(hand_file, name, "Change");
      const owned = owned_engines(turn.files);
      const { keyword: _old_keyword, ...kept } = turn.layer.engines?.[name] ?? owned[name] ?? {};
      const table = { ...kept, url: request.url, ...(keyword !== undefined && { keyword }) };
      const { [name]: _moved, ...layer_engines } = turn.layer.engines ?? {};
      // This engine's own letter goes first, so a new one replaces it. Another engine's letter is replaced because a letter searches one engine.
      const letters = Object.fromEntries(Object.entries(turn.layer.letters ?? {}).filter(([key, engine]) => engine !== name && key !== letter));
      taken = letter === undefined ? undefined : turn.config.keymap.search_keys?.[letter];
      const layer = { engines: layer_engines, letters: { ...letters, ...(letter !== undefined && { [letter]: name }) } };
      return checked(turn, { files: with_owned_engines(turn.files, { ...owned, [name]: table }), layer });
    });
    if ("done" in change) throw new ConfigRefusal(`The engine ${name} was not saved.`);
    const searches = letter === undefined ? "" : ` s${letter} searches it${taken !== undefined && taken !== name ? `, where it searched ${taken}` : ""}.`;
    return `Saved the engine ${name}${change.file ? save_note(change.file) : ""}.${searches}`;
  }

  async function remove(name: string): Promise<string> {
    let deleted = false;
    const change = await deps.change_engine_file<"missing">((turn) => {
      const owned = owned_engines(turn.files);
      const in_file = Object.hasOwn(owned, name);
      if (!in_file && !Object.hasOwn(turn.layer.engines ?? {}, name)) {
        const hand_file = hand_file_defining(turn.files, name);
        if (hand_file !== undefined) throw hand_managed(hand_file, name, "Remove");
        return { done: "missing" };
      }
      const { [name]: _gone, ...left } = owned;
      deleted = in_file && Object.keys(left).length === 0;
      return checked(turn, { files: in_file ? with_owned_engines(turn.files, left) : turn.files, layer: layer_without(turn.layer, name) });
    });
    if ("done" in change) throw new ConfigRefusal(`No engine ${name} was added on this page.`);
    return `Removed the engine ${name}${change.file ? removal_note(change.file, deleted) : ""}.`;
  }

  // Skips a table by its name when the files or the layer have one. The sample's duck replaces the built-in one, which no file defines, and the answer says so.
  // The work is in the plan, on the files of its own queue turn, so a save that landed since the page's read is kept.
  async function starter(): Promise<string> {
    const problems: string[] = [];
    const parsed = parse_toml_text("the starter engines", await deps.read_starter(), problems);
    if (!parsed) throw new ConfigRefusal(`The starter engines did not read: ${problems[0]}`);
    const tables = Object.entries(parsed).filter(([, table]) => is_table(table)) as [string, Record<string, unknown>][];
    let result = { added: [] as string[], skipped: 0, left_out: [] as DroppedPiece[] };
    const change = await deps.change_engine_file<"none">((turn) => {
      const has_table = (name: string) => Object.hasOwn(turn.layer.engines ?? {}, name) || Object.entries(turn.config.search_engines).some(([path, engine]) => top_name(path) === name && engine.origins !== undefined);
      const fresh = tables.filter(([name]) => !has_table(name));
      const owned = owned_engines(turn.files);
      const planned = (added: [string, Record<string, unknown>][]): EnginePlan => ({ files: with_owned_engines(turn.files, { ...owned, ...Object.fromEntries(added) }), layer: turn.layer });
      // One build when the whole set fits. Otherwise one table at a time, so a keyword clash leaves that table out and not the whole set.
      let added = fresh;
      const left_out: DroppedPiece[] = [];
      try {
        checked(turn, planned(fresh));
      } catch (error) {
        if (!(error instanceof ConfigRefusal)) throw error;
        added = [];
        for (const entry of fresh) {
          try {
            checked(turn, planned([...added, entry]));
            added.push(entry);
          } catch (refusal) {
            if (!(refusal instanceof ConfigRefusal)) throw refusal;
            left_out.push({ kind: "engines", name: entry[0], signature: "", problems: refusal.problems.length > 0 ? refusal.problems : [refusal.message] });
          }
        }
      }
      result = { added: added.map(([name]) => name), skipped: tables.length - fresh.length, left_out };
      return added.length > 0 ? planned(added) : { done: "none" };
    });
    const { added, skipped, left_out } = result;
    const where = "done" in change || !change.file ? "" : save_note(change.file);
    const notes = [
      added.length === 0 ? "No starter engine was added." : `Added ${added.length} starter engine table(s)${where}.`,
      ...(skipped > 0 ? [`Skipped ${skipped} whose name already exists.`] : []),
      ...(left_out.length > 0 ? [`Left out ${left_out.map(dropped_warning).join("; ")}.`] : []),
      ...(added.includes("duck") ? ["The starter duck replaces the built-in duck."] : []),
    ];
    return notes.join(" ");
  }

  async function change(request: ChangeEngines): Promise<ChangeEnginesAnswer> {
    try {
      if (request.action === "set") return { ok: true, message: await set(request) };
      if (request.action === "remove") return { ok: true, message: await remove(String(request.name)) };
      if (request.action === "starter") return { ok: true, message: await starter() };
      return { ok: false, message: `unknown action ${JSON.stringify((request as { action: unknown }).action)}` };
    } catch (error) {
      return failure(error);
    }
  }

  return { list, change };
}
