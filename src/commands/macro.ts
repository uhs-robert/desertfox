import { check_args } from "../shared/registry/check_args.ts";
import { apply_count } from "../background/count.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { define, registry } from "../shared/registry/builtin.ts";
import { MACRO_PLAY_PATTERN, MACRO_REGISTER_PATTERN, storage_name } from "../shared/register_names.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";
import { browser_macro_recorder } from "../background/macro_recorder.ts";
import type { MacroRecorder } from "../background/macro_recorder.ts";
import { browser_register_store, is_private_context } from "../background/register_store.ts";
import type { RegisterStore } from "../background/register_store.ts";
import type { Outcome, ToastKind } from "../shared/messages.ts";
import { wired_macro_replay } from "../background/macro_replay.ts";
import type { MacroReplay } from "../background/macro_replay.ts";

export type MacroCommandDeps = {
  recorder: MacroRecorder;
  store: RegisterStore;
  is_private: (ctx: CommandContext) => Promise<boolean>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
  // Undefined until the background wires the replay.
  replay: () => MacroReplay | undefined;
};

export function make_macro_handlers(deps: MacroCommandDeps) {
  return {
    record: async (ctx: CommandContext, args: { reg: string }) => {
      if (deps.replay()?.is_playing()) throw new RuntimeRefusal("A macro is playing, so recording cannot start");
      const is_private = await deps.is_private(ctx);
      // An uppercase name appends, and steps cannot join text. Checked now so the refusal comes before a recording that could not be stored.
      if (args.reg !== storage_name(args.reg) && typeof (await deps.store.read(args.reg, is_private)) === "string") throw new RuntimeRefusal(`Register ${storage_name(args.reg)} holds text, so a macro cannot join it`);
      await deps.recorder.start(args.reg, is_private);
    },
    stop: async (ctx: CommandContext) => {
      const is_private = await deps.is_private(ctx);
      const { register, steps } = await deps.recorder.stop(is_private);
      await deps.store.write(register, steps, is_private);
      const count = `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
      await deps.toast(ctx, "info", `Recorded ${count} into ${storage_name(register)}`);
    },
    // A failed step showed its own refusal, so the play ends quietly, as a cancelled pick does.
    play: async (ctx: CommandContext, args: { reg: string; count: number }): Promise<Outcome | undefined> => {
      const replay = deps.replay();
      if (!replay) throw new RuntimeRefusal("Macro replay is not ready yet");
      const finished = await replay.play({ register: storage_name(args.reg), count: args.count, tab_id: ctx.tab_id, frame_id: ctx.frame_id, mode: ctx.mode, is_private: await deps.is_private(ctx) });
      return finished ? undefined : { ok: true, cancelled: true };
    },
  };
}

const handlers = make_macro_handlers({
  recorder: browser_macro_recorder,
  store: browser_register_store,
  is_private: is_private_context,
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "macro", message, kind),
  replay: wired_macro_replay,
});

define("macro.record", {
  label: "Record macro",
  intent: "Record commands and typed text into a register. A lowercase letter replaces the macro, an uppercase letter adds to it. Press q again to stop.",
  params: [{ name: "reg", type: "key", pattern: MACRO_REGISTER_PATTERN, description: "Record into this register, a-z or A-Z." }],
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.record(ctx, args as { reg: string }),
});

define("macro.stop", {
  label: "Stop recording",
  intent: "Stop recording the macro and store it in its register.",
  runs_in: "background",
  repeatable: false,
  run: (ctx) => handlers.stop(ctx),
});

// The count is a param, not the router's repeat: the router would start each pass as a replay of its own, and play refuses while a replay runs.
define("macro.play", {
  label: "Play macro",
  intent: "Play the macro in a register, or the last one played with @. A count plays the whole macro that many times and stops at the first failure. Keys typed meanwhile wait and run after it. A failed step, a cancelled hint pick or Escape stops it and drops those keys.",
  params: [
    { name: "reg", type: "key", pattern: MACRO_PLAY_PATTERN, description: "Play this register, a-z or A-Z, or @ for the last." },
    { name: "count", type: "int", min: 1, default: 1, description: "Play the whole macro this many times." },
  ],
  runs_in: "background",
  count: { param: "count" },
  repeatable: false,
  run: (ctx, args) => handlers.play(ctx, args as { reg: string; count: number }),
});

// A recorded `macro.play` step through the same checks as a typed one: the register name, the count and the count's own limits.
export function check_play_step(step: BoundInvocation): { ok: true; register: string; count: number } | { ok: false; error: string } {
  const command = registry.get("macro.play")!;
  const checked = check_args(command, apply_count(command, step).args);
  return checked.ok ? { ok: true, register: storage_name(String(checked.args.reg)), count: Number(checked.args.count) } : { ok: false, error: checked.error };
}
