// The external editor jobs. The page sends the text of a field, the host opens the user's editor on it, and this module collects the result and hands it back to the frame that asked.
// The jobs live in `storage.session` and the collect loops are derived from them, so a restarted background resumes the loops with `resume`.
// A job whose page is gone (the tab closed, reloaded or navigated) is orphaned, not dropped: its loop keeps collecting, so the user's saved text still lands in the unnamed register.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import type { EditorAnswer, EditorDone, EditorOpen } from "../shared/messages.ts";
import { site_columns_for, site_value } from "./page_keymap.ts";
import type { EditorCollectReply, EditorStartRequest } from "./native_client.ts";
import { create_write_queue } from "./store_turns.ts";
import { EDITOR_JOBS_STORAGE_KEY } from "./storage_keys.ts";

export type EditorJob = { job: string; tab_id: number; token: string; frame_id: number; is_private: boolean; orphaned?: true };
// Keyed by the host's job id.
type Jobs = Record<string, EditorJob>;

export type ExternalEditorDeps = {
  session: Pick<typeof browser.storage.session, "get" | "set">;
  client: { editor_start: (request: EditorStartRequest) => Promise<string>; editor_collect: (job: string) => Promise<EditorCollectReply> };
  // Resolves `true` only when the page took the result: a page that is gone, or another page in the frame, does not.
  send_done: (tab_id: number, frame_id: number, message: EditorDone) => Promise<unknown>;
  // Writes the unnamed register of the tab's window kind.
  save_text: (text: string, is_private: boolean) => Promise<unknown>;
  toast: (tab_id: number, frame_id: number, message: string) => Promise<unknown>;
  tab_exists: (tab_id: number) => Promise<boolean>;
  // Private text outlives its session if it is saved after the last private window closed, so it is dropped then.
  private_window_open: () => Promise<boolean>;
  now: () => number;
  pause: (ms: number) => Promise<void>;
};

// A host long-polls about 20 s. A pending answer sooner than this means it did not wait, so the loop waits instead of spinning.
const MIN_POLL_MS = 1000;

// Failed collects in a row before the loop gives up. The editor may still be open, and one failed host call (a host update in flight) is no reason to lose its text.
const MAX_COLLECT_FAILURES = 3;
const SCRATCH_DIR = "~/.cache/desertfox/editor";
// The host's refusal for a job it does not hold. Retrying cannot help.
const UNKNOWN_JOB = /unknown editor job/;

