// The registry and its define-time checks. Every rejection throws a
// DefineError that names the command and the field.

import type { CommandDef, ParamDef, ParamValue } from "../command.ts";
import type { Mode } from "../command.ts";
import { find_param, is_context_source, is_dynamic_values, static_values } from "./params.ts";

export type CommandInput = Omit<CommandDef, "id">;

export class DefineError extends Error {
  constructor(command_id: string, field: string, problem: string) {
    super(`command "${command_id}": ${field}: ${problem}`);
    this.name = "DefineError";
  }
}

export type Registry = {
  // Checks the definition, stores it and returns it with `count` and `modes` defaults applied.
  // Snippet commands go through the same call, so they share the name check.
  define(id: string, input: CommandInput): CommandDef;
  get(id: string): CommandDef | undefined;
  // Resolves a command line word: a name, an alias or a full id.
  find(word: string): CommandDef | undefined;
  list(): CommandDef[];
};

export const COMMAND_ID_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const PARAM_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const COMMAND_WORD_PATTERN = /^[^\s'"\\-][^\s'"\\]*$/;
const PARAM_TYPES = ["int", "float", "string", "bool", "enum"];
const MODES: readonly Mode[] = ["normal", "insert", "ignore", "hint", "cmdline"];

export function create_registry(): Registry {
  const commands_by_id = new Map<string, CommandDef>();
  const commands_by_word = new Map<string, CommandDef>();

  function define(id: string, input: CommandInput): CommandDef {
    const fail = (field: string, problem: string): never => {
      throw new DefineError(id, field, problem);
    };
    if (!COMMAND_ID_PATTERN.test(id)) fail("id", "must be group.name, lowercase with underscores");
    if (commands_by_id.has(id)) fail("id", "already defined");

    check_words(id, input, commands_by_word, fail);
    check_intent(input, fail);
    check_params(input, fail);
    check_bare_words(input, fail);
    check_count_and_modes(input, fail);

    const command: CommandDef = { ...input, id, count: input.count ?? "ignore", modes: input.modes ?? ["normal"] };
    commands_by_id.set(id, command);
    for (const word of [id, ...(input.name ? [input.name] : []), ...(input.aliases ?? [])]) {
      commands_by_word.set(word, command);
    }
    return command;
  }

  return {
    define,
    get: (id) => commands_by_id.get(id),
    find: (word) => commands_by_word.get(word),
    list: () => [...commands_by_id.values()],
  };
}

type Fail = (field: string, problem: string) => never;

function check_words(id: string, input: CommandInput, taken: Map<string, CommandDef>, fail: Fail): void {
  if (taken.has(id)) fail("id", `already used as the name or alias of "${taken.get(id)?.id}"`);
  const seen = new Set<string>();
  const words: [string, string][] = [];
  if (input.name !== undefined) words.push(["name", input.name]);
  (input.aliases ?? []).forEach((alias, index) => words.push([`aliases[${index}]`, alias]));
  for (const [field, word] of words) {
    if (!COMMAND_WORD_PATTERN.test(word)) fail(field, `"${word}" must be one word that does not start with "-"`);
    const owner = taken.get(word);
    if (owner) fail(field, `"${word}" is already used by "${owner.id}"`);
    if (word === id || seen.has(word)) fail(field, `"${word}" is used twice in this command`);
    seen.add(word);
  }
}

// The description shows on the help page and the status page, so it is one plain sentence.
function check_intent(input: CommandInput, fail: Fail): void {
  if (input.intent.trim() === "") fail("intent", "must not be empty");
  if (/[\r\n]/.test(input.intent)) fail("intent", "must be one line");
}

// Config and the command line let a bare word stand for an enum value or a bool, so the words of one command must not repeat.
function check_bare_words(input: CommandInput, fail: Fail): void {
  const owner_of_word = new Map<string, string>();
  for (const param of input.params ?? []) {
    const words = param.type === "bool" ? [param.name] : (static_values(param) ?? []).filter(() => param.type === "enum");
    for (const word of words) {
      const owner = owner_of_word.get(word);
      if (owner !== undefined) fail(`params.${param.name}`, `bare word "${word}" is also used by param "${owner}"`);
      owner_of_word.set(word, param.name);
    }
  }
}

function check_params(input: CommandInput, fail: Fail): void {
  const params = input.params ?? [];
  const names = new Set<string>();
  params.forEach((param, index) => {
    const at = `params[${index}]`;
    if (!PARAM_NAME_PATTERN.test(param.name)) fail(`${at}.name`, `"${param.name}" must be lowercase with underscores`);
    if (names.has(param.name)) fail(`${at}.name`, `"${param.name}" is used twice`);
    names.add(param.name);
    check_param_shape(param, at, fail);
  });

  params.forEach((param, index) => {
    const at = `params[${index}]`;
    if (param.rest && param.type !== "string") fail(`${at}.rest`, "only a string param can take the rest");
    if (param.when) check_when(input, param, at, fail);
  });

  const mains = params.filter((param) => param.main);
  if (mains.length > 1) fail("params.main", `only one param can be main, found ${mains.map((param) => param.name).join(", ")}`);
  const main = mains[0];
  if (main && main.type !== "string") fail(`params.${main.name}.main`, "only a string param can be main");
}

function check_param_shape(param: ParamDef, at: string, fail: Fail): void {
  if (!PARAM_TYPES.includes(param.type)) fail(`${at}.type`, `unknown type "${String(param.type)}"`);
  if (param.type === "enum" && param.values === undefined) fail(`${at}.values`, "an enum needs values");
  if (param.values !== undefined && param.type !== "enum" && param.type !== "string") {
    fail(`${at}.values`, "only enum and string params take values");
  }
  const list = static_values(param);
  if (list) {
    if (list.length === 0) fail(`${at}.values`, "must not be empty");
    if (new Set(list).size !== list.length) fail(`${at}.values`, "has a repeated value");
  } else if (is_dynamic_values(param.values)) {
    const from = (param.values as { from: unknown }).from;
    if (from !== "search_engines" && from !== "containers") fail(`${at}.values`, `unknown source "${String(from)}"`);
  }
  if (param.default !== undefined) {
    if (is_context_source(param.default)) {
      if (param.type !== "string") fail(`${at}.default`, "a context source fits only a string param");
    } else {
      const problem = value_problem(param, param.default);
      if (problem) fail(`${at}.default`, problem);
    }
  }
}

// Null when `value` is valid for the param. Dynamic lists are not known at define time.
function value_problem(param: ParamDef, value: unknown): string | null {
  const type_ok =
    (param.type === "int" && Number.isInteger(value)) ||
    (param.type === "float" && typeof value === "number" && Number.isFinite(value)) ||
    (param.type === "bool" && typeof value === "boolean") ||
    ((param.type === "string" || param.type === "enum") && typeof value === "string");
  if (!type_ok) return `${JSON.stringify(value)} is not a ${param.type}`;
  const list = static_values(param);
  if (param.type === "enum" && list && !list.includes(value as string)) {
    return `${JSON.stringify(value)} is not one of ${list.join(", ")}`;
  }
  return null;
}

function check_when(input: CommandInput, param: ParamDef, at: string, fail: Fail): void {
  const keys = Object.keys(param.when ?? {});
  if (keys.length !== 1) fail(`${at}.when`, "must name exactly one other param");
  const sibling_name = keys[0] as string;
  if (sibling_name === param.name) fail(`${at}.when`, "must not name the param itself");
  const sibling = find_param(input, sibling_name);
  if (!sibling) return fail(`${at}.when`, `names "${sibling_name}", which is not a param`);
  const allowed: readonly ParamValue[] = param.when?.[sibling_name] ?? [];
  if (allowed.length === 0) fail(`${at}.when.${sibling_name}`, "must list at least one value");
  for (const value of allowed) {
    const problem = value_problem(sibling, value);
    if (problem) fail(`${at}.when.${sibling_name}`, problem);
  }
}

function check_count_and_modes(input: CommandInput, fail: Fail): void {
  if (input.runs_in !== "background" && input.runs_in !== "content") fail("runs_in", "must be background or content");
  if (typeof input.count === "object" && !find_param(input, input.count.param)) {
    fail("count", `names "${input.count.param}", which is not a param`);
  }
  if (input.count !== undefined && typeof input.count !== "object" && input.count !== "repeat" && input.count !== "ignore") {
    fail("count", `unknown rule "${String(input.count)}"`);
  }
  for (const mode of input.modes ?? []) {
    if (!MODES.includes(mode)) fail("modes", `unknown mode "${String(mode)}"`);
  }
  if (input.modes?.length === 0) fail("modes", "must not be empty");
  if (input.needs?.some((need) => need === "")) fail("needs", "must not hold an empty name");
}
