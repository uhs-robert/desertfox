// No DOM: the state of the Search engines section on the settings page. It lists the engines of the browser layer, holds the add form, and sends each change to the background.
// The form checks its fields while the user types (`field_problems`). The background builds the whole config at Save and refuses what the build refuses.

import { field_problems } from "../shared/engine_fields.ts";
import type { ChangeEngines, ChangeEnginesAnswer, EngineRow, ListEngines, ListEnginesAnswer } from "../shared/messages.ts";

export type EngineForm = { name: string; url: string; keyword: string; letter: string };
const EMPTY_FORM: EngineForm = { name: "", url: "", keyword: "", letter: "" };

export type EnginesState = {
  rows: EngineRow[];
  loaded: boolean;
  form: EngineForm;
  // The name of the row the form edits. The name is then fixed: a save replaces that engine.
  editing?: string | undefined;
  busy: boolean;
  message?: { ok: boolean; text: string } | undefined;
  error?: string | undefined;
};

export type EnginesDeps = {
  send: (message: ListEngines | ChangeEngines) => Promise<unknown>;
  on_change: () => void;
};

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

// What the form can say before any request. Empty fields say nothing until the user typed in them.
export function form_problems(form: EngineForm): string[] {
  if (form.name === "" && form.url === "") return [];
  return field_problems({ name: form.name, url: form.url, keyword: form.keyword, letter: form.letter });
}

export const can_save = (state: EnginesState): boolean => !state.busy && form_problems(state.form).length === 0 && state.form.name !== "" && state.form.url !== "";

export function create_engines_session(deps: EnginesDeps) {
  const state: EnginesState = { rows: [], loaded: false, form: { ...EMPTY_FORM }, busy: false };

  const ask = async <T>(message: ListEngines | ChangeEngines): Promise<T | { ok: false; message: string }> => {
    try {
      return (await deps.send(message)) as T;
    } catch (error) {
      return { ok: false, message: message_of(error) };
    }
  };

  async function refresh(): Promise<void> {
    const answer = await ask<ListEnginesAnswer>({ type: "list_engines" });
    if (answer.ok) {
      state.rows = answer.engines;
      state.loaded = true;
      delete state.error;
    } else state.error = `The engines could not be loaded: ${answer.message}`;
    deps.on_change();
  }

  // One request at a time. The form clears after a save and stays after a refusal, so the user can fix the field.
  async function change(request: ChangeEngines, cleared: boolean): Promise<void> {
    const sent = JSON.stringify([state.form, state.editing]);
    state.busy = true;
    delete state.message;
    deps.on_change();
    const answer = await ask<ChangeEnginesAnswer>(request);
    state.busy = false;
    if (answer.ok) {
      state.message = { ok: true, text: answer.message };
      // A draft or an Edit picked while the request ran stays.
      if (cleared && JSON.stringify([state.form, state.editing]) === sent) {
        state.form = { ...EMPTY_FORM };
        delete state.editing;
      }
    } else {
      const extra = ("problems" in answer && answer.problems ? answer.problems : []).filter((problem) => !answer.message.includes(problem));
      state.message = { ok: false, text: [answer.message, ...extra].join("\n") };
    }
    await refresh();
  }

  const set_field = (name: keyof EngineForm, value: string): void => {
    state.form[name] = value;
    delete state.message;
    deps.on_change();
  };

  function edit(row: EngineRow): void {
    state.form = { name: row.name, url: row.url, keyword: row.keyword ?? "", letter: row.letter ?? "" };
    state.editing = row.name;
    delete state.message;
    deps.on_change();
  }

  function clear_form(): void {
    state.form = { ...EMPTY_FORM };
    delete state.editing;
    delete state.message;
    deps.on_change();
  }

  async function save(): Promise<void> {
    if (!can_save(state)) return;
    const { name, url, keyword, letter } = state.form;
    await change({ type: "change_engines", action: "set", name, url, ...(keyword !== "" && { keyword }), ...(letter !== "" && { letter }) }, true);
  }

  const remove = (name: string) => change({ type: "change_engines", action: "remove", name }, false);
  const add_starter = () => change({ type: "change_engines", action: "starter" }, false);

  return { state, refresh, set_field, edit, clear_form, save, remove, add_starter };
}

export type EnginesSession = ReturnType<typeof create_engines_session>;
