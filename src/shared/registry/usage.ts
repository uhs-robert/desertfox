import type { CommandDef, ParamDef } from "../command.ts";
import { is_context_source, static_values } from "./params.ts";

// `search engine query [here|tab|background|window] [container=<container>]`, in the words the grammar reads.
export function usage_line(command: Pick<CommandDef, "id" | "name" | "params">): string {
  return [command.name ?? command.id, ...(command.params ?? []).map(param_usage)].join(" ");
}

// A bare word names a switch, picks an enum value or fills the main param.
// Any other param needs `name=`. A context-source default marks the main
// input, so it stays unbracketed.
function param_usage(param: ParamDef): string {
  const word =
    param.type === "enum"
      ? (static_values(param)?.join("|") ?? param.name)
      : param.type === "bool" || param.main
        ? `${param.name}${param.rest ? "..." : ""}`
        : `${param.name}=<${param.name}>`;
  const optional =
    param.type === "bool" ||
    param.when !== undefined ||
    (param.default !== undefined && !is_context_source(param.default));
  return optional ? `[${word}]` : word;
}
