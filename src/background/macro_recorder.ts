// The macro being recorded. The state lives in `storage.session`, so a background restart keeps it and every tab can show it. A normal window and the private windows each have one, apart.
// It listens at the same `record_step` seam as `.`, but takes every step, failed ones too: a step that fails when recorded fails again on replay and stops the macro.

import { RuntimeRefusal } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import type { RecordStep, StepOrigin, StepOutcome } from "./record_step.ts";
import { as_stored } from "./repeat_memory.ts";
import { MACRO_RECORDING_PRIVATE_STORAGE_KEY, MACRO_RECORDING_STORAGE_KEY } from "./storage_keys.ts";
import { create_write_queue } from "./store_turns.ts";

export type Recording = { register: string; steps: BoundInvocation[] };

type SessionArea = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export type MacroRecorderDeps = {
  session: () => SessionArea;
  // Every tab reads its keymap again, because recording swaps the record key for the stop key and shows the badge.
  tell_tabs: () => Promise<void>;
};

const key_of = (is_private: boolean) => (is_private ? MACRO_RECORDING_PRIVATE_STORAGE_KEY : MACRO_RECORDING_STORAGE_KEY);

const is_recording = (value: unknown): value is Recording => typeof (value as Recording | undefined)?.register === "string" && Array.isArray((value as Recording).steps);

// Starting and stopping a recording are the macro's own business, and a nested `macro.play` stays so macros can call macros.
// `command.repeat` runs the saved steps through the router, which records them. Keeping it too would replay them twice.
const NEVER_RECORDED = new Set(["macro.record", "macro.stop", "command.repeat"]);

export function create_macro_recorder(deps: MacroRecorderDeps) {
  const in_turn = create_write_queue();

  async function read(is_private: boolean): Promise<Recording | undefined> {
    const stored = (await deps.session().get(key_of(is_private)))[key_of(is_private)];
    return is_recording(stored) ? stored : undefined;
  }

  const tell_tabs = () => deps.tell_tabs().catch(() => undefined);

  async function record_now(steps: readonly BoundInvocation[], outcome: StepOutcome, origin: StepOrigin): Promise<void> {
    // A prompted step runs again, with its value, as the request the command line sends. A hint pick's address opens again when the pick does.
    if (origin.prompted || origin.skip_repeat) return;
    const recording = await read(origin.is_private);
    if (!recording) return;
    const reached = outcome.failed_step === undefined ? steps : steps.slice(0, outcome.failed_step + 1);
    const kept = reached.filter((step) => !NEVER_RECORDED.has(step.id) && (step.id !== "hint.run" || origin.from_pick === true)).map(as_stored);
    if (kept.length > 0) await deps.session().set({ [key_of(origin.is_private)]: { register: recording.register, steps: [...recording.steps, ...kept] } });
  }

  const record: RecordStep = (steps, outcome, origin) => in_turn(() => record_now(steps, outcome, origin));

  // A step from a page takes its turn when the message arrives, while the checks on it still run. Without that, a stop that arrives after it could finish first and the step would be lost.
  const record_page = (checked: Promise<readonly BoundInvocation[] | undefined>, outcome: StepOutcome, origin: StepOrigin): Promise<void> =>
    in_turn(async () => {
      const steps = await checked.catch(() => undefined);
      if (steps) await record_now(steps, outcome, origin);
    });

  return {
    record,
    record_page,
    // The register being recorded into, or undefined.
    register_of: async (is_private: boolean) => (await read(is_private))?.register,
    start: (register: string, is_private: boolean) =>
      in_turn(async () => {
        const recording = await read(is_private);
        if (recording) throw new RuntimeRefusal(`Already recording into ${recording.register}`);
        await deps.session().set({ [key_of(is_private)]: { register, steps: [] } satisfies Recording });
        await tell_tabs();
      }),
    // Ends the recording and answers it. The steps are the caller's to store.
    stop: (is_private: boolean) =>
      in_turn(async () => {
        const recording = await read(is_private);
        if (!recording) throw new RuntimeRefusal("Not recording a macro");
        await deps.session().remove(key_of(is_private));
        await tell_tabs();
        return recording;
      }),
    // Drops a private recording once no private window is left.
    clear_private_without_window: (has_private_window: () => Promise<boolean>) =>
      in_turn(async () => {
        if (await has_private_window()) return;
        if (await read(true)) {
          await deps.session().remove(key_of(true));
          await tell_tabs();
        }
      }),
  };
}

export type MacroRecorder = ReturnType<typeof create_macro_recorder>;

// Calls the browser at use, so the command modules load in Node for the commands.json build.
export const browser_macro_recorder = create_macro_recorder({
  session: () => browser.storage.session,
  tell_tabs: async () => {
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map((tab) => (tab.id === undefined ? undefined : browser.tabs.sendMessage(tab.id, { type: "tree_updated" }).catch(() => undefined))));
  },
});
