import { create_registry } from "./define.ts";

// The registry the extension uses. Command modules call `define` on import.
export const registry = create_registry();
export const define = registry.define;

export { COMMAND_ID_PATTERN, create_registry, DefineError } from "./define.ts";
export type { CommandInput, Registry } from "./define.ts";
export { check_args } from "./check_args.ts";
export type { CheckResult, EnumSources } from "./check_args.ts";
export { parse_command_line, tokenize } from "./command_line.ts";
export type { CommandLookup, ParseResult, Token } from "./command_line.ts";
export { description_problem, first_sentence, summary_problem, summary_problems } from "./summary.ts";
export { usage_line } from "./usage.ts";
export { build_commands_file, command_meta } from "./commands_file.ts";
export { print_command } from "./print_command.ts";
export type { PrintOptions } from "./print_command.ts";
