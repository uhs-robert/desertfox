// The checks of the engine form's fields. The page runs them while the user types and the background runs them again at Save, so both agree on what a field may hold. The config build checks the rest.

import { expressions_of } from "./engines/fill.ts";
import { ENGINE_KEYWORD } from "./engines/resolve.ts";
import { parse_sequence } from "./keys/index.ts";

const ENGINE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function field_problems(fields: { name: string; url: string; keyword?: string | undefined; letter?: string | undefined }): string[] {
  const problems: string[] = [];
  if (!ENGINE_NAME.test(fields.name)) problems.push("The name is letters, digits, - and _, and starts with a letter or digit.");
  if (!/^https?:\/\//.test(fields.url)) problems.push("The address starts with http:// or https://.");
  else if (!expressions_of(fields.url).some((expression) => expression.alternatives.includes("query"))) problems.push("The address needs {query} where the search text goes.");
  if (fields.keyword && !ENGINE_KEYWORD.test(fields.keyword)) problems.push("The search word is one to eight lower case letters or digits.");
  if (fields.letter && parse_sequence(fields.letter).tokens?.length !== 1) problems.push("The key letter is one key, such as g.");
  return problems;
}

