// No DOM: the state of the import-a-theme section under the theme picker. It parses the pasted or picked scheme as the user types, so the preview and the problems are live,
// and sends a save or a remove to the background, which parses the text again before it stores anything.

import type { ChangeImportedThemes, ChangeImportedThemesAnswer, ListImportedThemes, ListImportedThemesAnswer } from "../shared/messages.ts";
import { MAX_SCHEME_CHARS, parse_base16, suggested_theme_name, theme_name_problem } from "../shared/theme/base16.ts";
import type { ImportedScheme } from "../shared/theme/base16.ts";
import type { PickedFile } from "./transfer_model.ts";

export type ThemesState = {
  names: string[];
  loaded: boolean;
  text: string;
  name: string;
  // False until the user types a name. While false, the name follows the scheme's own name.
  name_typed: boolean;
  // Set when the text parses.
  scheme?: ImportedScheme | undefined;
  // Why the text does not parse. Empty text says nothing.
  text_problem?: string | undefined;
  // The name a save is waiting to replace. The page asks the user, and `confirm_replace` or `cancel_replace` answers.
  replacing?: string | undefined;
  busy: boolean;
  message?: { ok: boolean; text: string } | undefined;
  error?: string | undefined;
};

export type ThemesDeps = {
  send: (message: ListImportedThemes | ChangeImportedThemes) => Promise<unknown>;
  on_change: () => void;
};

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const name_problem = (state: Pick<ThemesState, "name" | "scheme">): string | undefined => (state.scheme === undefined ? undefined : theme_name_problem(state.name));

export const can_save = (state: ThemesState): boolean => !state.busy && state.scheme !== undefined && name_problem(state) === undefined;

export function create_themes_session(deps: ThemesDeps) {
  const state: ThemesState = { names: [], loaded: false, text: "", name: "", name_typed: false, busy: false };

  const ask = async <T>(message: ListImportedThemes | ChangeImportedThemes): Promise<T | { ok: false; message: string }> => {
    try {
      return (await deps.send(message)) as T;
    } catch (error) {
      return { ok: false, message: message_of(error) };
    }
  };

  async function refresh(): Promise<void> {
    const answer = await ask<ListImportedThemesAnswer>({ type: "list_imported_themes" });
    if (answer.ok) {
      state.names = answer.names;
      state.loaded = true;
      delete state.error;
    } else state.error = `The imported themes could not be loaded: ${answer.message}`;
    deps.on_change();
  }

  function set_text(text: string): void {
    state.text = text;
    delete state.message;
    delete state.replacing;
    if (text.trim() === "") {
      delete state.scheme;
      delete state.text_problem;
    } else {
      const parsed = parse_base16(text);
      if (parsed.ok) {
        state.scheme = parsed.scheme;
        delete state.text_problem;
        if (!state.name_typed) state.name = suggested_theme_name(parsed.scheme.name);
      } else {
        delete state.scheme;
        state.text_problem = parsed.problem;
      }
    }
    deps.on_change();
  }

  function set_name(name: string): void {
    state.name = name;
    state.name_typed = name !== "";
    delete state.message;
    delete state.replacing;
    deps.on_change();
  }

  // A file past the scheme size limit is refused before its text is read.
  async function load_file(file: PickedFile): Promise<void> {
    if (file.size > MAX_SCHEME_CHARS * 4) {
      state.message = { ok: false, text: `${file.name} is too large for a color scheme.` };
      deps.on_change();
      return;
    }
    set_text(await file.text());
  }

  function clear(): void {
    state.text = "";
    state.name = "";
    state.name_typed = false;
    delete state.scheme;
    delete state.text_problem;
    delete state.replacing;
    deps.on_change();
  }

  async function change(request: ChangeImportedThemes, on_saved: () => void): Promise<void> {
    state.busy = true;
    delete state.message;
    deps.on_change();
    const answer = await ask<ChangeImportedThemesAnswer>(request);
    state.busy = false;
    if (answer.ok) {
      state.message = { ok: true, text: answer.message };
      delete state.replacing;
      on_saved();
    } else if ("needs_replace" in answer && answer.needs_replace && request.action === "save") {
      state.replacing = request.name;
    } else state.message = { ok: false, text: answer.message };
    await refresh();
  }

  async function save(replace = false): Promise<void> {
    if (!can_save(state)) return;
    const sent = state.text;
    await change({ type: "change_imported_themes", action: "save", name: state.name, text: state.text, ...(replace && { replace }) }, () => {
      // A draft typed while the request ran stays.
      if (state.text === sent) clear_keeping_message();
    });
  }

  function clear_keeping_message(): void {
    const kept = state.message;
    clear();
    state.message = kept;
    deps.on_change();
  }

  const confirm_replace = () => save(true);

  function cancel_replace(): void {
    delete state.replacing;
    deps.on_change();
  }

  const remove = (name: string) => change({ type: "change_imported_themes", action: "remove", name }, () => undefined);

  return { state, refresh, set_text, set_name, load_file, clear, save, confirm_replace, cancel_replace, remove };
}

export type ThemesSession = ReturnType<typeof create_themes_session>;
