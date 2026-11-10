import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { MACRO_REGISTER_PATTERN, storage_name } from "../shared/register_names.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";
import { browser_macro_recorder } from "../background/macro_recorder.ts";
import type { MacroRecorder } from "../background/macro_recorder.ts";
import { browser_register_store, is_private_context } from "../background/register_store.ts";
import type { RegisterStore } from "../background/register_store.ts";
import type { ToastKind } from "../shared/messages.ts";

export type MacroCommandDeps = {
  recorder: MacroRecorder;
  store: RegisterStore;
  is_private: (ctx: CommandContext) => Promise<boolean>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
};

export function make_macro_handlers(deps: MacroCommandDeps) {
  return {
    record: async (ctx: CommandContext, args: { reg: string }) => {
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
  };
}

const handlers = make_macro_handlers({
  recorder: browser_macro_recorder,
  store: browser_register_store,
  is_private: is_private_context,
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "macro", message, kind),
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
