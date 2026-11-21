// The item mode of a tab. Modes are per frame, but the mode belongs to the tab: the frame that takes `I` is rarely the frame that holds the list, and a key must act the same wherever the focus is. The background remembers which frames are in it and ends them together.
// It lives in `storage.session`, so a restarted background still knows and a browser restart clears it. It reuses the media step message, which the frames already take.

import type { Mode } from "../shared/command.ts";
import { ITEM_RESUME_STORAGE_PREFIX, TAB_ITEM_STORAGE_PREFIX } from "./storage_keys.ts";
import { best_effort, keep_chain } from "../shared/swallow.ts";
import { with_frame, without_stale_off, type HoldFrames, type SendStep, type StepQueue } from "./tab_steps.ts";
import type { ItemStart } from "./page_keymap.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

// `rejoined` are frames of the hold whose new document has not reported item mode yet: the report that a load makes first says normal. A frame goes in when its new document commits or when a join reply puts it back in the mode, whichever comes first.
export type ItemHold = HoldFrames & { rejoined?: number[] };

export type TabItemDeps = {
  storage: SessionStorage;
  // The `MediaStep` message with `item` set, to one frame or, with no frame, to every frame of the tab that runs the content script. `from` names the reporter that the step skips.
  send_step: SendStep;
  // The queue the media mode's steps go through too (`tab_steps.ts`).
  steps: StepQueue;
  now?: () => number;
};

const key_of = (tab_id: number): string => TAB_ITEM_STORAGE_PREFIX + tab_id;
const resume_key_of = (tab_id: number): string => ITEM_RESUME_STORAGE_PREFIX + tab_id;

// A load of the tab that began in item mode, from the page at `from`. `kept` says its top frame committed as a link or a form submit on the same host, so the new page starts item mode again when it completes.
type ResumeMark = { at: number; from?: string; kept?: true };

// A load that begins in the mode commits well within this time. A commit later than that belongs to another load, after one that never committed (a download, a 204, a cancelled load).
export const RESUME_COMMIT_LIMIT_MS = 30_000;

// The transitions that carry item mode to the new page: a link the user followed in the page, by a key or the site's own code, and a form. Back and forward arrive as links (measured), and an address typed in the bar can, so their qualifiers rule them out.
const RESUMING_TRANSITIONS: readonly string[] = ["link", "form_submit"];
const ENDING_QUALIFIERS: readonly string[] = ["forward_back", "from_address_bar"];
export type TopCommit = { transitionType?: string | undefined; transitionQualifiers?: readonly string[] | undefined; url?: string | undefined };
const carries_the_mode = ({ transitionType, transitionQualifiers }: TopCommit): boolean =>
  transitionType !== undefined && RESUMING_TRANSITIONS.includes(transitionType) && !(transitionQualifiers ?? []).some((qualifier) => ENDING_QUALIFIERS.includes(qualifier));

// The host with its port. No helper in the code knows the registrable domain (the public suffix list), so a subdomain counts as another site.
const host_of = (address: string | undefined): string | undefined => {
  try {
    return address === undefined ? undefined : new URL(address).host;
  } catch {
    return undefined;
  }
};
// A link to another site ends the mode: that site's lists are not the ones the user was walking.
const stays_on_site = (from: string | undefined, to: string | undefined): boolean => host_of(from) !== undefined && host_of(from) === host_of(to);

