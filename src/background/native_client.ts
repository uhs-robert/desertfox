// The background's client for the native host: one one-shot `sendNativeMessage` per request, behind a permission check.
// Every failure is a NativeHostError with a message that says what to do, so callers can show it as it is.

import { NATIVE_HOST_NAME, NATIVE_PERMISSION } from "../shared/native_host.ts";

// "host_outdated": the host answered with an error and is older than the extension. The message says whether it is updating.
export type NativeFailure = "no_permission" | "host_missing" | "host_failed" | "bad_reply" | "host_outdated";

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

export type EditorStartRequest = { text: string; ext?: string; insert?: boolean };
// `pending` while the editor runs. `done` with `changed` and, only when changed, the edited `text`.
export type EditorCollectReply = { pending: true } | { done: true; changed: false } | { done: true; changed: true; text: string };

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
    // Mirrors the saved edits (TOML text) into autoconfig.toml. The host writes no other file.
    write_autoconfig: async (toml: string): Promise<void> => {
      await call({ cmd: "write_autoconfig", toml });
    },
  };
}

export const browser_native_deps = (): NativeDeps => ({
  has_permission: () => browser.permissions.contains({ permissions: [NATIVE_PERMISSION] }),
  send: (message) => browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, message),
});
