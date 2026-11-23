import { create_registry } from "./define.ts";
import type { CommandInput } from "./define.ts";
import type { ArgsOf, BackgroundCommandDef, CommandContext, CommandDef, ParamDef } from "../command.ts";
import type { Outcome } from "../messages/content.ts";

// The registry the extension uses. Command modules call `define` on import. Only the background page and Node tools import this file, because the call runs at import and keeps define.ts and the setting rules in the bundle.
export const registry = create_registry();

type TypedBackgroundInput<P extends readonly ParamDef[]> = Omit<BackgroundCommandDef, "id" | "params" | "run"> & {
  bridge: boolean;
  params?: P;
  run: (ctx: CommandContext, args: ArgsOf<P>) => Promise<void | Outcome> | void | Outcome;
};

type Define = {
  // A background command whose `run` takes the args its params describe.
  <const P extends readonly ParamDef[]>(id: string, input: TypedBackgroundInput<P>): CommandDef;
  // Wide fallback: a command whose `run` still takes `CheckedArgs`, and every content command.
  (id: string, input: CommandInput & { bridge: boolean }): CommandDef;
};

// Every built-in command states `bridge` on purpose, because the bridge runs nothing by default and a forgotten field should not pass silently.
export const define: Define = (id: string, input: CommandInput & { bridge: boolean }): CommandDef => registry.define(id, input);
