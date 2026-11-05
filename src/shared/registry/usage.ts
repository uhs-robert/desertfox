import type { CommandDef, ParamDef } from "../command.ts";
import { bare_word_param, default_value, literal_default, flag_params, is_dynamic_values, positional_params, static_values, subject_param } from "./params.ts";

type Usable = Pick<CommandDef, "id" | "name" | "params">;

// `search [<engine>] [-t|--tab|-b|--background|-w|--window] [-c=<container>|--container=<container>] query...`, in the words the grammar reads.
// The engine comes first, flags follow in param order and the subject comes last.
export function usage_line(command: Usable): string {
  const bare = bare_word_param(command);
  const subject = subject_param(command);
  const flags = flag_params(command);
  const engine = bare && is_dynamic_values(bare.values) ? [`[<${bare.name}>]`] : [];
  return [command.name ?? command.id, ...engine, ...flags.map(flag_usage), ...positional_params(command).map((param) => `<${param.name}>`), ...(subject ? [subject_usage(subject)] : [])].join(" ");
}

function is_optional(param: ParamDef): boolean {
  return param.type === "bool" || param.when !== undefined || literal_default(param) !== undefined;
}

function subject_usage(param: ParamDef): string {
  const word = param.type === "enum" ? (static_values(param)?.join("|") ?? param.name) : `${param.name}${param.rest ? "..." : ""}`;
  return is_optional(param) ? `[${word}]` : word;
}

function flag_usage(param: ParamDef): string {
  const word = flag_alternatives(param).join("|");
  return is_optional(param) ? `[${word}]` : word;
}

// Every way to type one param as a flag, short before long. The default enum value is the state without the flag, so it needs no mention.
export function flag_alternatives(param: ParamDef): string[] {
  const dashed = (word: string) => word.replaceAll("_", "-");
  let alternatives: string[];
  if (param.type === "bool") {
    alternatives = [...(typeof param.short === "string" ? [`-${param.short}`] : []), `--${dashed(param.name)}`];
  } else if (param.type === "enum" && static_values(param)) {
    // The default value is the state without the flag, so it needs no mention.
    const values = (static_values(param) ?? []).filter((value) => value !== default_value(param));
    alternatives = values.flatMap((value) => {
      const letter = typeof param.short === "object" ? param.short[value] : undefined;
      return [...(letter ? [`-${letter}`] : []), `--${dashed(value)}`];
    });
  } else {
    alternatives = [...(typeof param.short === "string" ? [`-${param.short}=<${param.name}>`] : []), `--${param.name}=<${param.name}>`];
  }
  return alternatives;
}
