// The background's client for the native host: one one-shot `sendNativeMessage` per request, behind a permission check.
// Every failure is a NativeHostError with a message that says what to do, so callers can show it as it is.

import { NATIVE_HOST_NAME, NATIVE_PERMISSION } from "../shared/native_host.ts";
import { ENGINE_FILE } from "./engine_file.ts";
import { KEYS_FILE } from "./engine_keys_file.ts";

// "host_outdated": the host answered with an error and is older than the extension. The message says whether it is updating.
// "file_changed": `write_config_file` found the file changed on disk since the extension read it, and wrote nothing.
// "file_not_read_back": `write_config_file` could not read the old file back after its rename, so it put that file back and wrote nothing. No edit is known, so a later write can try again.
export type NativeFailure = "no_permission" | "host_missing" | "host_failed" | "bad_reply" | "host_outdated" | "file_changed" | "file_not_read_back";

export class NativeHostError extends Error {
  readonly failure: NativeFailure;
  constructor(failure: NativeFailure, message: string) {
    super(message);
    this.name = "NativeHostError";
    this.failure = failure;
  }
}

export type NativeDeps = {
  has_permission: () => Promise<boolean>;
  send: (message: object) => Promise<unknown>;
};

// What the client tells the update watcher. `seen` gets the `release_version` of every reply of the config host, ok or error.
// `outdated_note` is a short state ("updating", "update failed: ...") while the host is older than the extension, else undefined.
export type HostWatch = {
  seen: (release_version: unknown) => void;
  outdated_note: () => string | undefined;
};

export type SelfUpdateRequest = { version: string; sha256: Record<string, string> };
export type SelfUpdateReply = { updated: boolean; version: string };

// `private` is sent only for a private window, so a host that predates it refuses the request instead of writing the text to the disk.
export type EditorStartRequest = { text: string; ext?: string; insert?: boolean; private?: boolean };
// `pending` while the editor runs. `done` with `changed` and, only when changed, the edited `text`.
export type EditorCollectReply = { pending: true } | { done: true; changed: false } | { done: true; changed: true; text: string };

// How the host's `write_config_file` names each file the extension writes: its kind table builds the path from these, so the request carries none.
// The theme name pattern is the host's check and `theme_name_shape_problem`'s (src/shared/theme/base16.ts).
type FixedFileKind = "settings" | "engines" | "search_keys" | "keymap" | "search_engines" | "command_aliases" | "quickmarks" | "style";
type NamedFileKind = "theme" | "settings_d" | "keymap_d" | "search_engines_d" | "command_aliases_d" | "quickmarks_d" | "style_d";
export type HostFile = { kind: FixedFileKind } | { kind: NamedFileKind; name: string };
const THEME_FILE_PATTERN = /^themes\/([a-z0-9][a-z0-9_-]{0,47})\.toml$/;

// The page's two files come first, so `zz-desertfox.toml` in keymap.d or search_engines.d keeps its own kind, which the host's `.d` kinds refuse.
const FIXED_FILE_KINDS: Record<string, FixedFileKind> = {
  "settings.toml": "settings",
  [ENGINE_FILE]: "engines",
  [KEYS_FILE]: "search_keys",
  "keymap.toml": "keymap",
  "search_engines.toml": "search_engines",
  "command_aliases.toml": "command_aliases",
  "quickmarks.toml": "quickmarks",
  "style.css": "style",
};
const D_FOLDER_KINDS: Record<string, { kind: NamedFileKind; ext: string }> = {
  "settings.d": { kind: "settings_d", ext: ".toml" },
  "keymap.d": { kind: "keymap_d", ext: ".toml" },
  "search_engines.d": { kind: "search_engines_d", ext: ".toml" },
  "command_aliases.d": { kind: "command_aliases_d", ext: ".toml" },
  "quickmarks.d": { kind: "quickmarks_d", ext: ".toml" },
  "style.d": { kind: "style_d", ext: ".css" },
};
// The host's `.d` name check: no slash, backslash or control character, no leading dot, and room for its hidden temporary name.
// eslint-disable-next-line no-control-regex
const D_FILE_NAME_PATTERN = /^[^./\\\u0000-\u001f\u007f][^/\\\u0000-\u001f\u007f]*$/;
const D_FILE_NAME_MAX_BYTES = 240;

function d_folder_file_of(path: string): HostFile | undefined {
  const slash = path.indexOf("/");
  const folder = D_FOLDER_KINDS[path.slice(0, slash)];
  if (slash < 0 || folder === undefined || !path.endsWith(folder.ext)) return undefined;
  const name = path.slice(slash + 1, -folder.ext.length);
  const fits = D_FILE_NAME_PATTERN.test(name) && new TextEncoder().encode(name).length <= D_FILE_NAME_MAX_BYTES;
  return fits ? { kind: folder.kind, name } : undefined;
}

