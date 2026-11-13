// Keeps the native hosts as new as the extension. A host older than the extension is replaced with the GitHub release of the extension's
// own version, by the config host's `self_update` verb. The extension sends its version and the hashes its signed build carries,
// never a URL. Consent is asked once (`host_auto_update`), then each update is automatic with a toast.

import { RuntimeRefusal } from "../shared/command.ts";
import { host_standing } from "../shared/host_version.ts";
import type { HostStanding } from "../shared/host_version.ts";
import { best_effort } from "../shared/swallow.ts";
import type { HostWatch, SelfUpdateReply, SelfUpdateRequest } from "./native_client.ts";

// One automatic attempt per version per day, so a host that cannot update is not asked again on every reload.
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export type HostHashes = { version: string; sha256: Record<string, string> };

// What survives a background restart, so the one-toast and one-attempt rules hold across restarts.
export type HostUpdateState = {
  attempted?: { version: string; at_ms: number };
  // The extension version whose failure already showed its toast.
  failure_toasted?: string;
  // The extension version a checksum mismatch refused. Only a new extension build, which carries other hashes, lifts it.
  blocked?: string;
  // The extension version whose "update available" line was shown while consent was off.
  noticed?: string;
};

export type HostUpdateDeps = {
  extension_version: string;
  // An unpacked or temporary add-on follows main and has no release to match.
  is_development: () => Promise<boolean>;
  // The hashes in the signed build, or undefined when the build has none.
  read_hashes: () => Promise<HostHashes | undefined>;
  auto_update_consented: () => Promise<boolean>;
  update: (request: SelfUpdateRequest) => Promise<SelfUpdateReply>;
  load_state: () => Promise<HostUpdateState>;
  save_state: (state: HostUpdateState) => Promise<void>;
  now_ms: () => number;
  toast: (message: string, kind: "info" | "success" | "error") => Promise<void>;
  warn: (text: string) => void;
};

export type ManualOutcome = { updated: boolean; version: string };

export const MANUAL_HINT = "Run the command from :native.install.";

// The host words a hash refusal "checksum mismatch ...". Retrying the same version cannot help.
const is_checksum_refusal = (reason: string): boolean => /checksum mismatch/i.test(reason);

export function create_host_update(deps: HostUpdateDeps) {
  type Phase = { kind: "idle" } | { kind: "updating" } | { kind: "failed"; reason: string };
  let phase: Phase = { kind: "idle" };
  let config_standing: HostStanding = "current";
  let running: Promise<unknown> | undefined;
  const listeners: (() => void)[] = [];

  const reason_of = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  // Sends the update. The host verifies everything again, so a refusal here is data, not a bug.
  async function send(hashes: HostHashes): Promise<SelfUpdateReply> {
    phase = { kind: "updating" };
    try {
      const reply = await deps.update({ version: hashes.version, sha256: hashes.sha256 });
      phase = { kind: "idle" };
      return reply;
    } catch (error) {
      phase = { kind: "failed", reason: reason_of(error) };
      throw error;
    }
  }

  // Any ok reply means the files on disk are current. The running bridge still has the old code in memory, so it reconnects.
  function updated(): void {
    config_standing = "current";
    for (const listener of listeners) listener();
  }

  async function attempt(hashes: HostHashes, state: HostUpdateState): Promise<void> {
    // Stored before the call, so a crash or a reply that never comes still counts as this day's attempt.
    state = { ...state, attempted: { version: hashes.version, at_ms: deps.now_ms() } };
    await deps.save_state(state);
    let reply: SelfUpdateReply;
    try {
      reply = await send(hashes);
      updated();
    } catch (error) {
      const reason = reason_of(error);
      deps.warn(`desertfox: the native host update to ${hashes.version} failed: ${reason}`);
      const next: HostUpdateState = { ...state };
      if (is_checksum_refusal(reason)) next.blocked = hashes.version;
      await deps.save_state(next);
      if (state.failure_toasted !== hashes.version) {
        await deps.toast(`Host update failed: ${reason}. ${MANUAL_HINT}`, "error");
        // After the toast, so one that found no tab or notification shows again on the next failure.
        await deps.save_state({ ...next, failure_toasted: hashes.version });
      }
      return;
    }
    // Outside the try, so a toast that fails is not reported as a failed update.
    if (reply.updated) await deps.toast(`Native host updated to ${reply.version}`, "success");
  }

  async function check(): Promise<void> {
    if (await deps.is_development()) return;
    const hashes = await deps.read_hashes();
    if (!hashes || hashes.version !== deps.extension_version) return;
    const state = await deps.load_state();
    if (!(await deps.auto_update_consented())) {
      if (state.noticed === hashes.version) return;
      await deps.toast("The native host is older than this extension. Run :native.update to update it.", "info");
      await deps.save_state({ ...state, noticed: hashes.version });
      return;
    }
    if (state.blocked === hashes.version) return;
    const last = state.attempted;
    // A negative age means the clock moved back, which counts as an expired interval.
    const age_ms = last ? deps.now_ms() - last.at_ms : 0;
    if (last?.version === hashes.version && age_ms >= 0 && age_ms < RETRY_AFTER_MS) return;
    await attempt(hashes, state);
  }

  // `watch.seen` is called for every reply, so it must return at once: the check runs on its own.
  function seen_from(release_version: unknown, source: "config" | "bridge"): void {
    const standing = host_standing(release_version, deps.extension_version);
    if (source === "config") config_standing = standing;
    if (standing !== "outdated" || running) return;
    running = check()
      .catch((error: unknown) => deps.warn(`desertfox: the native host update check failed: ${reason_of(error)}`))
      .finally(() => {
        running = undefined;
      });
  }

  const watch: HostWatch = {
    seen: (release_version) => seen_from(release_version, "config"),
    outdated_note: () => {
      if (config_standing !== "outdated") return undefined;
      if (phase.kind === "updating") return "updating";
      if (phase.kind === "failed") return `update failed: ${phase.reason}`;
      return "run :native.update to update it";
    },
  };

  return {
    watch,
    // The bridge's ready frame. Same rules as the config host's reply.
    bridge_ready: (release_version: unknown) => seen_from(release_version, "bridge"),
    // Called after an ok update, so the bridge can start the new file.
    on_updated: (listener: () => void) => void listeners.push(listener),
    // `:native.update`. Skips consent, the daily limit and a checksum block, because the user asked. Throws with the reason on failure.
    update_now: (): Promise<ManualOutcome> => {
      if (running || phase.kind === "updating") return Promise.reject(new RuntimeRefusal("An update is already running."));
      // Set before the first await, so an automatic check that starts meanwhile sees it and sends no second self_update.
      const work = manual_update();
      running = best_effort(work).finally(() => {
        running = undefined;
      });
      return work;
    },
  };

  async function manual_update(): Promise<ManualOutcome> {
    if (await deps.is_development()) throw new RuntimeRefusal("This is a development install of DesertFox, which never updates its host. Run :native.install instead.");
    const hashes = await deps.read_hashes();
    if (!hashes || hashes.version !== deps.extension_version) throw new RuntimeRefusal(`This build carries no host hashes, so it cannot update the host. ${MANUAL_HINT}`);
    const state = await deps.load_state();
    let reply: SelfUpdateReply;
    try {
      reply = await send(hashes);
    } catch (error) {
      deps.warn(`desertfox: the native host update to ${hashes.version} failed: ${reason_of(error)}`);
      throw error;
    }
    const { blocked: _lifted, ...rest } = state;
    await deps.save_state(rest);
    updated();
    return { updated: reply.updated, version: reply.version };
  }
}
