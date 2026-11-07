// Types and helpers only. Nothing runs at import. The built-in `registry` and `define` live in builtin.ts.
export { COMMAND_ID_PATTERN, create_registry, DefineError } from "./define.ts";
export type { CommandInput, Registry } from "./define.ts";
export { check_args } from "./check_args.ts";
export type { CheckResult, EnumSources } from "./check_args.ts";
export { parse_command_line, read_flag, tokenize } from "./command_line.ts";
export type { CommandLookup, ParseResult, Token } from "./command_line.ts";
export { description_problem, first_sentence, summary_problem, summary_problems } from "./summary.ts";
export { flag_alternatives, usage_line } from "./usage.ts";
export { build_commands_file, command_meta } from "./commands_file.ts";
export { print_command } from "./print_command.ts";
export type { PrintOptions } from "./print_command.ts";
