// The inverse of `parse_command_line`: an invocation back to command line text, for a prompt to start from.
// It writes the shortest form that reads back as the same args: the engine first, flags in param order, the subject last.

import type { CommandDef, ParamDef } from "../command.ts";
import type { EnumSources } from "./check_args.ts";
import { single_quote } from "./single_quote.ts";
import { parse_command_line } from "./command_line.ts";
import { bare_word_param, default_of, is_context_source, is_dynamic_values, positional_params, static_values, subject_param } from "./params.ts";

type Printable = Pick<CommandDef, "id" | "name" | "params">;

export type FlagStyle = "short" | "long";

export type PrintOptions = {
  // The param the user types next. It prints even without a value, so the cursor lands after it.
  open_param?: string;
  // Short flags (`-t`) are for text the user edits. Docs use the long form.
  flags?: FlagStyle;
  // Runtime lists, so a subject that starts with an engine name gets its `--` guard.
  sources?: EnumSources;
};

const PLAIN_WORD = /^[A-Za-z0-9_./:%+,~-]+$/;

const quoted = (text: string): string => (PLAIN_WORD.test(text) ? text : single_quote(text));

function value_text(value: unknown): string {
  return is_context_source(value) ? `@${value.from}` : quoted(String(value));
}

const dashed = (word: string): string => word.replaceAll("_", "-");

// The flag that sets one param, for every param except the subject and a bare-word engine.
export function print_flag(param: ParamDef, value: unknown, style: FlagStyle = "short"): string {
  if (param.type === "bool" && value === true) {
    return style === "short" && typeof param.short === "string" ? `-${param.short}` : `--${dashed(param.name)}`;
  }
  if (param.type === "enum" && typeof value === "string" && static_values(param)?.includes(value)) {
    const letter = typeof param.short === "object" ? param.short[value] : undefined;
    return style === "short" && letter !== undefined ? `-${letter}` : `--${dashed(value)}`;
  }
  const text = value === undefined ? "" : value_text(value);
  return style === "short" && typeof param.short === "string" && param.type !== "bool" ? `-${param.short}=${text}` : `--${param.name}=${text}`;
}

// A source stays in the text even when it is the default, so a binding keeps showing where its value comes from.
// The default is the one the other args resolve to, so an arg equal to it is left out.
function is_default(command: Printable, param: ParamDef, value: unknown, args: Record<string, unknown>): boolean {
  const applicable = default_of(command, param, args);
  return applicable !== undefined && !is_context_source(applicable) && !is_context_source(value) && String(applicable) === String(value);
}

type SubjectStyle = "raw" | "guard" | "quoted" | "named";
type Plan = { engine: "bare" | "flag"; subject: SubjectStyle };

// Tried in order. The engine falls back to `--engine=` when a bare word would not read back (for example a name that starts with a dash).
const PLANS: readonly Plan[] = [
  { engine: "bare", subject: "raw" },
  { engine: "bare", subject: "guard" },
  { engine: "bare", subject: "quoted" },
  { engine: "flag", subject: "raw" },
  { engine: "flag", subject: "guard" },
  { engine: "flag", subject: "quoted" },
  { engine: "flag", subject: "named" },
];

function assemble(command: Printable, args: Record<string, unknown>, options: PrintOptions, plan: Plan): string {
  const words = [command.name ?? command.id];
  const style = options.flags ?? "short";
  const subject = subject_param(command);
  const list_param = bare_word_param(command);
  const engine = list_param && is_dynamic_values(list_param.values) ? list_param : undefined;
  const shown = (param: ParamDef): boolean => {
    const value = args[param.name];
    if (param.name === options.open_param) return true;
    return value !== undefined && value !== "" && !is_default(command, param, value, args);
  };

  if (engine && plan.engine === "bare" && shown(engine) && args[engine.name] !== undefined) words.push(quoted(String(args[engine.name])));
  const positional = positional_params(command);
  for (const param of command.params ?? []) {
    if (param === subject || positional.includes(param) || !shown(param)) continue;
    if (param === engine && plan.engine === "bare" && args[param.name] !== undefined) continue;
    words.push(print_flag(param, args[param.name], style));
  }
  for (const param of positional) if (shown(param)) words.push(args[param.name] === undefined || args[param.name] === "" ? "" : value_text(args[param.name]));
  if (subject && shown(subject)) {
    const value = args[subject.name];
    const empty = value === undefined || value === "";
    if (plan.subject === "named") words.push(print_flag(subject, value, "long"));
    else if (empty) words.push("");
    else {
      if (plan.subject === "guard") words.push("--");
      // A verbatim subject reads back as typed, so quoting it would change the value.
      words.push(plan.subject === "quoted" && !is_context_source(value) && !subject.verbatim ? quoted(String(value)) : unquoted_text(value));
    }
  }
  return words.join(" ");
}

const unquoted_text = (value: unknown): string => (is_context_source(value) ? `@${value.from}` : String(value));

// Reads back as the same args. A value that would be misread (a source, a flag, an engine name) fails this.
function reads_back(command: Printable, args: Record<string, unknown>, options: PrintOptions, text: string): boolean {
  const sources: EnumSources = { ...options.sources };
  for (const param of command.params ?? []) {
    const value = args[param.name];
    if (param.type === "enum" && is_dynamic_values(param.values) && typeof value === "string") {
      sources[param.values.from] = [...(sources[param.values.from] ?? []), value];
    }
  }
  const parsed = parse_command_line({ find: () => command }, text, sources);
  if (parsed.kind !== "invocation") return false;
  const params = new Map((command.params ?? []).map((param) => [param.name, param]));
  const given = Object.entries(args).filter(([name, value]) => value !== undefined && value !== "" && !is_default(command, params.get(name) as ParamDef, value, args));
  // `-c=` with nothing after it reads back as an empty string, which is the open param.
  const got = Object.fromEntries(Object.entries(parsed.invocation.args ?? {}).filter(([, value]) => value !== ""));
  if (Object.keys(got).length !== given.length) return false;
  return given.every(([name, value]) =>
    is_context_source(value) ? is_context_source(got[name]) && (got[name] as { from: string }).from === value.from : got[name] === (value === true ? true : String(value)),
  );
}

export function print_command(command: Printable, args: Record<string, unknown> = {}, options: PrintOptions = {}): string {
  const filled = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined && value !== ""));
  for (const plan of PLANS) {
    const text = assemble(command, args, options, plan);
    if (reads_back(command, filled, options, text)) return text;
  }
  return assemble(command, args, options, PLANS[PLANS.length - 1] as Plan);
}
