// No DOM: the state of the Keys section on the settings page. It lists the bindings, holds one open row editor and a draft per row, and sends the check and each edit to the background.
// The background decides. The page only shows what the check says and keeps the sequence in the spelling the background answers with.

import type { BindingRow, ChangeKeymap, ChangeKeymapAnswer, CheckBinding, CheckBindingAnswer, ListBindings, ListBindingsAnswer } from "../shared/messages.ts";
import type { KeymapMode } from "../shared/keymap.ts";
import { parse_sequence } from "../shared/keys/index.ts";

// The check refuses a text that holds this, so such a row is read-only here.
const STEP_JOINER = " ; ";
export const CHECK_DELAY_MS = 250;

export const READ_ONLY_ROW_NOTE = "This binding runs several steps. Edit it in keymap.toml or a keymap.d file, then run config.reload. Here you can unbind it or reset it.";

// Firefox keeps these for itself, so a page never sees them and the capture box cannot take them.
export const RESERVED_CHORDS_NOTE = "Firefox keeps some chords for itself, such as Ctrl+T, Ctrl+W, Ctrl+N and F5, so they cannot be captured here. Escape cancels a capture, Backspace drops the last key, Tab moves the focus and Enter saves, so bind those four in the config files.";

export const is_read_only = (row: BindingRow): boolean => row.text.includes(STEP_JOINER);
export const row_id = (mode: KeymapMode, keys: string): string => `${mode}\u0000${keys}`;
const NEW_SUFFIX = "\u0000new";

export type CheckView =
  | { state: "waiting" }
  | { state: "checking" }
  | { state: "done"; saves: boolean; problems: string[]; warnings: string[]; shadows: { keys: string; text: string }[] }
  | { state: "failed"; message: string };

// What the row editor holds. A draft is one of these, kept while the editor shows another row or the list refreshes.
export type Editor = {
  id: string;
  mode: KeymapMode;
  // The row this edits. Absent for a new binding, and for a row another tab removed.
  original?: BindingRow | undefined;
  // The row's text when the editor opened it. A refresh moves `original` on, so a move sends this to tell the background what the user saw.
  opened_text?: string | undefined;
  tokens: string[];
  // True while the keys shown are the row's own: the first key press replaces them instead of adding to them.
  fresh: boolean;
  text: string;
  check: CheckView;
  busy: boolean;
  message?: { ok: boolean; text: string } | undefined;
};

export type KeysState = {
  rows: BindingRow[];
  loaded: boolean;
  filter: string;
  open?: Editor | undefined;
  // The text of the datalist: command names, aliases and snippet names.
  names: string[];
  // Counts the times an editor was opened, so the page moves focus into it on a new open and not on a redraw.
  opened: number;
  error?: string | undefined;
};

export type KeysDeps = {
  send: (message: ListBindings | CheckBinding | ChangeKeymap) => Promise<unknown>;
  names?: () => Promise<string[]>;
  // Runs `run` after `ms` and returns the call that cancels it. Tests pass their own.
  schedule?: (run: () => void, ms: number) => () => void;
  // "rows" when the list, the filter or the open row changed, "editor" when only the open editor did.
  on_change: (what: "rows" | "editor") => void;
};

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const keys_of = (tokens: readonly string[]): string => tokens.join("");
export const tokens_of = (keys: string): string[] => {
  const parsed = parse_sequence(keys);
  return parsed.tokens ?? [];
};

// An editor that differs from its row (or a new one with something typed) is a draft worth keeping.
export function is_dirty(editor: Editor): boolean {
  const { original } = editor;
  return original === undefined ? editor.tokens.length > 0 || editor.text !== "" : keys_of(editor.tokens) !== original.keys || editor.text !== original.text;
}

// The keys a save would free: a save on other keys than the row's own moves the binding.
export const freed_keys = (editor: Editor): string | undefined => (editor.original && keys_of(editor.tokens) !== editor.original.keys ? editor.original.keys : undefined);

// The old text goes along, so the background refuses the move when another tab changed the old key since the row was shown.
const moved_from = (editor: Editor): { move_from?: string; move_from_text?: string } => {
  const keys = freed_keys(editor);
  return keys === undefined ? {} : { move_from: keys, ...(editor.opened_text !== undefined && { move_from_text: editor.opened_text }) };
};

// A row matches when the filter is part of its keys, its command text, its mode or its origin.
export function matches_filter(row: BindingRow, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  return needle === "" || [row.keys, row.text, row.mode, row.origin].some((field) => field.toLowerCase().includes(needle));
}

