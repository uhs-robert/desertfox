// No DOM: the state of the settings page's transfer section. It picks the files to import, holds the preview and the user's consent per snippet, and builds the export zips.
// Nothing is sent to be stored until `commit`, and `commit` sends only the snippets the user ticked, with the code the preview showed.

import type { CommitConfigImport, ConfigImportAnswer, ConfigImportPreview, ExportConfig, ExportConfigAnswer, ExportSessions, ExportSessionsAnswer, ImportSessions, ImportSource, InstalledSnippet, ListSnippets, ListSnippetsAnswer, PreviewConfigImport, RemoveSnippet } from "../shared/messages.ts";
import { DEFAULT_ZIP_LIMITS, write_zip, ZipError, type ZipLimits } from "../shared/zip.ts";

export const CONFIG_ZIP_NAME = "desertfox-config.zip";
export const SNIPPETS_ZIP_NAME = "desertfox-snippets.zip";
export const SESSIONS_FILE_NAME = "desertfox-sessions.json";

// 400 sessions of 50 tabs are about 5 MB, so 16 MB leaves room and still stops a file that would fill memory.
export const MAX_SESSIONS_FILE_BYTES = 16 * 1024 * 1024;

// Said before the warning, because the reader meets the word only on this consent view.
export const SNIPPET_GLOSS = "A snippet is a small script that changes how a site works.";

export const SNIPPET_WARNING = "A snippet is code that runs in the pages it matches and can use every DesertFox permission: it can read and change any page it matches, open and close tabs, and read your bookmarks and history. Accept only snippets you have read and trust.";

// What the page needs of a `File`. A test passes plain objects.
export type PickedFile = { name: string; size: number; webkitRelativePath?: string; text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> };

// A zip is read by the background through the same guards as a folder, but its bytes cross the message first. Its own headers add a little to the content it holds.
const ZIP_OVERHEAD_BYTES_PER_ENTRY = 1024;

