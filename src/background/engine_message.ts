// The Search engines section's messages: the engines of the browser layer, and one change of it (add, remove, the starter set). A change goes through `change_layers`, so it shares the queue and rollback of a `:set` and a key edit.

import type { MergedConfig } from "../shared/config.ts";
import { field_problems } from "../shared/engine_fields.ts";
import { parse_toml_text } from "../shared/config_build/source_files.ts";
import type { ChangeEngines, ChangeEnginesAnswer, EngineRow, ListEnginesAnswer } from "../shared/messages.ts";
import { ConfigRefusal, failure } from "./config_reload.ts";
import type { AliasEdits, EngineEdits } from "./edit_layers.ts";
import { dropped_warning, fresh_drops } from "./engine_layer.ts";
import type { DroppedPiece, LayeredBuild } from "./engine_layer.ts";

// Read in the change queue (`read_engine_state`). `trial` builds the config under another engines layer, with the aliases in force, and changes nothing. `aliases` and `kept_aliases` ride along because one build covers both layers.
export type EngineState = { config: MergedConfig; engines: EngineEdits; aliases: AliasEdits; kept: EngineEdits; kept_aliases: AliasEdits; dropped: DroppedPiece[]; trial: (other: EngineEdits) => LayeredBuild };

export type EngineMessageDeps = {
  read_engine_state: () => Promise<EngineState>;
  change_layers: (kind: "engines", decide: (current: EngineEdits, state: { config: MergedConfig }) => EngineEdits | undefined) => Promise<void>;
  // The text of examples/engines.toml, which the build ships.
  read_starter: () => Promise<string>;
};

const is_table = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const top_name = (name: string): string => name.split(".")[0]!;

function rows_of(engines: EngineEdits, dropped: DroppedPiece[]): EngineRow[] {
  const letters = Object.entries(engines.letters ?? {});
  return Object.entries(engines.engines ?? {}).map(([name, table]) => {
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

// The layer without the pieces `names` dropped, so the starter set adds what builds and reports the rest.
function without_pieces(edits: EngineEdits, names: Set<string>): EngineEdits {
  const engines = Object.fromEntries(Object.entries(edits.engines ?? {}).filter(([name]) => !names.has(name)));
  const letters = Object.fromEntries(Object.entries(edits.letters ?? {}).filter(([letter, engine]) => !names.has(top_name(engine)) && !names.has(`key ${letter}`)));
  return { engines, letters };
}

export function create_engine_messages(deps: EngineMessageDeps) {
  async function list(): Promise<ListEnginesAnswer> {
    try {
      const state = await deps.read_engine_state();
      return { ok: true, engines: rows_of(state.engines, state.dropped) };
    } catch (error) {
      return failure(error);
    }
  }

  // The form edits four fields. The rest of an engine table (label, hosts, fallback, params, children) is the starter set's or the user's, so a save merges into the table the layer holds and never replaces it.
  async function set(request: Extract<ChangeEngines, { action: "set" }>): Promise<string> {
    const keyword = typeof request.keyword === "string" && request.keyword !== "" ? request.keyword : undefined;
    const letter = typeof request.letter === "string" && request.letter !== "" ? request.letter : undefined;
    const problems = field_problems({ name: String(request.name), url: String(request.url), keyword, letter });
    if (problems.length > 0) throw new ConfigRefusal(`Engine not saved: ${problems[0]}`, problems);
    let taken: string | undefined;
    await deps.change_layers("engines", (current, state) => {
      const { keyword: _old_keyword, ...kept } = current.engines?.[request.name] ?? {};
      const table = { ...kept, url: request.url, ...(keyword !== undefined && { keyword }) };
      // This engine's own letter goes first, so a new one replaces it. Another engine's letter is replaced because a letter searches one engine.
      const letters = Object.fromEntries(Object.entries(current.letters ?? {}).filter(([key, engine]) => engine !== request.name && key !== letter));
      taken = letter === undefined ? undefined : state.config.keymap.search_keys?.[letter];
      return { engines: { ...current.engines, [request.name]: table }, letters: { ...letters, ...(letter !== undefined && { [letter]: request.name }) } };
    });
    const searches = letter === undefined ? "" : ` s${letter} searches it${taken !== undefined && taken !== request.name ? `, where it searched ${taken}` : ""}.`;
    return `Saved the engine ${request.name}.${searches}`;
  }

  async function remove(name: string): Promise<string> {
    let found = false;
    await deps.change_layers("engines", (current) => {
      found = Object.hasOwn(current.engines ?? {}, name);
      if (!found) return undefined;
      const { [name]: _gone, ...engines } = current.engines ?? {};
      return { engines, letters: Object.fromEntries(Object.entries(current.letters ?? {}).filter(([, engine]) => top_name(engine) !== name)) };
    });
    if (!found) throw new ConfigRefusal(`No engine ${name} was added in the browser.`);
    return `Removed the engine ${name}.`;
  }

  // Skips a table by its name when the files or the layer have one. The sample's duck replaces the built-in one, which no file defines, and the answer says so.
  // The work is in `decide`, on the layer of its own queue turn, so a save that landed since the read is kept.
  async function starter(state: EngineState): Promise<string> {
    const problems: string[] = [];
    const parsed = parse_toml_text("the starter engines", await deps.read_starter(), problems);
    if (!parsed) throw new ConfigRefusal(`The starter engines did not read: ${problems[0]}`);
    const tables = Object.entries(parsed).filter(([, table]) => is_table(table)) as [string, Record<string, unknown>][];
    let result = { added: [] as string[], skipped: 0, left_out: [] as DroppedPiece[] };
    await deps.change_layers("engines", (current, now) => {
      const has_file_table = (name: string) => Object.entries(now.config.search_engines).some(([path, engine]) => top_name(path) === name && engine.origins !== undefined);
      const fresh = tables.filter(([name]) => !has_file_table(name) && !Object.hasOwn(current.engines ?? {}, name));
      const candidate: EngineEdits = { engines: { ...current.engines, ...Object.fromEntries(fresh) }, letters: current.letters ?? {} };
      // Keyword clashes with the files or the layer leave one table out, not the whole set.
      const left_out = fresh_drops(state.trial(candidate), state.dropped);
      const refused = new Set(left_out.map((piece) => piece.name));
      result = { added: fresh.filter(([name]) => !refused.has(name)).map(([name]) => name), skipped: tables.length - fresh.length, left_out };
      return result.added.length > 0 ? without_pieces(candidate, refused) : undefined;
    });
    const { added, skipped, left_out } = result;
    const notes = [
      added.length === 0 ? "No starter engine was added." : `Added ${added.length} starter engine table(s).`,
      ...(skipped > 0 ? [`Skipped ${skipped} whose name already exists.`] : []),
      ...(left_out.length > 0 ? [`Left out ${left_out.map(dropped_warning).join("; ")}.`] : []),
      ...(added.includes("duck") ? ["The starter duck replaces the built-in duck."] : []),
    ];
    return notes.join(" ");
  }

  async function change(request: ChangeEngines): Promise<ChangeEnginesAnswer> {
    try {
      const state = await deps.read_engine_state();
      if (request.action === "set") return { ok: true, message: await set(request) };
      if (request.action === "remove") return { ok: true, message: await remove(String(request.name)) };
      if (request.action === "starter") return { ok: true, message: await starter(state) };
      return { ok: false, message: `unknown action ${JSON.stringify((request as { action: unknown }).action)}` };
    } catch (error) {
      return failure(error);
    }
  }

  return { list, change };
}