export function host_file_of(path: string): HostFile | undefined {
  const fixed = Object.hasOwn(FIXED_FILE_KINDS, path) ? FIXED_FILE_KINDS[path] : undefined;
  if (fixed !== undefined) return { kind: fixed };
  const theme = THEME_FILE_PATTERN.exec(path);
  return theme ? { kind: "theme", name: theme[1]! } : d_folder_file_of(path);
}

export type ConfigFilesReply = { config_dir: string; config_dir_exists: boolean; files: Record<string, string> };

const INSTALL_HINT = "Run :native.install and follow the steps on the page.";

// Firefox words its failures differently from one version to the next, so only the stable part of the missing-host case is matched.
function describe_send_failure(error: unknown): NativeHostError {
  const text = error instanceof Error ? error.message : String(error);
  if (/no such native application/i.test(text)) {
    return new NativeHostError("host_missing", `The DesertFox native host is not installed (Firefox: ${text}). ${INSTALL_HINT}`);
  }
  return new NativeHostError("host_failed", `The DesertFox native host failed to run (Firefox: ${text}). Run it by hand to see its output: ~/.local/share/desertfox/desertfox-host`);
}

// Whether the host refused `cmd` itself as a verb it does not know. Its whole refusal ends the message, so a path in another error that holds the words does not count.
const refuses_unknown_verb = (error: NativeHostError, cmd: string): boolean => error.message.endsWith(`refused: unknown cmd: '${cmd}'`);
// Whether a host with `write_config_file` refused the request's kind as one its table lacks: a host from before that kind.
const refuses_unknown_kind = (error: NativeHostError, kind: unknown): boolean => typeof kind === "string" && error.message.includes(`refused: write_config_file has no kind '${kind}'.`);

