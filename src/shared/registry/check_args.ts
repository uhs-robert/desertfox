// The one validator. Keys, the command line, the native host and snippets
// all end here.

import type { CommandDef } from "../command.ts";
import { is_setting_name, parse_setting_text } from "../settings_schema.ts";
import { check_args_shape, type CheckResult, type EnumSources } from "./check_shape.ts";

export type { CheckResult, EnumSources } from "./check_shape.ts";

export function check_args(
  command: Pick<CommandDef, "id" | "params">,
  raw_args: Record<string, unknown> | undefined,
  sources: EnumSources = {},
): CheckResult {
  const shaped = check_args_shape(command, raw_args, sources);
  if (!shaped.ok) return shaped;
  // Last, as before the split: a setting value is parsed only once every other rule has passed.
  for (const param of command.params ?? []) {
    if (param.value_of === undefined) continue;
    const [text, name] = [shaped.args[param.name], shaped.args[param.value_of]];
    if (typeof text !== "string" || text.trim() === "" || typeof name !== "string" || !is_setting_name(name)) continue;
    const parsed = parse_setting_text(name, text);
    if ("error" in parsed) return { ok: false, error: parsed.error };
  }
  return shaped;
}