// A hint or the command line opened from the mode returns to it, so a frame that reports one of these has not left.
const KEEPS_THE_MODE: readonly Mode[] = ["item", "item_visual", "hint", "cmdline"];

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
    if (carries_the_mode(top_commit) && stays_on_site(mark.from, top_commit.url) && now() - mark.at <= RESUME_COMMIT_LIMIT_MS) await deps.storage.set({ [resume_key_of(tab_id)]: { ...mark, kept: true } satisfies ResumeMark });
    else await deps.storage.remove(resume_key_of(tab_id));
  };
  // The steps of a tab go out in order (`tab_steps.ts`).
  const { step, drop_steps_to, off_on_its_way, clear: clear_steps } = deps.steps.for_mode(deps.send_step);
  // The old page of a load gets its steps off straight away, outside the tab's steps: a frame of it that never answers must not hold up the new page.
  const step_old_page = (tab_id: number, on: boolean, frame_id?: number, from?: number, document_id?: string): void => void best_effort(deps.send_step(tab_id, on, frame_id, from, document_id));
  // Every frame of the hold leaves the mode, the one that ended it excepted: it left already, and may sit in a field.
  const end = async (tab_id: number, hold: ItemHold, except?: number, send = step) => {
    await deps.storage.remove(key_of(tab_id));
    for (const frame_id of hold.frames) if (frame_id !== except) send(tab_id, false, frame_id, undefined, hold.documents?.[frame_id]);
  };

  return {
    // The mode a frame reports. Any frame can start the hold, and the first report starts the mode in every other frame in normal mode, which then report and join. A frame of the hold that reports a mode that is not item ends it for every frame.
    // `by_step` says that a step or a join reply put the frame in the mode, so its report never starts a hold. It joins any live hold, even one newer than its step, because the tab and the frame are both in the mode. `document_id` is the reporting document.
    reported: (tab_id: number, frame_id: number, mode: Mode, by_step = false, document_id?: string): Promise<void> => {
      // The off may land while the report waits for its turn and its read. The report came first, so an off on its way now is stale too.
      const off_on_its_way_at_report = off_on_its_way(tab_id, frame_id, document_id);
      return in_turn(async () => {
        const hold = await read(tab_id);
        if (mode === "item") {
          if (hold?.frames.includes(frame_id)) {
            if (hold.rejoined?.includes(frame_id)) await deps.storage.set({ [key_of(tab_id)]: { ...hold, rejoined: hold.rejoined.filter((other) => other !== frame_id) } });
            return;
          }
          // The step came from a hold that ended before the frame took it. Starting a hold here would step every other frame back into the mode.
          if (by_step && !hold) return step(tab_id, false, frame_id, undefined, document_id);
          const stale_off = !by_step && (off_on_its_way_at_report || off_on_its_way(tab_id, frame_id, document_id));
          drop_steps_to(tab_id, frame_id);
          await deps.storage.set({ [key_of(tab_id)]: with_frame<ItemHold>(hold ?? { frames: [] }, frame_id, document_id, stale_off) });
          // No list of frames reaches the background, so the step goes to every frame and names the reporter, which skips it.
          if (!hold) step(tab_id, true, undefined, frame_id);
          return;
        }
        if (!hold?.frames.includes(frame_id) || KEEPS_THE_MODE.includes(mode)) return;
        if (mode === "normal" && hold.rejoined?.includes(frame_id)) return;
        if (mode === "normal" && hold.stale_offs?.includes(frame_id)) {
          await deps.storage.set({ [key_of(tab_id)]: without_stale_off(hold, frame_id) });
          return step(tab_id, true, frame_id, undefined, document_id);
        }
        await end(tab_id, hold, frame_id);
      });
    },
    // A frame that starts while the hold is on joins it: the reply to its first keymap read carries the mode. The frame goes into the hold in the same turn as the read, so an end after the read sends it the step off.
    // A new document of a frame of the hold joins too. The steps still waiting for the frame were for its old document, and so was a stale off.
    join: (tab_id: number, frame_id: number, document_id?: string): Promise<boolean> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (!hold) return false;
        drop_steps_to(tab_id, frame_id);
        await deps.storage.set({ [key_of(tab_id)]: { ...without_stale_off(with_frame(hold, frame_id, document_id), frame_id), rejoined: [...new Set([...(hold.rejoined ?? []), frame_id])] } satisfies ItemHold });
        return true;
      }),
    // A child frame of the hold that reloads or navigates keeps the tab in the mode. The commit comes before the new document's first report, which says normal before the keymap read rejoins it. The top frame's load ends the hold instead (`navigated`), and its commit decides whether the new page takes the mode back. The steps still waiting for the frame were for its old document.
    committed: (tab_id: number, frame_id: number, top_commit: TopCommit = {}): Promise<void> =>
      in_turn(async () => {
        if (frame_id === 0) return judge_resume(tab_id, top_commit);
        const hold = await read(tab_id);
        if (!hold?.frames.includes(frame_id) || hold.rejoined?.includes(frame_id)) return;
        drop_steps_to(tab_id, frame_id);
        await deps.storage.set({ [key_of(tab_id)]: { ...hold, rejoined: [...(hold.rejoined ?? []), frame_id] } satisfies ItemHold });
      }),
    // A load ends the hold in every frame. Firefox sends `status: "loading"` with no `url` when a load starts (docs/firefox-behavior.md). An address change the page makes itself keeps it.
    // The hold leaves a resume mark from `page_address`, the address the load leaves, which the top frame's commit keeps or drops (`committed`).
    navigated: (tab_id: number, change: { status?: string | undefined; url?: string | undefined }, page_address?: string): Promise<void> =>
      in_turn(async () => {
        if (change.status !== "loading" || change.url !== undefined) return;
        // The frames of the old page are gone, so the steps still waiting for them are dropped.
        clear_steps(tab_id);
        const hold = await read(tab_id);
        if (hold) {
          await deps.storage.set({ [resume_key_of(tab_id)]: { at: now(), ...(page_address !== undefined && { from: page_address }) } satisfies ResumeMark });
          await end(tab_id, hold, undefined, step_old_page);
          return;
        }
        // A kept mark goes on through a page that redirects before it completes, and that load's commit judges it again. A mark whose load never committed belongs to no load now.
        const mark = await read_resume(tab_id);
        if (mark && !mark.kept) await deps.storage.remove(resume_key_of(tab_id));
      }),
    // A load that DesertFox itself starts in the tab (`:open`, a quickmark, a mark or jump to another page) is an address the user typed, not a link, but Firefox reports it as a link. So the mode ends before the load.
    end_for_own_load: (tab_id: number): Promise<void> =>
      in_turn(async () => {
        await deps.storage.remove(resume_key_of(tab_id));
        const hold = await read(tab_id);
        if (hold) await end(tab_id, hold);
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