export function create_native_client(deps: NativeDeps, watch?: HostWatch) {
  // `watched: false` is the updater's own call: its reply must not start another update or wear the outdated label.
  async function call(request: { cmd: string } & Record<string, unknown>, watched = true): Promise<Record<string, unknown>> {
    if (!(await deps.has_permission())) {
      throw new NativeHostError("no_permission", `DesertFox has no permission to talk to its native host. ${INSTALL_HINT}`);
    }
    let reply: unknown;
    try {
      reply = await deps.send(request);
    } catch (error) {
      throw describe_send_failure(error);
    }
    if (typeof reply !== "object" || reply === null || typeof (reply as { ok?: unknown }).ok !== "boolean") {
      throw new NativeHostError("bad_reply", "The DesertFox native host sent a reply that is not understood. Reinstall it with :native.install.");
    }
    const checked = reply as Record<string, unknown>;
    if (watched) watch?.seen(checked.release_version);
    if (checked.ok !== true) {
      const note = watched ? watch?.outdated_note() : undefined;
      if (note !== undefined) throw new NativeHostError("host_outdated", `The DesertFox native host is older than the extension (${note}). It refused: ${String(checked.error ?? "no reason given")}`);
      throw new NativeHostError("host_failed", `The DesertFox native host refused: ${String(checked.error ?? "no reason given")}`);
    }
    return checked;
  }

  async function read_config(): Promise<ConfigFilesReply> {
    const reply = await call({ cmd: "read_config" });
    const files = reply.files;
    if (typeof files !== "object" || files === null || Object.values(files).some((text) => typeof text !== "string")) {
      throw new NativeHostError("bad_reply", "The DesertFox native host sent no file list. Reinstall it with :native.install.");
    }
    return { config_dir: String(reply.config_dir ?? ""), config_dir_exists: reply.config_dir_exists !== false, files: files as Record<string, string> };
  }

  // A write's refusals by their words: a hand edit since the read, an old file the host could not read back, and a host from before the verb.
  // `older_verb` sends the same write through a verb such a host knows. Without one, that host reads as outdated.
  async function write_call(request: { cmd: string } & Record<string, unknown>, older_verb?: () => Promise<void>): Promise<void> {
    try {
      await call(request);
    } catch (error) {
      if (!(error instanceof NativeHostError)) throw error;
      if (/changed on disk/.test(error.message)) throw new NativeHostError("file_changed", error.message);
      if (/could not be read back/.test(error.message)) throw new NativeHostError("file_not_read_back", error.message);
      if (refuses_unknown_verb(error, request.cmd) && older_verb) return older_verb();
      if (refuses_unknown_verb(error, request.cmd) || refuses_unknown_kind(error, request.kind)) throw new NativeHostError("host_outdated", `${error.message}. Update the native host with :native.update.`);
      throw error;
    }
  }

  return {
    // Raw text of every config file, keyed by path relative to the config folder. The extension's config build parses it. Sends nothing without the permission.
    read_config,
    // Asks the config host to replace itself, the bridge and the command line with release `version`. The hashes come from the signed build.
    self_update: async (request: SelfUpdateRequest): Promise<SelfUpdateReply> => {
      const reply = await call({ cmd: "self_update", ...request }, false);
      if (typeof reply.updated !== "boolean" || typeof reply.version !== "string") {
        throw new NativeHostError("bad_reply", "The DesertFox native host answered the update in a way that is not understood. Run the command from :native.install.");
      }
      return { updated: reply.updated, version: reply.version };
    },
    // Opens the user's editor on `text`, as the host's config says. Answers the job id to collect with.
    editor_start: async (request: EditorStartRequest): Promise<string> => {
      const reply = await call({ cmd: "editor_start", ...request });
      if (typeof reply.job !== "string" || reply.job === "") throw new NativeHostError("bad_reply", "The DesertFox native host started the editor but named no job. Update it with :native.update.");
      return reply.job;
    },
    // Waits on the host (about 20 s) for the editor of `job` to end. Both a failure and an unknown job throw, so the caller clears the job.
    editor_collect: async (job: string): Promise<EditorCollectReply> => {
      const reply = await call({ cmd: "editor_collect", job });
      if (reply.pending === true) return { pending: true };
      if (reply.done === true && reply.changed === false) return { done: true, changed: false };
      if (reply.done === true && reply.changed === true && typeof reply.text === "string") return { done: true, changed: true, text: reply.text };
      throw new NativeHostError("bad_reply", "The DesertFox native host answered the editor in a way that is not understood. Update it with :native.update.");
    },
    // Asks the Firefox that runs the host to open one page of the host's fixed table. A host from before the verb answers `unknown cmd`, and a `dev` host never reports outdated, so that reply says to update.
    open_firefox_page: async (page: string): Promise<void> => {
      try {
        await call({ cmd: "open_firefox_page", page });
      } catch (error) {
        if (error instanceof NativeHostError && error.failure === "host_failed" && /unknown cmd/.test(error.message)) {
          throw new NativeHostError("host_outdated", `${error.message}. Update the native host with :native.update.`);
        }
        throw error;
      }
    },
    // The installed font family names, from the host's `fc-list`. A host from before the verb refuses with `unknown cmd`.
    list_fonts: async (): Promise<string[]> => {
      const { fonts } = await call({ cmd: "list_fonts" });
      if (!Array.isArray(fonts) || fonts.some((name) => typeof name !== "string")) throw new NativeHostError("bad_reply", "The DesertFox native host sent no font list. Update it with :native.update.");
      return fonts as string[];
    },
    // Mirrors the key edits (TOML text) into autoconfig.toml.
    write_autoconfig: async (toml: string): Promise<void> => {
      await call({ cmd: "write_autoconfig", toml });
    },
    // Replaces the file at `path` with `text`, or deletes it for null, while the file on disk still has the digest `base_sha256` (null: no file).
    // The request names the file by the host's kind and name, never by path. A host from before the verb answers `unknown cmd`: settings.toml then goes through its older `write_settings`, and any other file reads as outdated, so the caller waits for an update.
    // A host from before a kind (engines, search_keys, the import's kinds) reads as outdated too.
    write_config_file: async (path: string, text: string | null, base_sha256: string | null): Promise<void> => {
      const file = host_file_of(path);
      if (file === undefined) throw new Error(`The native host writes no file at ${path}`);
      const older_verb = file.kind === "settings" && text !== null ? () => write_call({ cmd: "write_settings", text, base_sha256 }) : undefined;
      await write_call({ cmd: "write_config_file", ...file, text, base_sha256 }, older_verb);
    },
  };
}

// A host that cannot list fonts at all: not installed, no permission, or too old to know the verb. Any other failure is a call that went wrong.
// The `.catch` handler of `list_fonts`: a missing host reads as undefined, and any other failure goes on.
export function missing_host_as_undefined(error: unknown): undefined {
  if (error instanceof NativeHostError && (error.failure === "host_missing" || error.failure === "no_permission" || error.failure === "host_outdated" || /unknown cmd/.test(error.message))) return undefined;
  throw error;
}

export const browser_native_deps = (): NativeDeps => ({
  has_permission: () => browser.permissions.contains({ permissions: [NATIVE_PERMISSION] }),
  send: (message) => browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, message),
});
