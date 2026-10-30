// Turns a `browser` mode chord into the string Firefox's `commands.update` accepts.

import { parse_sequence } from "./notation.ts";

export type ShortcutResult = { shortcut: string; error?: undefined } | { shortcut?: undefined; error: string };

const NAMED_KEYS: Record<string, string> = {
  ",": "Comma",
  ".": "Period",
  Space: "Space",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

const CHORD_TOKEN = /^<(?:([ACMS]+)-)?(.+)>$/;

export function to_firefox_shortcut(sequence: string): ShortcutResult {
  const parsed = parse_sequence(sequence);
  if (parsed.error !== undefined) return { error: parsed.error };
  if (parsed.tokens.length !== 1) return { error: `"${sequence}" is a sequence, a shortcut is one chord` };

  const token = parsed.tokens[0]!;
  const chord = CHORD_TOKEN.exec(token);
  const mods = chord?.[1] ?? "";
  const name = chord ? chord[2]! : token;

  if (mods.includes("M")) return { error: "Firefox shortcuts do not take Meta" };
  const is_function_key = /^F([1-9]|1[0-2])$/.test(name);
  if (!mods.includes("A") && !mods.includes("C") && !is_function_key) {
    return { error: `"${sequence}" needs Ctrl or Alt, Firefox rejects bare keys and Shift plus a key` };
  }

  const key_name = /^[a-z]$/.test(name) ? name.toUpperCase() : /^[0-9]$/.test(name) || is_function_key ? name : NAMED_KEYS[name];
  if (!key_name) return { error: `Firefox shortcuts do not accept the key "${name}"` };

  const parts = [mods.includes("C") ? "Ctrl" : "", mods.includes("A") ? "Alt" : "", mods.includes("S") ? "Shift" : "", key_name];
  return { shortcut: parts.filter(Boolean).join("+") };
}
