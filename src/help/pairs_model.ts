// No DOM: the state of a section that lists name-to-value pairs of the browser (the Aliases and the Quickmarks sections), holds the add form and sends each change to the background.
// The two sections differ only in their messages, labels and field rules, which a `PairsKind` names. The background judges a save in full, so the form only checks what the fields alone can say.

import { MAX_QUICKMARK_URL_CHARS, QUICKMARK_KEY } from "../shared/quickmark_names.ts";
import type { ChangeAliases, ChangeAliasesAnswer, ChangeQuickmarks, ChangeQuickmarksAnswer, ListAliases, ListAliasesAnswer, ListQuickmarks, ListQuickmarksAnswer } from "../shared/messages.ts";

export type PairRow = {
  key: string;
  value: string;
  // Why the row runs nowhere.
  left_out?: string;
  // Where the row comes from, when that is not the browser.
  note?: string;
  // False for a row only a config file holds: the form can replace it but not remove it.
  removable: boolean;
};

export type PairsRequest = ListAliases | ChangeAliases | ListQuickmarks | ChangeQuickmarks;
type ListAnswer = ListAliasesAnswer | ListQuickmarksAnswer;
type ChangeAnswer = ChangeAliasesAnswer | ChangeQuickmarksAnswer;

export type PairsKind = {
  noun: string;
  key_label: string;
  value_label: string;
  key_placeholder: string;
  value_placeholder: string;
  list: PairsRequest;
  set: (key: string, value: string) => PairsRequest;
  remove: (key: string) => PairsRequest;
  rows_of: (answer: Extract<ListAnswer, { ok: true }>) => PairRow[];
  // What the two fields say before any request.
  problems: (key: string, value: string) => string[];
  empty_text: string;
};

export const ALIASES_KIND: PairsKind = {
  noun: "alias",
  key_label: "Short name",
  value_label: "Command to run",
  key_placeholder: "up",
  value_placeholder: "tab.prev",
  list: { type: "list_aliases" },
  set: (name, target) => ({ type: "change_aliases", action: "set", name, target }),
  remove: (name) => ({ type: "change_aliases", action: "remove", name }),
  rows_of: (answer) => ("aliases" in answer ? answer.aliases.map((row) => ({ key: row.name, value: row.target, removable: true, ...(row.left_out !== undefined && { left_out: row.left_out }) })) : []),
  problems: (name) => (/\s/.test(name) ? ["An alias is one word, with no spaces."] : []),
  empty_text: "You have no aliases yet.",
};

export const QUICKMARKS_KIND: PairsKind = {
  noun: "quickmark",
  key_label: "Letter or digit",
  value_label: "Address",
  key_placeholder: "m",
  value_placeholder: "https://mail.example/",
  list: { type: "list_quickmarks" },
  set: (key, url) => ({ type: "change_quickmarks", action: "set", key, url }),
  remove: (key) => ({ type: "change_quickmarks", action: "remove", key }),
  rows_of: (answer) => ("quickmarks" in answer ? answer.quickmarks.map((row) => ({ key: row.key, value: row.url, removable: row.saved, ...(!row.saved && { note: "This one comes from a settings file, so you cannot remove it here." }) })) : []),
  problems: (key, url) => [...(key !== "" && !QUICKMARK_KEY.test(key) ? ["Use one letter or digit."] : []), ...(url.length > MAX_QUICKMARK_URL_CHARS ? [`An address has at most ${MAX_QUICKMARK_URL_CHARS} characters.`] : [])],
  empty_text: "You have no quickmarks yet.",
};

export type PairsForm = { key: string; value: string };
const EMPTY_FORM: PairsForm = { key: "", value: "" };

export type PairsState = {
  rows: PairRow[];
  loaded: boolean;
  form: PairsForm;
  // The key of the row the form edits. The key is then fixed: a save replaces that row.
  editing?: string | undefined;
  busy: boolean;
  message?: { ok: boolean; text: string } | undefined;
  error?: string | undefined;
};

export type PairsDeps = {
  send: (message: PairsRequest) => Promise<unknown>;
  on_change: () => void;
};

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const form_problems = (kind: PairsKind, form: PairsForm): string[] => (form.key === "" && form.value === "" ? [] : kind.problems(form.key, form.value));

export const can_save = (kind: PairsKind, state: PairsState): boolean => !state.busy && state.form.key !== "" && state.form.value.trim() !== "" && form_problems(kind, state.form).length === 0;

export function create_pairs_session(kind: PairsKind, deps: PairsDeps) {
  const state: PairsState = { rows: [], loaded: false, form: { ...EMPTY_FORM }, busy: false };

  const ask = async <T>(message: PairsRequest): Promise<T | { ok: false; message: string }> => {
    try {
      return (await deps.send(message)) as T;
    } catch (error) {
      return { ok: false, message: message_of(error) };
    }
  };

  async function refresh(): Promise<void> {
    const answer = await ask<ListAnswer>(kind.list);
    if (answer.ok) {
      state.rows = kind.rows_of(answer);
      state.loaded = true;
      delete state.error;
    } else state.error = `The ${kind.noun}s could not be loaded: ${answer.message}`;
    deps.on_change();
  }

  // One request at a time. The form clears after a save and stays after a refusal, so the user can fix the field.
  async function change(request: PairsRequest, cleared: boolean): Promise<void> {
    const sent = JSON.stringify([state.form, state.editing]);
    state.busy = true;
    delete state.message;
    deps.on_change();
    const answer = await ask<ChangeAnswer>(request);
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

  const set_field = (name: keyof PairsForm, value: string): void => {
    state.form[name] = value;
    delete state.message;
    deps.on_change();
  };

  function edit(row: PairRow): void {
    state.form = { key: row.key, value: row.value };
    state.editing = row.key;
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
    if (!can_save(kind, state)) return;
    await change(kind.set(state.form.key, state.form.value), true);
  }

  const remove = (key: string) => change(kind.remove(key), false);

  return { state, refresh, set_field, edit, clear_form, save, remove };
}

export type PairsSession = ReturnType<typeof create_pairs_session>;
