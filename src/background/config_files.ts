// The answer to the files editor's messages: the stored files out, one save in.

import type { ConfigFilesAnswer, ConfigFilesRequest, SnippetPreview } from "../shared/messages.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { AUTOCONFIG_FILE } from "../shared/config_build/source_files.ts";
import { ConfigRefusal, KEPT_CURRENT } from "./config_reload.ts";

export type ConfigFilesDeps = {
  read_files: () => Promise<ConfigFiles>;
  save: (path: string, text: string | null, base: string | null, accepted?: string) => Promise<{ warnings: number } | { consent: SnippetPreview }>;
};

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function answer_config_files(request: ConfigFilesRequest, deps: ConfigFilesDeps): Promise<ConfigFilesAnswer> {
  try {
    if (request.op === "read") {
      // The host writes autoconfig.toml and the build never reads it, so the editor does not list it.
      return { ok: true, files: Object.fromEntries(Object.entries(await deps.read_files()).filter(([path]) => path !== AUTOCONFIG_FILE)) };
    }
    if (typeof request.path !== "string" || !(typeof request.base === "string" || request.base === null) || !(typeof request.text === "string" || request.text === null) || !(request.accepted === undefined || typeof request.accepted === "string")) {
      return { ok: false, message: "The save names no path and text." };
    }
    const saved = await deps.save(request.path, request.text, request.base, request.accepted);
    if ("consent" in saved) return { ok: false, message: "A snippet runs as code with every permission. Read it and accept it to save.", consent: saved.consent };
    const where = saved.warnings === 0 ? "" : `, with ${saved.warnings} warning(s) on the Help page`;
    return { ok: true, message: request.text === null ? `Deleted ${request.path}${where}.` : `Saved ${request.path}${where}.` };
  } catch (error) {
    if (!(error instanceof ConfigRefusal)) return { ok: false, message: message_of(error) };
    // The page lists the problems itself, so the message names only their count.
    if (error.problems.length > 0) return { ok: false, message: `${KEPT_CURRENT.edit} Fix the files and save again. ${error.problems.length} problem(s):`, problems: error.problems };
    return { ok: false, message: error.message };
  }
}
