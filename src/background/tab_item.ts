// The item mode of a tab. Modes are per frame, but the mode belongs to the tab: the frame that takes `I` is rarely the frame that holds the list, and a key must act the same wherever the focus is. The background remembers which frames are in it and ends them together.
// It lives in `storage.session`, so a restarted background still knows and a browser restart clears it. It reuses the media step message, which the frames already take.

import type { Mode } from "../shared/command.ts";
import { ITEM_RESUME_STORAGE_PREFIX, TAB_ITEM_STORAGE_PREFIX } from "./storage_keys.ts";
import { best_effort, keep_chain } from "../shared/swallow.ts";
import { create_step_queue } from "./tab_steps.ts";
import type { ItemStart } from "./page_keymap.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

// `rejoined` are frames of the hold whose new document has not reported item mode yet: the report that a load makes first says normal. A frame goes in when its new document commits or when a join reply puts it back in the mode, whichever comes first.
export type ItemHold = { frames: number[]; rejoined?: number[] };

export type TabItemDeps = {
  storage: SessionStorage;
  // The `MediaStep` message with `item` set, to one frame or, with no frame, to every frame of the tab that runs the content script. `from` names the reporter that the step skips.
  send_step: (tab_id: number, on: boolean, frame_id?: number, from?: number) => Promise<unknown>;
  now?: () => number;
};

const key_of = (tab_id: number): string => TAB_ITEM_STORAGE_PREFIX + tab_id;
const resume_key_of = (tab_id: number): string => ITEM_RESUME_STORAGE_PREFIX + tab_id;

// A load of the tab that began in item mode. `kept` says its top frame committed as a link or a form submit, so the new page starts item mode again when it completes.
type ResumeMark = { at: number; kept?: true };

// A load that begins in the mode commits well within this time. A commit later than that belongs to another load, after one that never committed (a download, a 204, a cancelled load).
export const RESUME_COMMIT_LIMIT_MS = 30_000;

// The transitions that carry item mode to the new page: a link the user followed in the page, by a key or the site's own code, and a form. Back and forward arrive as links (measured), and an address typed in the bar can, so their qualifiers rule them out.
const RESUMING_TRANSITIONS: readonly string[] = ["link", "form_submit"];
const ENDING_QUALIFIERS: readonly string[] = ["forward_back", "from_address_bar"];
export type TopCommit = { transitionType?: string | undefined; transitionQualifiers?: readonly string[] | undefined };
const carries_the_mode = ({ transitionType, transitionQualifiers }: TopCommit): boolean =>
  transitionType !== undefined && RESUMING_TRANSITIONS.includes(transitionType) && !(transitionQualifiers ?? []).some((qualifier) => ENDING_QUALIFIERS.includes(qualifier));

// A hint or the command line opened from the mode returns to it, so a frame that reports one of these has not left.
const KEEPS_THE_MODE: readonly Mode[] = ["item", "hint", "cmdline"];

