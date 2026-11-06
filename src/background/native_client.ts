// The background's client for the native host: one one-shot `sendNativeMessage` per request, behind a permission check.
// Every failure is a NativeHostError with a message that says what to do, so callers can show it as it is.

import { NATIVE_HOST_NAME, NATIVE_PERMISSION } from "../shared/native_host.ts";

export type NativeFailure = "no_permission" | "host_missing" | "host_failed" | "bad_reply";

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

export function create_native_client(deps: NativeDeps) {
  async function call(request: { cmd: string } & Record<string, unknown>): Promise<Record<string, unknown>> {
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
    if (checked.ok !== true) {
      throw new NativeHostError("host_failed", `The DesertFox native host refused: ${String(checked.error ?? "no reason given")}`);
    }
    return checked;
  }

  return {
    // Raw text of every config file, keyed by path relative to the config folder. The extension's config build parses it.
    read_config: async (): Promise<ConfigFilesReply> => {
      const reply = await call({ cmd: "read_config" });
      const files = reply.files;
      if (typeof files !== "object" || files === null || Object.values(files).some((text) => typeof text !== "string")) {
        throw new NativeHostError("bad_reply", "The DesertFox native host sent no file list. Reinstall it with :native.install.");
      }
      return { config_dir: String(reply.config_dir ?? ""), config_dir_exists: reply.config_dir_exists !== false, files: files as Record<string, string> };
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
