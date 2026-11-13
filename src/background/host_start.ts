// What a start does with the config folder the native host reads, when the browser holds its own copy of the files.
// A folder that differs replaces the browser copy on its own only while the copy holds no browser change: an import, an editor save or a snippet change makes the start store a pending record, and the user chooses on the settings page.

import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { AUTOCONFIG_FILE } from "../shared/config_build/source_files.ts";
import type { HostFileChange, HostStartChoice, HostStartChoiceAnswer, HostStartPending } from "../shared/messages.ts";
import { ConfigRefusal } from "./config_reload.ts";
import type { ConfigFilesReply } from "./native_client.ts";
import { HOST_START_APPLIED_STORAGE_KEY, HOST_START_KEPT_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY } from "./storage_keys.ts";

// The host writes autoconfig.toml itself, from the saved settings, and the build never reads it. Left in, it would make every saved `:set` a difference, and a folder holding only it would count as filled.
export function compared_files(files: ConfigFiles): ConfigFiles {
  const { [AUTOCONFIG_FILE]: _mirror, ...config_files } = files;
  return config_files;
}

export const has_config_files = (files: ConfigFiles): boolean => Object.keys(compared_files(files)).length > 0;

function same_files(left: ConfigFiles, right: ConfigFiles): boolean {
  const names = Object.keys(left);
  return names.length === Object.keys(right).length && names.every((name) => Object.hasOwn(right, name) && left[name] === right[name]);
}