export function create_tab_item(deps: TabItemDeps) {
  const now = deps.now ?? Date.now;
  // One read-then-write at a time, so two reports together do not drop each other's change.
  let chain: Promise<unknown> = Promise.resolve();
  const in_turn = <T>(step: () => Promise<T>): Promise<T> => {
    const run = chain.then(step);
    chain = keep_chain(run);
    return run;
  };
  const read = async (tab_id: number): Promise<ItemHold | undefined> => (await deps.storage.get(key_of(tab_id)))[key_of(tab_id)] as ItemHold | undefined;
  const read_resume = async (tab_id: number): Promise<ResumeMark | undefined> => (await deps.storage.get(resume_key_of(tab_id)))[resume_key_of(tab_id)] as ResumeMark | undefined;
  const judge_resume = async (tab_id: number, top_commit: TopCommit): Promise<void> => {
    const mark = await read_resume(tab_id);
    if (!mark) return;
    if (carries_the_mode(top_commit) && now() - mark.at <= RESUME_COMMIT_LIMIT_MS) await deps.storage.set({ [resume_key_of(tab_id)]: { at: mark.at, kept: true } satisfies ResumeMark });
    else await deps.storage.remove(resume_key_of(tab_id));
  };
  // The steps of a tab go out one at a time, in order (`tab_steps.ts`), in a queue kept apart from the media mode's.
  const { step, drop_steps_to, clear: clear_steps } = create_step_queue(deps.send_step);
  // The old page of a load gets its steps off straight away, outside the tab's steps: a frame of it that never answers must not hold up the new page.
  const step_old_page = (tab_id: number, on: boolean, frame_id?: number): void => void best_effort(deps.send_step(tab_id, on, frame_id));
  // Every frame of the hold leaves the mode, the one that ended it excepted: it left already, and may sit in a field.
  const end = async (tab_id: number, hold: ItemHold, except?: number, send = step) => {
    await deps.storage.remove(key_of(tab_id));
    for (const frame_id of hold.frames) if (frame_id !== except) send(tab_id, false, frame_id);
  };

  return {
    // The mode a frame reports. Any frame can start the hold, and the first report starts the mode in every other frame in normal mode, which then report and join. A frame of the hold that reports a mode that is not item ends it for every frame.
    // `by_step` says that a step or a join reply put the frame in the mode, so its report never starts a hold. It joins any live hold, even one newer than its step, because the tab and the frame are both in the mode.
    reported: (tab_id: number, frame_id: number, mode: Mode, by_step = false): Promise<void> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (mode === "item") {
          if (hold?.frames.includes(frame_id)) {
            if (hold.rejoined?.includes(frame_id)) await deps.storage.set({ [key_of(tab_id)]: { ...hold, rejoined: hold.rejoined.filter((other) => other !== frame_id) } });
            return;
          }
          // The step came from a hold that ended before the frame took it. Starting a hold here would step every other frame back into the mode.
          if (by_step && !hold) return step(tab_id, false, frame_id);
          drop_steps_to(tab_id, frame_id);
          await deps.storage.set({ [key_of(tab_id)]: { ...hold, frames: [...(hold?.frames ?? []), frame_id] } });
          // No list of frames reaches the background, so the step goes to every frame and names the reporter, which skips it.
          if (!hold) step(tab_id, true, undefined, frame_id);
          return;
        }
        if (!hold?.frames.includes(frame_id) || KEEPS_THE_MODE.includes(mode)) return;
        if (mode === "normal" && hold.rejoined?.includes(frame_id)) return;
        await end(tab_id, hold, frame_id);
      }),
    // A frame that starts while the hold is on joins it: the reply to its first keymap read carries the mode. The frame goes into the hold in the same turn as the read, so an end after the read sends it the step off.
    join: (tab_id: number, frame_id: number): Promise<boolean> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (!hold) return false;
        const reloaded = hold.frames.includes(frame_id);
        await deps.storage.set({ [key_of(tab_id)]: { frames: reloaded ? hold.frames : [...hold.frames, frame_id], rejoined: [...new Set([...(hold.rejoined ?? []), frame_id])] } satisfies ItemHold });
        return true;
      }),
    // A child frame of the hold that reloads or navigates keeps the tab in the mode. The commit comes before the new document's first report, which says normal before the keymap read rejoins it. The top frame's load ends the hold instead (`navigated`), and its commit decides whether the new page takes the mode back.
    committed: (tab_id: number, frame_id: number, top_commit: TopCommit = {}): Promise<void> =>
      in_turn(async () => {
        if (frame_id === 0) return judge_resume(tab_id, top_commit);
        const hold = await read(tab_id);
        if (!hold?.frames.includes(frame_id) || hold.rejoined?.includes(frame_id)) return;
        await deps.storage.set({ [key_of(tab_id)]: { ...hold, rejoined: [...(hold.rejoined ?? []), frame_id] } satisfies ItemHold });
      }),
    // A load ends the hold in every frame. Firefox sends `status: "loading"` with no `url` when a load starts (docs/firefox-behavior.md). An address change the page makes itself keeps it.
    // The hold leaves a resume mark, which the top frame's commit keeps or drops (`committed`). A load with no hold leaves an older mark alone: its commit judges that mark, and the age limit drops it.
    navigated: (tab_id: number, change: { status?: string | undefined; url?: string | undefined }): Promise<void> =>
      in_turn(async () => {
        if (change.status !== "loading" || change.url !== undefined) return;
        // The frames of the old page are gone, so the steps still waiting for them are dropped.
        clear_steps(tab_id);
        const hold = await read(tab_id);
        if (!hold) return;
        await deps.storage.set({ [resume_key_of(tab_id)]: { at: now() } satisfies ResumeMark });
        await end(tab_id, hold, undefined, step_old_page);
      }),
    // Called when the tab's load completes: whether the new page starts item mode again. The mark goes either way, so a page with no list, or a load that never committed, carries nothing to the next one.
    take_resume: (tab_id: number): Promise<boolean> =>
      in_turn(async () => {
        const mark = await read_resume(tab_id);
        if (!mark) return false;
        await deps.storage.remove(resume_key_of(tab_id));
        return mark.kept === true;
      }),
    forget: (tab_id: number): Promise<void> =>
      in_turn(async () => {
        clear_steps(tab_id);
        await deps.storage.remove(key_of(tab_id));
        await deps.storage.remove(resume_key_of(tab_id));
      }),
  };
}

export type TabItem = ReturnType<typeof create_tab_item>;

export type ItemStartAsk = {
  // The start for a page at this address, undefined where none is wanted (`item_start_for`).
  start_for: (address: string | undefined) => Promise<ItemStart | undefined>;
  // The tab's top document now, from `webNavigation.getFrame`.
  top_document: (tab_id: number) => Promise<{ url?: string | undefined; documentId?: string | undefined } | undefined>;
  // Sends the start to that document only. Firefox refuses the send once another document has replaced it (docs/firefox-behavior.md).
  send_start: (tab_id: number, document_id: string, start: ItemStart) => Promise<unknown>;
};

// Asks the top frame of a tab whose load completed at `address` to start item mode. The read takes a while, so the ask is tied to the document that completed: a tab that loads again meanwhile, even at the same address, holds another document, which must not take this page's start.
export async function ask_item_start(deps: ItemStartAsk, tab_id: number, address: string | undefined): Promise<void> {
  const completed = await deps.top_document(tab_id);
  const document_id = completed?.documentId;
  if (address === undefined || completed?.url !== address || document_id === undefined) return;
  const start = await deps.start_for(address);
  if (start) await deps.send_start(tab_id, document_id, start);
}
