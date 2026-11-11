import { create_registry } from "./define.ts";
import type { CommandInput } from "./define.ts";
import type { CommandDef } from "../command.ts";

// The registry the extension uses. Command modules call `define` on import. Only the background page and Node tools import this file, because the call runs at import and keeps define.ts and the setting rules in the bundle.
export const registry = create_registry();
// Every built-in command states `bridge` on purpose, because the bridge runs nothing by default and a forgotten field should not pass silently.
export const define = (id: string, input: CommandInput & { bridge: boolean }): CommandDef => registry.define(id, input);
