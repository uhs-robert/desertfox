// The one-sentence text that lists show: the first sentence of a command intent, and the description of a flag.

import type { CommandDef, ParamDef } from "../command.ts";
import { always_default, flag_params, static_values } from "./params.ts";

export const SUMMARY_MAX_LENGTH = 60;

// A period that ends a sentence is followed by a capital letter or the end. The "." in "0.1" is not one.
const SENTENCE_END = /\.(?=\s+[A-Z]|\s*$)/;
// A summary starts with a verb. A word that opens a statement about a thing is never one.
const NOT_A_VERB = new Set(["A", "An", "The", "This", "That", "These", "Those", "It", "Its", "There"]);

export function first_sentence(text: string): string {
  const trimmed = text.trim();
  const end = trimmed.search(SENTENCE_END);
  return end < 0 ? trimmed : trimmed.slice(0, end + 1);
}

// Null when the text is a good summary: one sentence, verb first, short, and no other command named.
// `command_ids` are the ids to refuse in the text. The define-time check passes none, because it runs before the other commands exist.
export function summary_problem(text: string, command_ids: readonly string[] = []): string | null {
  if (text.trim() === "") return "must not be empty";
  if (!text.endsWith(".")) return "must end with a period";
  if (text.length > SUMMARY_MAX_LENGTH) return `has ${text.length} characters, the limit is ${SUMMARY_MAX_LENGTH}`;
  const first_word = text.split(/\s/, 1)[0] ?? "";
  if (!/^[A-Z][a-z]*$/.test(first_word) || NOT_A_VERB.has(first_word)) return `must start with a verb, not "${first_word}"`;
  if (/\blike\b|\bsame as\b/i.test(text)) return 'must not compare itself to another command ("like", "same as")';
  const named = command_ids.find((id) => text.includes(id));
  if (named) return `names the command ${named}`;
  return null;
}

// Null when a description is one good sentence. Flag descriptions hold only the summary.
export function description_problem(text: string, command_ids: readonly string[] = []): string | null {
  if (first_sentence(text) !== text.trim()) return "must be one sentence";
  return summary_problem(text, command_ids);
}

// Every problem with the texts a list shows for one command: its first sentence and its flag descriptions.
export function summary_problems(command: Pick<CommandDef, "id" | "intent" | "params">, command_ids: readonly string[] = []): string[] {
  const others = command_ids.filter((id) => id !== command.id);
  const problems: string[] = [];
  const intent_problem = summary_problem(first_sentence(command.intent), others);
  if (intent_problem) problems.push(`intent: ${intent_problem}`);
  for (const param of flag_params(command)) {
    for (const [value, text] of described_flags(param)) {
      const at = `params.${param.name}${value === undefined ? "" : `.${value}`}`;
      if (text === undefined) problems.push(`${at}: needs a description`);
      else {
        const problem = description_problem(text, others);
        if (problem) problems.push(`${at}: ${problem}`);
      }
    }
  }
  return problems;
}

// What a param needs described: the param itself, or each value that has its own flag for a fixed enum.
function described_flags(param: ParamDef): [string | undefined, string | undefined][] {
  const values = static_values(param);
  if (param.type !== "enum" || !values) return [[undefined, typeof param.description === "string" ? param.description : undefined]];
  const map = typeof param.description === "object" ? param.description : {};
  return values.filter((value) => !always_default(param, value)).map((value) => [value, map[value]]);
}
