// The external editor job of a tab. The page sends the text of a field, the host opens the user's editor on it, and this module collects the result and hands it back to the frame that asked.
// The job lives in `storage.session` and the collect loop is derived from it, so a restarted background resumes the loop with `resume`.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import type { EditorAnswer, EditorDone, EditorOpen } from "../shared/messages.ts";
import { site_columns_for, site_value } from "./page_keymap.ts";
import type { EditorCollectReply, EditorStartRequest } from "./native_client.ts";
import { create_write_queue } from "./store_turns.ts";
import { EDITOR_JOBS_STORAGE_KEY } from "./storage_keys.ts";

export type EditorJob = { job: string; token: string; frame_id: number };
type Jobs = Record<string, EditorJob>;

export type ExternalEditorDeps = {
  session: Pick<typeof browser.storage.session, "get" | "set">;
  client: { editor_start: (request: EditorStartRequest) => Promise<string>; editor_collect: (job: string) => Promise<EditorCollectReply> };
  send_done: (tab_id: number, frame_id: number, message: EditorDone) => Promise<unknown>;
  toast: (tab_id: number, frame_id: number, message: string) => Promise<unknown>;
  tab_exists: (tab_id: number) => Promise<boolean>;
  now: () => number;
  pause: (ms: number) => Promise<void>;
};

// A host long-polls about 20 s. A pending answer sooner than this means it did not wait, so the loop waits instead of spinning.
const MIN_POLL_MS = 1000;

const failure_text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function create_external_editor(deps: ExternalEditorDeps) {
  const in_turn = create_write_queue();
  // The loops of this background's life. A loop outlives a turn, so the set stops `resume` from starting a second one.
  const collecting = new Set<string>();

  const read_jobs = async (): Promise<Jobs> => ((await deps.session.get(EDITOR_JOBS_STORAGE_KEY))[EDITOR_JOBS_STORAGE_KEY] as Jobs | undefined) ?? {};
  const write_jobs = (jobs: Jobs) => deps.session.set({ [EDITOR_JOBS_STORAGE_KEY]: jobs });

  // Drops the job of the tab, only while it is still the one named: a later job must survive an old loop's cleanup.
  const clear = (tab_id: number, job: string | undefined): Promise<boolean> =>
    in_turn(async () => {
      const jobs = await read_jobs();
      const held = jobs[tab_id];
      if (!held || (job !== undefined && held.job !== job)) return false;
      delete jobs[tab_id];
      await write_jobs(jobs);
      return true;
    });

  const is_current = async (tab_id: number, job: string): Promise<boolean> => (await in_turn(read_jobs))[tab_id]?.job === job;

  async function collect_loop(tab_id: number, held: EditorJob): Promise<void> {
    const key = `${tab_id}:${held.job}`;
    if (collecting.has(key)) return;
    collecting.add(key);
    try {
      for (;;) {
        if (!(await is_current(tab_id, held.job))) return;
        let reply: EditorCollectReply;
        const asked_at = deps.now();
        try {
          reply = await deps.client.editor_collect(held.job);
        } catch (error) {
          if (await clear(tab_id, held.job)) await deps.toast(tab_id, held.frame_id, failure_text(error)).catch(() => undefined);
          return;
        }
        if ("pending" in reply) {
          const waited = deps.now() - asked_at;
          if (waited < MIN_POLL_MS) await deps.pause(MIN_POLL_MS - waited);
          continue;
        }
        // A navigation or a closed tab dropped the job meanwhile: the result belongs to a page that is gone.
        if (!(await clear(tab_id, held.job))) return;
        await deps.send_done(tab_id, held.frame_id, { type: "editor_done", token: held.token, ...(reply.changed ? { text: reply.text } : {}) }).catch(() => undefined);
        return;
      }
    } finally {
      collecting.delete(key);
    }
  }

  return {
    // One job per tab, and two presses in a row queue behind each other, so the second sees the first's job.
    open: (tab_id: number, frame_id: number, request: EditorOpen, ext: string | undefined): Promise<EditorAnswer> =>
      in_turn(async (): Promise<EditorAnswer> => {
        const jobs = await read_jobs();
        if (jobs[tab_id]) return { ok: false, message: "An editor is already open for this tab" };
        let job: string;
        try {
          job = await deps.client.editor_start({ text: request.text, ...(ext === undefined ? {} : { ext }), ...(request.insert ? { insert: true } : {}) });
        } catch (error) {
          return { ok: false, message: failure_text(error) };
        }
        const held = { job, token: request.token, frame_id };
        await write_jobs({ ...jobs, [tab_id]: held });
        void collect_loop(tab_id, held);
        return { ok: true };
      }),
    // The tab closed or loaded another page. The editor stays open for the user, but nothing is written into the new page.
    forget: (tab_id: number): Promise<void> => clear(tab_id, undefined).then(() => undefined),
    // At every start of the background: jobs of tabs that are gone are dropped, the rest collect again.
    resume: async (): Promise<void> => {
      for (const [id, held] of Object.entries(await in_turn(read_jobs))) {
        const tab_id = Number(id);
        if (await deps.tab_exists(tab_id)) void collect_loop(tab_id, held);
        else await clear(tab_id, held.job);
      }
    },
  };
}

export type ExternalEditor = ReturnType<typeof create_external_editor>;

// The extension for a page: the setting's value for the sender's site (a site row beats the global value), else the global one, else none.
export function make_editor_ext_for(local: Pick<typeof browser.storage.local, "get">, global_ext: () => Promise<string | undefined>) {
  return async (addresses: readonly (string | undefined)[]): Promise<string | undefined> => {
    const stored = await local.get(COMPILED_KEYMAP_STORAGE_KEY);
    const keymap = current_keymap(stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined);
    return site_value(site_columns_for(keymap, addresses), "editor_ext", await global_ext());
  };
}
