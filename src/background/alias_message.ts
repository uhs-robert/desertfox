// The Aliases section's messages: the aliases of the browser layer, and one change of it (set, remove). A change goes through `change_layers`, so it shares the queue, the build check and the rollback of an engine edit.

import type { MergedConfig } from "../shared/config.ts";
import type { AliasRow, ChangeAliases, ChangeAliasesAnswer, ListAliasesAnswer } from "../shared/messages.ts";
import { ConfigRefusal, failure } from "./config_reload.ts";
import type { AliasEdits } from "./edit_layers.ts";
import type { DroppedPiece } from "./engine_layer.ts";

// Read in the change queue (`read_alias_state`). `kept` is what the build took of the layer.
export type AliasState = { config: MergedConfig; aliases: AliasEdits; kept: AliasEdits; dropped: DroppedPiece[] };

export type AliasMessageDeps = {
  read_alias_state: () => Promise<AliasState>;
  change_layers: (kind: "aliases", decide: (current: AliasEdits) => AliasEdits | undefined) => Promise<void>;
};


export function rows_of(aliases: AliasEdits, dropped: DroppedPiece[]): AliasRow[] {
  return Object.entries(aliases).map(([name, target]) => {
    const left_out = dropped.find((piece) => piece.kind === "aliases" && piece.name === name)?.problems[0];
    return { name, target, ...(left_out !== undefined && { left_out }) };
  });
}

export function create_alias_messages(deps: AliasMessageDeps) {
  async function list(): Promise<ListAliasesAnswer> {
    try {
      const state = await deps.read_alias_state();
      return { ok: true, aliases: rows_of(state.aliases, state.dropped) };
    } catch (error) {
      return failure(error);
    }
  }

  async function set(name: string, target: string): Promise<string> {
    if (typeof name !== "string" || name === "" || typeof target !== "string" || target === "") throw new ConfigRefusal("Alias not saved: give a name and a command id.");
    // The build judges the rest: whitespace, a command name, an unknown target.
    await deps.change_layers("aliases", (current) => ({ ...current, [name]: target }));
    return `Saved the alias ${name}, which runs ${target}.`;
  }

  async function remove(name: string): Promise<string> {
    let found = false;
    await deps.change_layers("aliases", (current) => {
      found = Object.hasOwn(current, name);
      if (!found) return undefined;
      const { [name]: _gone, ...kept } = current;
      return kept;
    });
    if (!found) throw new ConfigRefusal(`No alias ${name} was added in the browser.`);
    return `Removed the alias ${name}.`;
  }

  async function change(request: ChangeAliases): Promise<ChangeAliasesAnswer> {
    try {
      if (request.action === "set") return { ok: true, message: await set(request.name, request.target) };
      if (request.action === "remove") return { ok: true, message: await remove(String(request.name)) };
      return { ok: false, message: `unknown action ${JSON.stringify((request as { action: unknown }).action)}` };
    } catch (error) {
      return failure(error);
    }
  }

  return { list, change };
}