// Sorted, so the same files give the same digest whatever order the host or storage lists them in.
export async function files_digest(files: ConfigFiles): Promise<string> {
  const canonical = JSON.stringify(Object.entries(compared_files(files)).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function file_changes(host: ConfigFiles, browser_files: ConfigFiles): HostFileChange[] {
  const paths = [...new Set([...Object.keys(host), ...Object.keys(browser_files)])].sort();
  return paths.flatMap((path): HostFileChange[] => {
    if (!Object.hasOwn(browser_files, path)) return [{ path, kind: "added" }];
    if (!Object.hasOwn(host, path)) return [{ path, kind: "removed" }];
    return host[path] === browser_files[path] ? [] : [{ path, kind: "replaced" }];
  });
}

export type HostStartPlan =
  | { kind: "ignore"; reason: "missing" | "empty" | "same" | "kept" }
  | { kind: "adopt" }
  | { kind: "ask"; pending: HostStartPending };

// `applied` is the digest of the folder files the browser copy last took from the host. `kept` is the folder digest the user chose to keep the browser copy over.
export type HostMemory = { applied?: string | undefined; kept?: string | undefined };

// `adopt` when replacing the browser copy loses nothing: it is empty, or it is still the folder's files from an earlier read. A profile with no `applied` digest asks, since nothing proves its copy unedited.
// `kept` stops the same folder content from asking again.
export async function classify_host_start(reply: ConfigFilesReply, browser_files: ConfigFiles, memory: HostMemory): Promise<HostStartPlan> {
  if (!reply.config_dir_exists) return { kind: "ignore", reason: "missing" };
  const host = compared_files(reply.files);
  const stored = compared_files(browser_files);
  if (Object.keys(host).length === 0) return { kind: "ignore", reason: "empty" };
  if (Object.keys(stored).length === 0) return { kind: "adopt" };
  if (same_files(host, stored)) return { kind: "ignore", reason: "same" };
  const browser_digest = await files_digest(stored);
  if (browser_digest === memory.applied) return { kind: "adopt" };
  const host_digest = await files_digest(host);
  if (host_digest === memory.kept) return { kind: "ignore", reason: "kept" };
  return { kind: "ask", pending: { config_dir: reply.config_dir, host_digest, browser_digest, changes: file_changes(host, stored) } };
}

export async function store_host_pending(pending: HostStartPending): Promise<void> {
  await browser.storage.local.set({ [HOST_START_PENDING_STORAGE_KEY]: pending });
}

// Any swap of the stored files calls this: the list of changes was made against the files it replaced.
export async function clear_host_pending(): Promise<void> {
  await browser.storage.local.remove(HOST_START_PENDING_STORAGE_KEY);
}

export async function read_host_memory(): Promise<HostMemory> {
  const stored = await browser.storage.local.get([HOST_START_APPLIED_STORAGE_KEY, HOST_START_KEPT_STORAGE_KEY]);
  const digest_at = (key: string) => (typeof stored[key] === "string" ? (stored[key] as string) : undefined);
  return { applied: digest_at(HOST_START_APPLIED_STORAGE_KEY), kept: digest_at(HOST_START_KEPT_STORAGE_KEY) };
}

// After every swap that took the folder's files, and after a start that found the copy equal to the folder, which seeds a profile from before the digest existed.
export async function remember_applied(files: ConfigFiles): Promise<void> {
  const digest = await files_digest(files);
  if ((await read_host_memory()).applied !== digest) await browser.storage.local.set({ [HOST_START_APPLIED_STORAGE_KEY]: digest });
}

export type HostChoiceDeps = {
  read_host: () => Promise<ConfigFilesReply>;
  read_browser_files: () => Promise<ConfigFiles>;
  // Swaps the browser copy for the folder's files, edit layers on top. Throws a ConfigRefusal when they do not build.
  apply_folder: (files: ConfigFiles, config_dir: string) => Promise<{ warnings: number }>;
};

export const CHOICE_SETTLED = "Nothing changed: the config folder and the browser copy no longer differ, or another page already chose.";
export const CHOICE_STALE = "Nothing changed: the config folder or the browser copy changed since the list was shown. Review the new list and choose again.";

// Runs in the change queue. It reads the folder again rather than trusting the start's reply, and acts only when the browser copy is still the one the user saw.
// Use the folder drops only the browser copy, so a folder changed since (the user unpacked the export into it) does not refuse. Keep remembers the folder, so it needs the folder the user saw.
// The first answer wins: after it, a second page finds nothing to choose.
export async function settle_host_start(choice: HostStartChoice["choice"], seen: { host_digest: string; browser_digest: string }, deps: HostChoiceDeps): Promise<{ warnings: number }> {
  const reply = await deps.read_host();
  const plan = await classify_host_start(reply, await deps.read_browser_files(), await read_host_memory());
  if (plan.kind !== "ask") {
    await clear_host_pending();
    throw new ConfigRefusal(CHOICE_SETTLED);
  }
  const folder_moved = choice === "keep_browser" && plan.pending.host_digest !== seen.host_digest;
  if (folder_moved || plan.pending.browser_digest !== seen.browser_digest) {
    await store_host_pending(plan.pending);
    throw new ConfigRefusal(CHOICE_STALE);
  }
  if (choice === "keep_browser") {
    await browser.storage.local.set({ [HOST_START_KEPT_STORAGE_KEY]: plan.pending.host_digest });
    await clear_host_pending();
    return { warnings: 0 };
  }
  // A refused build throws before the swap, so the browser copy and the pending record stay.
  const applied = await deps.apply_folder(reply.files, reply.config_dir);
  await browser.storage.local.remove(HOST_START_KEPT_STORAGE_KEY);
  return applied;
}

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function answer_host_start_choice(request: HostStartChoice, choose: (choice: HostStartChoice["choice"], seen: { host_digest: string; browser_digest: string }) => Promise<{ warnings: number }>): Promise<HostStartChoiceAnswer> {
  if ((request.choice !== "use_folder" && request.choice !== "keep_browser") || typeof request.host_digest !== "string" || typeof request.browser_digest !== "string") {
    return { ok: false, message: "The choice names no known option and digests." };
  }
  try {
    const { warnings } = await choose(request.choice, { host_digest: request.host_digest, browser_digest: request.browser_digest });
    if (request.choice === "keep_browser") return { ok: true, message: "Kept the browser copy. You are asked again when the config folder changes." };
    return { ok: true, message: `Loaded the config folder${warnings === 0 ? "" : `, with ${warnings} warning(s) on the Help page`}. Your saved edits stay on top.` };
  } catch (error) {
    if (error instanceof ConfigRefusal && error.problems.length > 0) return { ok: false, message: `The config folder does not build, so the browser copy stays. ${error.problems.length} problem(s):`, problems: error.problems };
    return { ok: false, message: message_of(error) };
  }
}