// The page checks `File.size` against the zip limits before it reads a byte of a file, so a huge file never lands in memory. The background checks again after the read, because the page is not the only sender.
export async function read_zip_file(file: PickedFile, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<ImportSource> {
  const cap = limits.max_total_bytes + limits.max_entries * ZIP_OVERHEAD_BYTES_PER_ENTRY;
  if (file.size > cap) throw new ZipError(`${file.name} is too large (${file.size} bytes, limit ${cap})`);
  return { kind: "zip", bytes: await file.arrayBuffer() };
}

export async function read_folder_files(files: PickedFile[], limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<ImportSource> {
  if (files.length > limits.max_entries) throw new ZipError(`too many files: ${files.length} (limit ${limits.max_entries})`);
  let total = 0;
  for (const file of files) {
    if (file.size > limits.max_entry_bytes) throw new ZipError(`${file.webkitRelativePath || file.name} is too large (${file.size} bytes, limit ${limits.max_entry_bytes})`);
    total += file.size;
    if (total > limits.max_total_bytes) throw new ZipError(`the folder is too large (limit ${limits.max_total_bytes} bytes)`);
  }
  const entries = await Promise.all(files.map(async (file) => ({ path: file.webkitRelativePath || file.name, text: await file.text() })));
  return { kind: "folder", entries };
}

export type Review = {
  source: ImportSource;
  preview: Extract<ConfigImportPreview, { ok: true }>;
  // The paths of the snippets the user ticked. Empty at first: no consent is assumed.
  accepted: Set<string>;
};

export type TransferState = {
  busy: boolean;
  message?: { ok: boolean; text: string } | undefined;
  review?: Review | undefined;
  snippets: InstalledSnippet[];
};

export type TransferDeps = {
  send: (message: PreviewConfigImport | CommitConfigImport | ExportConfig | ListSnippets | RemoveSnippet | ExportSessions | ImportSessions) => Promise<unknown>;
  on_change: () => void;
};

export type ExportFile = { name: string; bytes: Uint8Array; mime?: string };

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function accepted_code(review: Review): Record<string, string> {
  return Object.fromEntries(review.preview.snippets.filter((snippet) => review.accepted.has(snippet.path)).map((snippet) => [snippet.path, snippet.code]));
}

export function can_commit(review: Review): boolean {
  return review.preview.problems.length === 0 && (review.preview.config_files.length > 0 || review.accepted.size > 0);
}

export function create_transfer_session(deps: TransferDeps) {
  const state: TransferState = { busy: false, snippets: [] };
  // A new pick or a cancel supersedes any pick still waiting on its preview, so a late answer cannot replace the newer review or revive a cancelled one.
  let selection = 0;
  const set = (change: Partial<TransferState>) => {
    Object.assign(state, change);
    deps.on_change();
  };
  const say = (ok: boolean, text: string) => set({ message: { ok, text } });

  async function load_snippets(): Promise<void> {
    const answer = (await deps.send({ type: "list_snippets" }).catch((error: unknown) => ({ ok: false, message: message_of(error) }))) as ListSnippetsAnswer;
    if (answer.ok) set({ snippets: answer.snippets });
    else say(false, `The snippet list could not be loaded: ${answer.message}`);
  }

  // Reads the pick and asks for the preview. Nothing is stored, and the review replaces an earlier one.
  async function choose(read: () => Promise<ImportSource>): Promise<void> {
    const mine = ++selection;
    set({ busy: true, review: undefined });
    try {
      const source = await read();
      if (mine !== selection) return;
      const preview = (await deps.send({ type: "preview_config_import", source })) as ConfigImportPreview;
      if (mine !== selection) return;
      if (preview.ok) set({ busy: false, message: undefined, review: { source, preview, accepted: new Set() } });
      else set({ busy: false, message: { ok: false, text: preview.message } });
    } catch (error) {
      if (mine !== selection) return;
      set({ busy: false, message: { ok: false, text: error instanceof ZipError ? `Settings not imported, the current ones stay. The import is refused: ${error.message}.` : `Settings not imported, the current ones stay. ${message_of(error)}` } });
    }
  }

  function accept(path: string, on: boolean): void {
    if (!state.review) return;
    if (on) state.review.accepted.add(path);
    else state.review.accepted.delete(path);
    deps.on_change();
  }

  // Every outcome ends the review. A refusal leaves the config as it was, so the page then shows what is installed again.
  async function commit(): Promise<void> {
    const review = state.review;
    if (!review || state.busy || !can_commit(review)) return;
    set({ busy: true });
    let answer: ConfigImportAnswer;
    try {
      answer = (await deps.send({ type: "commit_config_import", source: review.source, accepted: accepted_code(review) })) as ConfigImportAnswer;
    } catch (error) {
      answer = { ok: false, message: `Settings not imported, the current ones stay. ${message_of(error)}` };
    }
    set({ busy: false, review: undefined, message: { ok: answer.ok, text: answer.message } });
    await load_snippets();
  }

  function cancel(): void {
    selection++;
    set({ busy: false, review: undefined, message: { ok: true, text: "Import cancelled. Nothing was stored." } });
  }

  async function remove(path: string): Promise<void> {
    set({ busy: true });
    const answer = (await deps.send({ type: "remove_snippet", path }).catch((error: unknown) => ({ ok: false, message: message_of(error) }))) as ConfigImportAnswer;
    set({ busy: false, message: { ok: answer.ok, text: answer.message } });
    await load_snippets();
  }

  // The zip to download, or nothing with the reason in the message.
  async function export_zip(which: "config" | "snippets"): Promise<ExportFile | undefined> {
    const answer = (await deps.send({ type: "export_config" }).catch((error: unknown) => ({ ok: false, message: message_of(error) }))) as ExportConfigAnswer;
    const name = which === "config" ? CONFIG_ZIP_NAME : SNIPPETS_ZIP_NAME;
    const files = !answer.ok ? undefined : which === "config" ? answer.config_files : answer.snippet_files;
    if (!answer.ok || !files) {
      say(false, `Nothing exported: ${answer.ok ? "" : answer.message}`);
      return undefined;
    }
    if (Object.keys(files).length === 0) {
      say(false, which === "config" ? "Nothing exported: you have no settings files and have saved no changes." : "Nothing exported: no snippet is installed.");
      return undefined;
    }
    try {
      const bytes = write_zip(files);
      say(true, `Exported ${name}.`);
      return { name, bytes };
    } catch (error) {
      say(false, `Nothing exported: ${message_of(error)}`);
      return undefined;
    }
  }

  // The sessions file to download, or nothing with the reason in the message.
  async function export_sessions(): Promise<ExportFile | undefined> {
    const answer = (await deps.send({ type: "export_sessions" }).catch((error: unknown) => ({ ok: false, message: message_of(error) }))) as ExportSessionsAnswer;
    if (!answer.ok) {
      say(false, `Nothing exported: ${answer.message}`);
      return undefined;
    }
    if (answer.count === 0) {
      say(false, "Nothing exported: no session is saved.");
      return undefined;
    }
    say(true, `Exported ${SESSIONS_FILE_NAME}.`);
    return { name: SESSIONS_FILE_NAME, bytes: new TextEncoder().encode(answer.json), mime: "application/json" };
  }

  // Adds the sessions of the picked file at once: they are data, not code, and a name that is taken keeps both.
  async function import_sessions(file: PickedFile): Promise<void> {
    if (file.size > MAX_SESSIONS_FILE_BYTES) {
      say(false, `Sessions not imported: ${file.name} is too large (${file.size} bytes, limit ${MAX_SESSIONS_FILE_BYTES}).`);
      return;
    }
    set({ busy: true });
    try {
      const answer = (await deps.send({ type: "import_sessions", text: await file.text() })) as ConfigImportAnswer;
      set({ busy: false, message: { ok: answer.ok, text: answer.message } });
    } catch (error) {
      set({ busy: false, message: { ok: false, text: `Sessions not imported: ${message_of(error)}` } });
    }
  }

  return { state, load_snippets, choose, accept, commit, cancel, remove, export_zip, export_sessions, import_sessions };
}

export type TransferSession = ReturnType<typeof create_transfer_session>;
