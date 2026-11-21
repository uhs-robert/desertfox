// The steps of the mode holds that go out to the frames of a tab. Media and item mode share one queue, because a frame in one mode takes the other mode's step (`fullscreen_step`): a late step of one mode must not land after a newer step of the other.
// Steps go out in lanes. A step to one frame waits for the earlier steps that can reach that frame, and a step to every frame waits for every earlier step. An off step of an ended hold then cannot land after the on step of the next one. A frame that never answers (a page stuck in a loop) holds up the later steps to it and to every frame, and none to another frame or in another tab.
// The caller's shared queue never waits on them.

import { best_effort } from "../shared/swallow.ts";

// `from` names the reporter that a step to every frame skips. With `document_id` the step reaches that document of the frame only.
export type SendStep = (tab_id: number, on: boolean, frame_id?: number, from?: number, document_id?: string) => Promise<unknown>;

// With no `frame_id` the step goes to every frame and skips `from`. `send` stands for the step's mode. `sending` says the step is on its way and not yet answered.
type QueuedStep = { send: SendStep; on: boolean; frame_id?: number | undefined; from?: number | undefined; document_id?: string | undefined; sending?: true };

// The `sendMessage` options of a step. Firefox refuses a send to a document that another one replaced (docs/firefox-behavior.md), so a step for the old document of a frame never reaches its new one. The bundled types do not list `documentId`.
export const step_target = (frame_id?: number, document_id?: string): { frameId?: number } =>
  frame_id === undefined ? {} : ({ frameId: frame_id, ...(document_id !== undefined && { documentId: document_id }) } as { frameId: number });

const reaches = (step: QueuedStep, frame_id: number): boolean => (step.frame_id === undefined ? step.from !== frame_id : step.frame_id === frame_id);
// Whether `newer` reaches every frame `older` reaches, in the same mode. A step sets the mode, so a frame that gets the newer one needs no older one.
const covers = (newer: QueuedStep, older: QueuedStep): boolean =>
  newer.send === older.send && (older.frame_id === undefined ? newer.frame_id === undefined && (newer.from === undefined || newer.from === older.from) : reaches(newer, older.frame_id));
// Whether two steps can reach one frame, so the later one waits for the earlier one. A step to every frame counts as reaching its reporter too: the order then stays plain.
const share_a_frame = (later: QueuedStep, earlier: QueuedStep): boolean => later.frame_id === undefined || earlier.frame_id === undefined || later.frame_id === earlier.frame_id;

// `steps_by_tab` holds the steps of each tab, oldest first, the ones on their way included. A tab with no step left has no entry.
export function create_step_queue(steps_by_tab = new Map<number, QueuedStep[]>()) {
  const steps_of = (tab_id: number): QueuedStep[] => steps_by_tab.get(tab_id) ?? [];
  const store_and_send = (tab_id: number, steps: QueuedStep[]): void => {
    if (steps.length === 0) return void steps_by_tab.delete(tab_id);
    steps_by_tab.set(tab_id, steps);
    steps.forEach((queued, index) => {
      if (queued.sending || steps.slice(0, index).some((earlier) => share_a_frame(queued, earlier))) return;
      queued.sending = true;
      void best_effort(queued.send(tab_id, queued.on, queued.frame_id, queued.from, queued.document_id)).then(() => {
        // A load or a close of the tab dropped the step already, and the steps behind it went on without it.
        if (steps_of(tab_id).includes(queued)) store_and_send(tab_id, steps_of(tab_id).filter((step) => step !== queued));
      });
    });
  };

  return {
    // The steps of the mode that `send` sends.
    for_mode: (send: SendStep) => ({
      // A new step drops the waiting steps of its mode that it covers, so a tab holds at most one waiting step per mode and frame, and per mode and reporter of a step to every frame, however long a frame stays stuck.
      step: (tab_id: number, on: boolean, frame_id?: number, from?: number, document_id?: string): void => {
        const queued: QueuedStep = { send, on, frame_id, from, document_id };
        store_and_send(tab_id, [...steps_of(tab_id).filter((older) => older.sending || !covers(queued, older)), queued]);
      },
      // A frame that reports the mode on its own, or whose new document joins a hold, is past every step of the mode still waiting for it alone, the off of a hold it left included. The step on of a hold it starts skips it, so that off would land last.
      drop_steps_to: (tab_id: number, frame_id: number): void => store_and_send(tab_id, steps_of(tab_id).filter((queued) => queued.sending || queued.send !== send || queued.frame_id !== frame_id)),
      // Whether an off step of the mode to the frame is on its way, so the frame can still take it after a report it sent first.
      off_on_its_way: (tab_id: number, frame_id: number): boolean => steps_of(tab_id).some((queued) => queued.sending && queued.send === send && !queued.on && queued.frame_id === frame_id),
      // At a load or a close of the tab: the frames of the old page are gone, so the steps of the mode still waiting for them never go out, and the ones on their way hold up nothing.
      clear: (tab_id: number): void => store_and_send(tab_id, steps_of(tab_id).filter((queued) => queued.send !== send)),
    }),
  };
}

export type StepQueue = ReturnType<typeof create_step_queue>;

// The frames of a hold. `documents` names the document each frame joined from, so its off step reaches that document only. `stale_offs` are frames that started or joined the hold on their own while an off step of an older hold was on its way to them: the next report of normal from such a frame is that off landing, not the user leaving. An Escape the user presses in that frame before the off lands reads as the off too, which no report can tell apart.
export type HoldFrames = { frames: number[]; documents?: Record<number, string>; stale_offs?: number[] };

// `stale_off` says an off step of an older hold is on its way to the frame, which reported first.
export const with_frame = <Hold extends HoldFrames>(hold: Hold, frame_id: number, document_id: string | undefined, stale_off = false): Hold => ({
  ...hold,
  frames: hold.frames.includes(frame_id) ? hold.frames : [...hold.frames, frame_id],
  ...(document_id !== undefined && { documents: { ...hold.documents, [frame_id]: document_id } }),
  ...(stale_off && { stale_offs: [...(hold.stale_offs ?? []), frame_id] }),
});

// The stale off of the frame landed, or can no longer land on its new document.
export const without_stale_off = <Hold extends HoldFrames>({ stale_offs, ...hold }: Hold, frame_id: number): Hold => {
  const still_stale = (stale_offs ?? []).filter((other) => other !== frame_id);
  return { ...hold, ...(still_stale.length > 0 && { stale_offs: still_stale }) } as Hold;
};

// The one queue of the background, shared by the media and the item mode.
export const tab_steps = create_step_queue();
