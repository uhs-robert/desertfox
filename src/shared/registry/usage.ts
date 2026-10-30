import type { CommandDef, ParamDef } from "../command.ts";
import { is_context_source, is_switch, positional_params } from "./params.ts";

// `search [-b|--background] [-t|--tab] [-w|--where <where>] <engine> <query...>`
export function usage_line(command: Pick<CommandDef, "id" | "name" | "params" | "flags">): string {
  const parts: string[] = [command.name ?? command.id];
  for (const preset of command.flags ?? []) {
    parts.push(`[${preset.short ? `-${preset.short}|` : ""}--${preset.long}]`);
  }
  for (const param of command.params ?? []) {
    if (!param.flag) continue;
    const short = param.flag.short ? `-${param.flag.short}|` : "";
    const value = is_switch(param) ? "" : ` <${param.name}>`;
    parts.push(`[${short}--${param.name}${value}]`);
  }
  for (const param of positional_params(command)) parts.push(positional_usage(param));
  return parts.join(" ");
}

// A context-source default marks the main input, so it stays unbracketed.
// A plain default makes the word optional.
function positional_usage(param: ParamDef): string {
  const word = `<${param.name}${param.rest ? "..." : ""}>`;
  const optional = param.default !== undefined && !is_context_source(param.default);
  return optional ? `[${word}]` : word;
}
