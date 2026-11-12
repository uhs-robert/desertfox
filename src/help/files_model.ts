// No DOM: the state of the settings page's files editor. It lists the stored config files, holds the text being edited and sends each save to the background.
// The background decides. A refused save keeps the draft here, shows every problem and leaves the stored files alone.

import type { ConfigFilesAnswer, ConfigFilesRequest, SnippetPreview } from "../shared/messages.ts";
import { edit_problem } from "../shared/config_file_path.ts";
import { NO_USER_CSS_HOLD, type UserCssHold } from "./user_css_gate.ts";
import { template_for } from "./file_templates.ts";

export type FilesState = {
  files: Record<string, string>;
  // The file being edited. `is_new` means it is not stored yet.
  // `base` is the stored text the editor read, sent back with a save so a file changed meanwhile is not overwritten.
  open?: { path: string; text: string; is_new: boolean; base: string | null } | undefined;
  busy: boolean;
  message?: { ok: boolean; text: string } | undefined;
  problems: string[];
  // Set when a snippet save waits on the user's consent to this exact code.
  consent?: SnippetPreview | undefined;
  accepted: boolean;
};

export type FilesDeps = { send: (message: ConfigFilesRequest) => Promise<unknown>; on_change: () => void; user_css_hold?: UserCssHold };

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The session outlives the settings route: the page rebuilds its sections on every hash change, and `attach` points the session at the new view and the new CSS hold, so a draft or a running save survives the rebuild.
export function create_files_session(deps: FilesDeps) {
  const state: FilesState = { files: {}, busy: false, problems: [], accepted: false };
  const set = (change: Partial<FilesState>) => {
    Object.assign(state, change);
    // The consent card shows snippet code, so the user CSS stays off the page while it is up.
    (deps.user_css_hold ?? NO_USER_CSS_HOLD).set(state.consent !== undefined);
    deps.on_change();
  };
  const ask = (message: Parameters<FilesDeps["send"]>[0]) =>
    deps.send(message).then((answer) => answer as ConfigFilesAnswer, (error: unknown) => ({ ok: false, message: message_of(error) }) as ConfigFilesAnswer);

  // Rereads the stored files. A file that changed under an unedited draft is loaded into it, with its new base. An edited draft stays, and the base check refuses its save with the reopen message.
  async function load(): Promise<void> {
    const answer = await ask({ type: "config_files", op: "read" });
    if (answer.ok && "files" in answer) {
      const { open: editing } = state;
      const stored = editing === undefined || editing.is_new ? undefined : (answer.files[editing.path] ?? null);
      const follows = editing !== undefined && stored !== undefined && stored !== editing.base && editing.text === editing.base;
      set({ files: answer.files, ...(follows && { open: { ...editing, text: stored ?? editing.text, base: stored }, consent: undefined, accepted: false }) });
    }
    else set({ message: { ok: false, text: `The config files could not be loaded: ${"message" in answer ? answer.message : ""}` } });
  }

  function open(path: string): void {
    const text = state.files[path];
    if (text === undefined) return;
    set({ open: { path, text, is_new: false, base: text }, message: undefined, problems: [], consent: undefined, accepted: false });
  }

  // A new file starts from the template for its kind. Returns the reason it cannot, which the page shows.
  function start_new(path: string): string | undefined {
    const problem = edit_problem(path, "", state.files);
    if (problem) return problem;
    if (Object.hasOwn(state.files, path)) return `${path} exists already. Open it from the list.`;
    set({ open: { path, text: template_for(path), is_new: true, base: null }, message: undefined, problems: [], consent: undefined, accepted: false });
    return undefined;
  }

  // A change of text voids the consent: it was to the code the preview showed.
  function edit(text: string): void {
    if (!state.open) return;
    set({ open: { ...state.open, text }, consent: undefined, accepted: false });
  }

  function accept(on: boolean): void {
    set({ accepted: on });
  }

  // The answer changes only what still matches the submitted text: text typed while the save ran stays as typed.
  async function send_save(path: string, text: string | null, accepted?: string): Promise<boolean> {
    set({ busy: true });
    // The text read when the file was opened, not the list as reloaded since: a changed file must still refuse.
    const base = state.open?.path === path ? state.open.base : (state.files[path] ?? null);
    const answer = await ask({ type: "config_files", op: "save", path, text, base, ...(accepted !== undefined && { accepted }) });
    const same_draft = state.open?.path === path && state.open.text === text;
    if (answer.ok) {
      await load();
      const open = state.open;
      set({
        busy: false,
        message: { ok: true, text: "message" in answer ? answer.message : "Saved." },
        problems: [],
        ...(same_draft && { consent: undefined, accepted: false }),
        ...(open?.path === path && text !== null && { open: { ...open, is_new: false, base: text } }),
      });
      return true;
    }
    if ("consent" in answer) set({ busy: false, ...(same_draft && { consent: answer.consent, accepted: false }), message: undefined, problems: [] });
    else {
      set({ busy: false, message: { ok: false, text: answer.message }, problems: "problems" in answer ? (answer.problems ?? []) : [] });
      // The refusal may mean the stored files moved on, so the list shows them again.
      await load();
    }
    return false;
  }

  async function save(): Promise<void> {
    const { open: editing } = state;
    if (!editing || state.busy) return;
    // A snippet already consented to goes with its exact text.
    const accepted = state.consent && state.accepted && state.consent.code === editing.text ? editing.text : undefined;
    await send_save(editing.path, editing.text, accepted);
  }

  async function remove(path: string): Promise<void> {
    if (state.busy || !Object.hasOwn(state.files, path)) return;
    if (await send_save(path, null) && state.open?.path === path) set({ open: undefined, consent: undefined, accepted: false });
  }

  function close(): void {
    set({ open: undefined, consent: undefined, accepted: false, problems: [], message: undefined });
  }

  function attach(on_change: () => void, user_css_hold: UserCssHold): void {
    deps.on_change = on_change;
    deps.user_css_hold = user_css_hold;
    user_css_hold.set(state.consent !== undefined);
  }

  return { state, load, open, start_new, edit, accept, save, remove, close, attach };
}

export type FilesSession = ReturnType<typeof create_files_session>;
