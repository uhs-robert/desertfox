// The inverse of `parse_command_line`: an invocation back to command line text, for a prompt to start from.

import type { CommandDef, ParamDef } from "../command.ts";
import { parse_command_line } from "./command_line.ts";
import type { EnumSources } from "./check_args.ts";
import { is_context_source } from "./params.ts";

type Printable = Pick<CommandDef, "id" | "name" | "params">;

export type PrintOptions = {
  // The runtime value lists (search engines). A bare word can name a value only if the parser sees the list.
  sources?: EnumSources;
  // The param the user types next. It prints even without a value, so the cursor lands after it.
  open_param?: string;
};

const PLAIN_WORD = /^[A-Za-z0-9_./:%+,~-]+$/;

// Single quotes are literal, so a quote inside closes, escapes and reopens.
function quoted(text: string): string {
  return PLAIN_WORD.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function value_text(value: unknown): string {
  return is_context_source(value) ? `@${value.from}` : quoted(String(value));
}

const named = (param: ParamDef, value: unknown): string => `${param.name}=${value === undefined ? "" : value_text(value)}`;

type MainStyle = "raw" | "quoted" | "named";

function assemble(command: Printable, args: Record<string, unknown>, options: PrintOptions, style: MainStyle, bare_enums: boolean): string {
  const words = [command.name ?? command.id];
  const params = command.params ?? [];
  // The main value runs to the end of the line, so it prints last.
  const ordered = [...params.filter((param) => !param.main), ...params.filter((param) => param.main)];
  for (const param of ordered) {
    const value = args[param.name];
    const wanted = param.name === options.open_param;
    if (value === undefined && !wanted) continue;
    if (param.type === "bool" && value === true) words.push(param.name);
    else if (bare_enums && param.type === "enum" && value !== undefined && value !== "" && !is_context_source(value)) words.push(quoted(String(value)));
    else if (param.main && (value === undefined || value === "")) words.push(style === "named" ? named(param, value) : "");
    else if (param.main && style === "raw") words.push(String(value));
    else if (param.main && style === "quoted") words.push(quoted(String(value)));
    else words.push(named(param, value));
  }
  return words.join(" ");
}

// Reads back as the same args. A value that a bare word would misread (a source, a flag, an enum word) fails this.
function reads_back(command: Printable, args: Record<string, unknown>, text: string, lists: EnumSources | undefined): boolean {
  const parsed = parse_command_line({ find: () => command }, text, lists);
  if (parsed.kind !== "invocation" || parsed.warnings) return false;
  const given = Object.entries(args).filter(([, value]) => value !== undefined && !is_context_source(value));
  const sources = Object.entries(args).filter(([, value]) => is_context_source(value));
  // `name=` with nothing after it reads back as an empty string, which is the open param.
  const got = Object.fromEntries(Object.entries(parsed.invocation.args ?? {}).filter(([, value]) => value !== ""));
  if (Object.keys(got).length !== given.length + sources.length) return false;
  return given.every(([name, value]) => got[name] === (value === true ? true : String(value))) && sources.every(([name, value]) => is_context_source(got[name]) && (got[name] as { from: string }).from === (value as { from: string }).from);
}

// An arg equal to its default adds nothing: the validator fills it back in.
function without_defaults(command: Printable, args: Record<string, unknown>, open_param: string | undefined): Record<string, unknown> {
  const params = command.params ?? [];
  return Object.fromEntries(
    Object.entries(args).filter(([name, value]) => {
      const param = params.find((candidate) => candidate.name === name);
      if (name === open_param || param?.default === undefined || is_context_source(value)) return true;
      return String(param.default) !== String(value);
    }),
  );
}

// Each attempt must read back as the same args. Bare enum words come first, then `name=value` for the ones that do not round-trip.
export function print_command(command: Printable, all_args: Record<string, unknown> = {}, options: PrintOptions = {}): string {
  const args = without_defaults(command, all_args, options.open_param);
  const filled = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined && value !== ""));
  for (const bare_enums of [true, false]) {
    for (const style of ["raw", "quoted"] as const) {
      const text = assemble(command, args, options, style, bare_enums);
      if (reads_back(command, filled, text, options.sources)) return text;
    }
  }
  return assemble(command, args, options, "named", false);
}
