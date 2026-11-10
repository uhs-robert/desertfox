// Plays a macro. Each step runs through the router as its own request, so `.` after `@a` repeats the macro's last repeatable step, and a step after a tab switch runs in the new tab.
// Keys typed during a replay wait in the pages, as vim's typeahead does: every tab the replay reaches gets `replay_hold`, and its pages ask with `replay_end` when to run or drop them.
// The replay lives in memory only. It dies with the background, and the held pages then see their `replay_end` fail and drop their keys.

import { RuntimeRefusal } from "../shared/command.ts";
import type { Mode } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import type { RunResponse } from "../shared/messages.ts";
import { PAGE_READY_TIMEOUT_MS, type PageReady, type PageWatch } from "./page_ready.ts";

// How deep `@a` inside a macro may nest before the replay refuses, so a macro that plays itself ends.
export const MAX_MACRO_DEPTH = 10;

// Where a step runs: the sender frame while the replay is still in the tab it started in, the top frame of any other tab.
export type StepPlace = { tab_id: number | undefined; frame_id: number; mode: Mode };

export type MacroReplayDeps = {
  // The steps stored in the register, or undefined when it holds no macro.
  read_macro: (register: string, is_private: boolean) => Promise<BoundInvocation[] | undefined>;
  // Runs one step through the router with no command line and with instant scrolls. The router shows a failure itself.
  run_step: (step: BoundInvocation, place: StepPlace) => Promise<RunResponse>;
  active_tab_id: () => Promise<number | undefined>;
  watch: (tab_id: number) => PageWatch;
  // Sends `replay_hold` to every frame of the tab.
  hold_keys: (tab_id: number) => Promise<unknown>;
  show_refusal: (tab_id: number | undefined, message: string) => Promise<unknown>;
};

export type ReplayStart = { register: string; tab_id: number | undefined; frame_id: number | undefined; mode: Mode; is_private: boolean };

type Replay = {
  // The tab the replay is in now. A run from another tab waits for the end.
  tab_id: number | undefined;
  stopped: boolean;
  // Ends the page-ready wait in progress, so Escape does not wait up to the timeout.
  end_wait: () => void;
  // True when every step finished.
  ended: Promise<boolean>;
};

export function create_macro_replay(deps: MacroReplayDeps) {
  let current: Replay | undefined;

  const refuse = async (message: string): Promise<false> => {
    await deps.show_refusal(current?.tab_id, message).catch(() => undefined);
    return false;
  };

  // A tab switch waits for the new tab, a navigation for the new page. Anything else runs the next step at once.
  async function settle_page(replay: Replay, before: number | undefined, watch: PageWatch | undefined): Promise<PageReady | undefined> {
    const after = await deps.active_tab_id();
    replay.tab_id = after;
    if (after === before && watch?.navigated()) {
      replay.end_wait = watch.stop;
      return watch.done(PAGE_READY_TIMEOUT_MS);
    }
    watch?.stop();
    if (after === before) return undefined;
    if (after === undefined) return "gone";
    // A tab that is still loading may have its page script already, so it holds keys from the switch on. The hold after the wait covers a page that came later.
    await deps.hold_keys(after).catch(() => undefined);
    // The watch on the old tab saw nothing of the new one, so the new tab gets a watch of its own. It answers at once when that tab is already loaded.
    const waited = deps.watch(after);
    replay.end_wait = waited.stop;
    return waited.done(PAGE_READY_TIMEOUT_MS);
  }

  // False at the first step that failed, was cancelled or was stopped. A failure the router saw is shown already, and so is one refused here.
  async function play_steps(replay: Replay, steps: readonly BoundInvocation[], depth: number, start: ReplayStart): Promise<boolean> {
    for (const step of steps) {
      if (replay.stopped) return false;
      // A nested macro plays inside this replay, so it shares the one hold and the one end.
      if (step.id === "macro.play") {
        if (depth >= MAX_MACRO_DEPTH) return refuse(`Macros nest more than ${MAX_MACRO_DEPTH} deep`);
        const register = String(step.args?.reg);
        const nested = await deps.read_macro(register, start.is_private);
        if (!nested) return refuse(`Register ${register} holds no macro`);
        if (!(await play_steps(replay, nested, depth + 1, start))) return false;
        continue;
      }
      const before = await deps.active_tab_id();
      // Started before the step, because a navigation's `loading` can arrive before the step answers.
      const watch = before === undefined ? undefined : deps.watch(before);
      const answer = await deps.run_step(step, { tab_id: before, frame_id: before === start.tab_id ? (start.frame_id ?? 0) : 0, mode: start.mode });
      if (!answer.ok || answer.cancelled) {
        watch?.stop();
        return false;
      }
      const ready = await settle_page(replay, before, watch);
      if (replay.stopped) return false;
      if (ready === "timeout") return refuse(`The page did not load within ${PAGE_READY_TIMEOUT_MS / 1000} seconds, so the macro stopped`);
      if (ready === "ready") await deps.hold_keys(replay.tab_id!).catch(() => undefined);
    }
    return true;
  }

  return {
    // Answers true when every step finished. Refuses before the first step when the register holds no macro.
    play: async (start: ReplayStart): Promise<boolean> => {
      // A snippet or a shortcut can ask while a replay runs. Waiting would deadlock a snippet that the replay itself runs.
      if (current) throw new RuntimeRefusal("A macro is already playing");
      let finish!: (finished: boolean) => void;
      const replay: Replay = { tab_id: start.tab_id, stopped: false, end_wait: () => undefined, ended: new Promise((resolve) => (finish = resolve)) };
      current = replay;
      let finished = false;
      try {
        const steps = await deps.read_macro(start.register, start.is_private);
        if (!steps) throw new RuntimeRefusal(`Register ${start.register} holds no macro`);
        if (start.tab_id !== undefined) await deps.hold_keys(start.tab_id).catch(() => undefined);
        finished = await play_steps(replay, steps, 1, start);
      } finally {
        current = undefined;
        finish(finished);
      }
      return finished;
    },
    // Escape in a held page. The step in progress ends first, unless it is a page-ready wait, which ends now.
    stop: (): void => {
      if (!current) return;
      current.stopped = true;
      current.end_wait();
    },
    is_playing: (): boolean => current !== undefined,
    // The answer to `replay_end`.
    ended: async (): Promise<{ ok: boolean }> => ({ ok: (await current?.ended) ?? true }),
    // A run from a tab the replay is not in waits for the end, so a key typed in a tab the replay left cannot act on the replay's tab between its steps.
    wait_unless_from: async (tab_id: number | undefined): Promise<void> => {
      if (current && current.tab_id !== tab_id) await current.ended;
    },
  };
}

export type MacroReplay = ReturnType<typeof create_macro_replay>;

// The router exists only once the background has built it, so `main.ts` wires the replay in. The macro commands and the recorder read it through these.
let wired: MacroReplay | undefined;
export const wire_macro_replay = (replay: MacroReplay) => void (wired = replay);
export const wired_macro_replay = (): MacroReplay | undefined => wired;
export const is_replaying = (): boolean => wired?.is_playing() === true;