// The buttons a row's editor offers. Reset drops a browser edit, so it needs one. Remove unbinds what is bound.
export function actions_of(editor: Editor): { save: boolean; remove: boolean; reset: boolean } {
  const original = editor.original;
  return {
    save: !editor.busy && !(original && is_read_only(original)) && editor.tokens.length > 0 && editor.text.trim() !== "" && is_dirty(editor),
    remove: !editor.busy && original !== undefined && original.origin !== "removed",
    reset: !editor.busy && original !== undefined && (original.origin === "edit" || original.origin === "removed"),
  };
}

export function create_keys_session(deps: KeysDeps) {
  const state: KeysState = { rows: [], loaded: false, filter: "", names: [], opened: 0 };
  const drafts = new Map<string, Editor>();
  const schedule = deps.schedule ?? ((run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  });
  let cancel_check: (() => void) | undefined;
  // Bumped at each check and at each edit of the sequence or text, so a late answer for an old text is dropped.
  let check_serial = 0;
  let refresh_running = false;
  let refresh_again = false;

  const ask = async <T>(message: Parameters<KeysDeps["send"]>[0]): Promise<T | { ok: false; message: string }> => {
    try {
      return (await deps.send(message)) as T;
    } catch (error) {
      return { ok: false, message: message_of(error) };
    }
  };

  async function read_rows(): Promise<boolean> {
    const answer = await ask<ListBindingsAnswer>({ type: "list_bindings" });
    if (!answer.ok) {
      state.error = `The bindings could not be loaded: ${answer.message}`;
      return false;
    }
    delete state.error;
    state.rows = answer.bindings;
    state.loaded = true;
    // An editor keeps its text and keys. Only the row it edits is read again, so Remove and Reset follow another tab's change.
    for (const editor of [...drafts.values(), ...(state.open ? [state.open] : [])]) editor.original = editor.original && state.rows.find((row) => row.mode === editor.mode && row.keys === editor.original!.keys);
    return true;
  }

  // A snippet saved or removed since the last read changes the names, so every read takes them again.
  async function read_names(): Promise<void> {
    if (deps.names) state.names = await deps.names().catch(() => state.names);
  }

  async function load(): Promise<void> {
    await read_names();
    await read_rows();
    deps.on_change("rows");
  }

  // Many storage events arrive for one change, so overlapping calls share one more pass.
  async function refresh(): Promise<void> {
    if (refresh_running) {
      refresh_again = true;
      return;
    }
    refresh_running = true;
    try {
      do {
        refresh_again = false;
        await read_names();
        await read_rows();
        deps.on_change("rows");
      } while (refresh_again);
    } finally {
      refresh_running = false;
    }
  }

  const stop_check = () => {
    cancel_check?.();
    cancel_check = undefined;
    check_serial += 1;
  };

  // Only an editor that differs from its row is kept as a draft. One that matches is read fresh when it opens again.
  function show(editor: Editor | undefined): void {
    stop_check();
    if (state.open && is_dirty(state.open)) drafts.set(state.open.id, state.open);
    if (editor) drafts.delete(editor.id);
    state.open = editor;
    if (editor) state.opened += 1;
    deps.on_change("rows");
    if (editor) start_check(editor);
  }

  function open_row(row: BindingRow): void {
    const id = row_id(row.mode, row.keys);
    // The open row is not in `drafts` yet, so a click on it again must find it here or its edits are lost.
    const kept = state.open?.id === id ? state.open : drafts.get(id);
    // A kept draft keeps the text it opened on, so a move still refuses when another tab changed the row since.
    if (kept) kept.original = row;
    show(kept ?? { id, mode: row.mode, original: row, opened_text: row.text, tokens: tokens_of(row.keys), fresh: true, text: row.text, check: { state: "waiting" }, busy: false });
  }

  function open_new(mode: KeymapMode): void {
    const id = `${mode}${NEW_SUFFIX}`;
    show((state.open?.id === id ? state.open : drafts.get(id)) ?? { id, mode, tokens: [], fresh: false, text: "", check: { state: "waiting" }, busy: false });
  }

  // Closing keeps the draft of an edited row, so coming back finds it.
  const close = (): void => show(undefined);

  function set_filter(filter: string): void {
    state.filter = filter;
    deps.on_change("rows");
  }

  // The check runs 250 ms after the last change, and only on a binding that could save: keys and a text, not a read-only row.
  function start_check(editor: Editor): void {
    stop_check();
    const original = editor.original;
    if (editor.tokens.length === 0 || editor.text.trim() === "" || (original && is_read_only(original))) {
      editor.check = { state: "waiting" };
      deps.on_change("editor");
      return;
    }
    if (original && keys_of(editor.tokens) === original.keys && editor.text === original.text) {
      editor.check = { state: "waiting" };
      deps.on_change("editor");
      return;
    }
    editor.check = { state: "checking" };
    deps.on_change("editor");
    const serial = check_serial;
    cancel_check = schedule(() => void run_check(editor, serial), CHECK_DELAY_MS);
  }

  async function run_check(editor: Editor, serial: number): Promise<void> {
    cancel_check = undefined;
    const answer = await ask<CheckBindingAnswer>({ type: "check_binding", mode: editor.mode, keys: keys_of(editor.tokens), text: editor.text, ...(freed_keys(editor) !== undefined && { move_from: freed_keys(editor)! }) });
    if (serial !== check_serial || state.open !== editor) return;
    if (!answer.ok) editor.check = { state: "failed", message: answer.message };
    else {
      editor.check = { state: "done", saves: answer.saves, problems: answer.problems, warnings: answer.warnings, shadows: answer.shadows };
      // The same spelling the background stores, so a typed or pasted sequence and a captured one meet the same row.
      if (answer.keys !== undefined && answer.keys !== keys_of(editor.tokens)) editor.tokens = tokens_of(answer.keys);
    }
    deps.on_change("editor");
  }

  const edit = (change: (editor: Editor) => void): void => {
    const editor = state.open;
    if (!editor || editor.busy) return;
    change(editor);
    delete editor.message;
    start_check(editor);
  };

  // A row with several steps keeps its keys: its capture box shows them and changes nothing.
  const keys_edit = (change: (editor: Editor) => void): void => edit((editor) => {
    if (editor.original && is_read_only(editor.original)) return;
    change(editor);
  });
  const capture = (token: string) => keys_edit((editor) => {
    if (editor.fresh) editor.tokens = [];
    editor.fresh = false;
    editor.tokens.push(token);
  });
  const capture_backspace = () => keys_edit((editor) => {
    editor.fresh = false;
    editor.tokens.pop();
  });
  const clear_keys = () => keys_edit((editor) => {
    editor.fresh = false;
    editor.tokens = [];
  });
  const set_text = (text: string) => edit((editor) => void (editor.text = text));

  // Escape: the sequence goes back to the row's own keys, or to empty for a new binding.
  function cancel_capture(): void {
    keys_edit((editor) => {
      editor.tokens = editor.original ? tokens_of(editor.original.keys) : [];
      editor.fresh = editor.original !== undefined;
    });
  }

  // One request at a time. The editor follows the answer: the row it now edits, or a plain editor on the same keys when the row is gone.
  async function change(editor: Editor, request: Omit<ChangeKeymap, "type">, applied: (answer: Extract<ChangeKeymapAnswer, { ok: true }>) => void): Promise<void> {
    stop_check();
    editor.busy = true;
    deps.on_change("editor");
    const answer = await ask<ChangeKeymapAnswer>({ type: "change_keymap", ...request });
    editor.busy = false;
    if (answer.ok) {
      applied(answer);
      editor.message = { ok: true, text: answer.message };
    } else {
      editor.message = { ok: false, text: [answer.message, ...(("problems" in answer && answer.problems) || []).filter((problem) => !answer.message.includes(problem))].join("\n") };
    }
    deps.on_change("editor");
  }

  const settle = (editor: Editor, row: BindingRow | undefined): void => {
    stop_check();
    editor.check = { state: "waiting" };
    drafts.delete(editor.id);
    if (row === undefined) {
      // The binding is gone: a new one on the same keys can follow.
      editor.original = undefined;
      delete editor.opened_text;
      return;
    }
    // The editor now stands on the row the answer names, so Remove and Reset act on the key just saved.
    editor.original = row;
    editor.opened_text = row.text;
    editor.tokens = tokens_of(row.keys);
    editor.fresh = true;
    editor.text = row.text;
    editor.id = row_id(row.mode, row.keys);
  };

  async function save(): Promise<void> {
    const editor = state.open;
    if (!editor || !actions_of(editor).save) return;
    await change(editor, { mode: editor.mode, keys: keys_of(editor.tokens), action: "set", text: editor.text, ...moved_from(editor) }, (answer) => settle(editor, answer.row));
  }

  async function remove(): Promise<void> {
    const editor = state.open;
    if (!editor?.original || !actions_of(editor).remove) return;
    await change(editor, { mode: editor.mode, keys: editor.original.keys, action: "remove" }, (answer) => settle(editor, answer.row));
  }

  async function reset(): Promise<void> {
    const editor = state.open;
    if (!editor?.original || !actions_of(editor).reset) return;
    await change(editor, { mode: editor.mode, keys: editor.original.keys, action: "reset" }, (answer) => settle(editor, answer.row));
  }

  // Cancels a pending check, so a page that is torn down leaves no timer.
  const dispose = () => stop_check();

  return { state, load, refresh, open_row, open_new, close, set_filter, capture, capture_backspace, clear_keys, set_text, cancel_capture, save, remove, reset, dispose };
}

export type KeysSession = ReturnType<typeof create_keys_session>;
