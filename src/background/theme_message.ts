// The base16 importer's messages: the names of the imported themes, and one change of them (save, remove). A change goes through `change_layers`, so it shares the queue and the rollback of the other browser edits.

import type { ChangeImportedThemes, ChangeImportedThemesAnswer, ListImportedThemesAnswer } from "../shared/messages.ts";
import { parse_base16, theme_name_problem } from "../shared/theme/base16.ts";
import { ConfigRefusal, failure } from "./config_reload.ts";
import type { ThemeEdits } from "./edit_layers.ts";

export type ThemeMessageDeps = {
  read_theme_edits: () => Promise<ThemeEdits>;
  change_layers: (kind: "themes", decide: (current: ThemeEdits) => ThemeEdits | undefined) => Promise<void>;
  // Drops the saved and temp `theme` edit when it names `name`, so removing the theme in use puts the setting back to the file value or the default.
  release_theme: (name: string) => Promise<void>;
};

export function create_theme_messages(deps: ThemeMessageDeps) {
  async function list(): Promise<ListImportedThemesAnswer> {
    try {
      return { ok: true, names: Object.keys(await deps.read_theme_edits()).sort() };
    } catch (error) {
      return failure(error);
    }
  }

  async function save(name: unknown, text: unknown, replace: boolean): Promise<ChangeImportedThemesAnswer> {
    if (typeof name !== "string" || typeof text !== "string") throw new ConfigRefusal("Theme not saved: give a name and the scheme text.");
    const name_problem = theme_name_problem(name);
    if (name_problem !== undefined) throw new ConfigRefusal(`Theme not saved: ${name_problem}`);
    const parsed = parse_base16(text);
    if (!parsed.ok) throw new ConfigRefusal(`Theme not saved: ${parsed.problem}`);
    let exists = false;
    await deps.change_layers("themes", (current) => {
      exists = Object.hasOwn(current, name);
      if (exists && !replace) return undefined;
      return { ...current, [name]: parsed.scheme.theme };
    });
    if (exists && !replace) return { ok: false, needs_replace: true, message: `A theme named ${name} is already imported.` };
    return { ok: true, message: `${exists ? "Replaced" : "Saved"} the theme ${name}. Use it with :set theme ${name}.` };
  }

  async function remove(name: string): Promise<string> {
    if (!Object.hasOwn(await deps.read_theme_edits(), name)) throw new ConfigRefusal(`No theme named ${name} was imported.`);
    await deps.release_theme(name);
    await deps.change_layers("themes", (current) => {
      if (!Object.hasOwn(current, name)) return undefined;
      const { [name]: _gone, ...kept } = current;
      return kept;
    });
    return `Removed the theme ${name}.`;
  }

  async function change(request: ChangeImportedThemes): Promise<ChangeImportedThemesAnswer> {
    try {
      if (request.action === "save") return await save(request.name, request.text, request.replace === true);
      if (request.action === "remove") return { ok: true, message: await remove(String(request.name)) };
      return { ok: false, message: `unknown action ${JSON.stringify((request as { action: unknown }).action)}` };
    } catch (error) {
      return failure(error);
    }
  }

  return { list, change };
}