const failure_text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function create_external_editor(deps: ExternalEditorDeps) {
  const in_turn = create_write_queue();
  // The loops of this background's life. A loop outlives a turn, so the set stops `resume` from starting a second one.
  const collecting = new Set<string>();

  const read_jobs = async (): Promise<Jobs> => ((await deps.session.get(EDITOR_JOBS_STORAGE_KEY))[EDITOR_JOBS_STORAGE_KEY] as Jobs | undefined) ?? {};
  const write_jobs = (jobs: Jobs) => deps.session.set({ [EDITOR_JOBS_STORAGE_KEY]: jobs });

  // Drops the job and returns it as it was stored, so a loop sees an orphaning that came while it waited.
  const clear = (job: string): Promise<EditorJob | undefined> =>
    in_turn(async () => {
      const jobs = await read_jobs();
      const held = jobs[job];
      if (!held) return undefined;
      delete jobs[job];
      await write_jobs(jobs);
      return held;
    });

  const live_job_of = (jobs: Jobs, tab_id: number): EditorJob | undefined => Object.values(jobs).find((held) => held.tab_id === tab_id && !held.orphaned);

  // The result reaches the page, or else the register. Either way the user's saved text survives.
  async function deliver(held: EditorJob, text: string | undefined): Promise<void> {
    const done: EditorDone = { type: "editor_done", token: held.token, ...(text === undefined ? {} : { text }) };
    const delivered = !held.orphaned && (await deps.send_done(held.tab_id, held.frame_id, done).catch(() => undefined)) === true;
    if (delivered || text === undefined) return;
    const toast = (message: string) => deps.toast(held.tab_id, held.frame_id, message).catch(() => undefined);
    if (held.is_private && !(await deps.private_window_open())) return void (await toast("The private window was gone when the editor ended, so the edited text was dropped"));
    try {
      await deps.save_text(text, held.is_private);
    } catch (error) {
      return void (await toast(`The page was gone when the editor ended, and the edited text (${text.length} characters) could not be saved: ${failure_text(error)}`));
    }
    await toast('The page was gone when the editor ended. The edited text is in the unnamed register: paste it with <C-r>"');
  }

  async function collect_loop(held: EditorJob): Promise<void> {
    if (collecting.has(held.job)) return;
    collecting.add(held.job);
    try {
      let failures = 0;
      for (;;) {
        let reply: EditorCollectReply;
        const asked_at = deps.now();
        try {
          reply = await deps.client.editor_collect(held.job);
          failures = 0;
        } catch (error) {
          const unknown_job = UNKNOWN_JOB.test(failure_text(error));
          if (!unknown_job && ++failures < MAX_COLLECT_FAILURES) {
            await deps.pause(MIN_POLL_MS);
            continue;
          }
          const current = await clear(held.job);
          const where = unknown_job ? "" : ` The saved text stays in ${SCRATCH_DIR}.`;
          if (current && !current.orphaned) await deps.toast(current.tab_id, current.frame_id, failure_text(error) + where).catch(() => undefined);
          return;
        }
        if ("pending" in reply) {
          const waited = deps.now() - asked_at;
          if (waited < MIN_POLL_MS) await deps.pause(MIN_POLL_MS - waited);
          continue;
        }
        const current = await clear(held.job);
        if (current) await deliver(current, reply.changed ? reply.text : undefined);
        return;
      }
    } finally {
      collecting.delete(held.job);
    }
  }

  // The tab closed or loaded another page. The editor stays open for the user and its loop goes on, but the result goes to the register, not into the new page.
  const orphan = (tab_id: number): Promise<void> =>
    in_turn(async () => {
      const jobs = await read_jobs();
      const mine = Object.values(jobs).filter((held) => held.tab_id === tab_id && !held.orphaned);
      for (const held of mine) held.orphaned = true;
      if (mine.length > 0) await write_jobs(jobs);
    });

  return {
    // One live job per tab, and two presses in a row queue behind each other, so the second sees the first's job.
    open: (tab_id: number, frame_id: number, request: EditorOpen, ext: string | undefined, is_private: boolean): Promise<EditorAnswer> =>
      in_turn(async (): Promise<EditorAnswer> => {
        const jobs = await read_jobs();
        if (live_job_of(jobs, tab_id)) return { ok: false, message: "An editor is already open for this tab" };
        let job: string;
        try {
          job = await deps.client.editor_start({ text: request.text, ...(ext === undefined ? {} : { ext }), ...(request.insert ? { insert: true } : {}) });
        } catch (error) {
          return { ok: false, message: failure_text(error) };
        }
        const held: EditorJob = { job, tab_id, token: request.token, frame_id, is_private };
        await write_jobs({ ...jobs, [job]: held });
        void collect_loop(held);
        return { ok: true };
      }),
    orphan,
    // At every start of the background: every job collects again, and the job of a tab that is gone is orphaned first.
    resume: async (): Promise<void> => {
      for (const held of Object.values(await in_turn(read_jobs))) {
        if (!held.orphaned && !(await deps.tab_exists(held.tab_id))) await orphan(held.tab_id);
        void collect_loop(held);
      }
    },
  };
}

export type ExternalEditor = ReturnType<typeof create_external_editor>;

// The extension for a page: the setting's value for the sender's site (a site row beats the global value), else the global one. The empty text is the default and means no extension.
export function make_editor_ext_for(local: Pick<typeof browser.storage.local, "get">, global_ext: () => Promise<string | undefined>) {
  return async (addresses: readonly (string | undefined)[]): Promise<string | undefined> => {
    const stored = await local.get(COMPILED_KEYMAP_STORAGE_KEY);
    const keymap = current_keymap(stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined);
    return site_value(site_columns_for(keymap, addresses), "editor_ext", (await global_ext()) ?? "") || undefined;
  };
}
