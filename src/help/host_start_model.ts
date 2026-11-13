// No DOM: the state of the settings page's banner for a pending host start (`background/host_start.ts`). It reads the stored question and sends the user's answer with the digests it showed.

import type { HostFileChange, HostStartChoice, HostStartChoiceAnswer, HostStartPending } from "../shared/messages.ts";

export type HostStartState = {
  pending?: HostStartPending | undefined;
  busy: boolean;
  message?: { ok: boolean; text: string } | undefined;
  problems: string[];
};

export type HostStartDeps = { read_pending: () => Promise<unknown>; send: (message: HostStartChoice) => Promise<unknown>; on_change: () => void };

const CHANGE_KINDS: HostFileChange["kind"][] = ["replaced", "added", "removed"];

// Storage is shared with older and newer versions of the extension, so a record that does not fit shows no banner.
function checked_pending(stored: unknown): HostStartPending | undefined {
  if (typeof stored !== "object" || stored === null) return undefined;
  const { config_dir, host_digest, browser_digest, changes } = stored as Record<string, unknown>;
  if (typeof config_dir !== "string" || typeof host_digest !== "string" || typeof browser_digest !== "string" || !Array.isArray(changes)) return undefined;
  const fits = changes.every((change) => typeof change?.path === "string" && CHANGE_KINDS.includes(change?.kind));
  return fits ? { config_dir, host_digest, browser_digest, changes: changes as HostFileChange[] } : undefined;
}

const message_of = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function create_host_start_session(deps: HostStartDeps) {
  const state: HostStartState = { busy: false, problems: [] };
  const set = (change: Partial<HostStartState>) => {
    Object.assign(state, change);
    deps.on_change();
  };

  // The message of the last answer stays after the question goes, so the user sees what happened.
  async function load(): Promise<void> {
    set({ pending: checked_pending(await deps.read_pending().catch(() => undefined)) });
  }

  async function choose(choice: HostStartChoice["choice"]): Promise<void> {
    const { pending } = state;
    if (!pending || state.busy) return;
    set({ busy: true, message: undefined, problems: [] });
    const answer = (await deps
      .send({ type: "host_start_choice", choice, host_digest: pending.host_digest, browser_digest: pending.browser_digest })
      .catch((error: unknown) => ({ ok: false, message: message_of(error) }))) as HostStartChoiceAnswer;
    set({ busy: false, message: { ok: answer.ok, text: answer.message }, problems: !answer.ok && answer.problems ? answer.problems : [] });
    await load();
  }

  return { state, load, choose };
}

export type HostStartSession = ReturnType<typeof create_host_start_session>;
