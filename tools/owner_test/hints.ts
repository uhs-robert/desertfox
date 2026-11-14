import { is_setting_name, parse_setting_text } from "../../src/shared/settings_schema.ts";
import { SETTINGS_TABLE } from "../../src/shared/settings_table.ts";

export type HintCheck = { ok: true } | { ok: false; error: string };

// A hint is one `:set name value` the maintainer will type. Checking it here fails a typo at open time, not in front of the maintainer.
export function check_hint(hint: string): HintCheck {
  const match = /^:set (\S+)(?: (.*))?$/.exec(hint.trim());
  if (!match) return { ok: false, error: `hint "${hint}" must look like ":set name value"` };
  const [, name = "", value = ""] = match;
  if (!is_setting_name(name)) return { ok: false, error: `hint "${hint}": no setting named ${name}` };
  if ((SETTINGS_TABLE[name] as { settable?: false }).settable === false) return { ok: false, error: `hint "${hint}": ${name} cannot be set with :set` };
  if (value === "") return { ok: false, error: `hint "${hint}": give a value` };
  const parsed = parse_setting_text(name, value);
  return "error" in parsed ? { ok: false, error: `hint "${hint}": ${parsed.error}` } : { ok: true };
}
