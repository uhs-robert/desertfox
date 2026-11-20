// The steps of a mode hold that go out to the frames of a tab, one at a time per tab, in the order the hold sent them. An off step of an ended hold then cannot land after the on step of the next one.
// The caller's shared queue never waits on them: a frame that never answers (a page stuck in a loop) holds up the steps behind it in its tab, and nothing in another tab.
// A step sets one mode, so the cover rule holds within one mode, and each mode keeps its own queue.

import { best_effort } from "../shared/swallow.ts";

// `from` names the reporter that a step to every frame skips.
export type SendStep = (tab_id: number, on: boolean, frame_id?: number, from?: number) => Promise<unknown>;

// A step that waits for its turn. With no `frame_id` it goes to every frame, and skips `from`.
type QueuedStep = { on: boolean; frame_id?: number | undefined; from?: number | undefined };
// `sending` says a step of the tab is on its way and not yet answered. `waiting` holds those not yet sent, oldest first.
type TabSteps = { sending: boolean; waiting: QueuedStep[] };

// Whether `newer` reaches every frame `older` reaches. A step sets the mode, so a frame that gets the newer one needs no older one.
const covers = (newer: QueuedStep, older: QueuedStep): boolean => {
  if (newer.frame_id !== undefined) return older.frame_id === newer.frame_id;
  if (newer.from === undefined) return true;
  return older.frame_id === undefined ? older.from === newer.from : older.frame_id !== newer.from;
};

export function create_step_queue(send_step: SendStep) {
  // A new step drops the waiting steps it covers, so the waiting list holds at most one step per frame and per reporter of a step to every frame, however long a frame stays stuck.
  const tab_steps = new Map<number, TabSteps>();
  const send_next = (tab_id: number, steps: TabSteps): void => {
    // A load or a close of the tab replaced its steps: the frames they were for are gone.
    const next = tab_steps.get(tab_id) === steps ? steps.waiting.shift() : undefined;
    steps.sending = next !== undefined;
    if (next) void best_effort(send_step(tab_id, next.on, next.frame_id, next.from)).then(() => send_next(tab_id, steps));
  };
  return {
    step: (tab_id: number, on: boolean, frame_id?: number, from?: number): void => {
      const steps = tab_steps.get(tab_id) ?? { sending: false, waiting: [] };
      tab_steps.set(tab_id, steps);
      const queued: QueuedStep = { on, frame_id, from };
      steps.waiting = [...steps.waiting.filter((older) => !covers(queued, older)), queued];
      if (!steps.sending) send_next(tab_id, steps);
    },
    // A frame that reports the mode on its own is past every step still waiting for it alone, the off of a hold it left included. The step on of a hold it starts skips it, so that off would land last.
    drop_steps_to: (tab_id: number, frame_id: number): void => {
      const steps = tab_steps.get(tab_id);
      if (steps) steps.waiting = steps.waiting.filter((waiting) => waiting.frame_id !== frame_id);
    },
    // At a load or a close of the tab: the frames of the old page are gone, so the steps still waiting for them never go out.
    clear: (tab_id: number): void => void tab_steps.delete(tab_id),
  };
}
