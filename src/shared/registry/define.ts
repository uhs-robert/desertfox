// The registry and its define-time checks. Every rejection throws a
// DefineError that names the command and the field.

import type { CommandDef, DefaultArm, ParamDef, ParamValue } from "../command.ts";
import { MODES } from "../command.ts";
import { always_default, arm_conditions, declared_default, find_param, is_context_source, is_default_list, is_dynamic_values, split_default, static_values } from "./params.ts";
import { is_setting_name } from "../settings_schema.ts";
import { description_problem } from "./summary.ts";

export type CommandInput = CommandDef extends infer D ? (D extends unknown ? Omit<D, "id"> : never) : never;

export class DefineError extends Error {
  constructor(command_id: string, field: string, problem: string) {
    super(`command "${command_id}": ${field}: ${problem}`);
    this.name = "DefineError";
  }
}

export type Registry = {
  // Checks the definition, stores it and returns it with `count`, `modes` and `repeatable` defaults applied.
  // Snippet commands go through the same call, so they share the name check.
  define(id: string, input: CommandInput): CommandDef;
  get(id: string): CommandDef | undefined;
  // Resolves a command line word: a name, an alias or a full id.
  find(word: string): CommandDef | undefined;
  list(): CommandDef[];
  // Frees the id and its words. Only snippets leave the registry: a config reload replaces them.
  remove(id: string): void;
};

export const COMMAND_ID_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const PARAM_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const COMMAND_WORD_PATTERN = /^[^\s'"\\-][^\s'"\\]*$/;
const FLAG_WORD_PATTERN = /^[a-z][a-z0-9_]*$/;
const SHORT_FLAG_PATTERN = /^[A-Za-z]$/;
const PARAM_TYPES = ["int", "float", "string", "bool", "enum", "key"];

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
    check_flags(input, fail);
    check_count_and_modes(input, fail);

    const command: CommandDef = { ...input, id, count: input.count ?? "ignore", modes: input.modes ?? ["normal"], repeatable: input.repeatable ?? true };
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
    remove: (id) => {
      const command = commands_by_id.get(id);
      if (!command) return;
      commands_by_id.delete(id);
      for (const [word, owner] of commands_by_word) if (owner === command) commands_by_word.delete(word);
    },
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
    if (word.includes(".")) fail(field, `"${word}" must not hold a ".", so a typed word is never read as an id`);
    const owner = taken.get(word);
    if (owner) fail(field, `"${word}" is already used by "${owner.id}"`);
    if (word === id || seen.has(word)) fail(field, `"${word}" is used twice in this command`);
    seen.add(word);
  }
}

// The intent is one line. Its first sentence is the summary that lists show and later sentences are detail for the help page. The summary rules (verb first, short, no other command named) are checked over the built-in commands in the registry audit test, because snippets from the user's config go through this check too.
function check_intent(input: CommandInput, fail: Fail): void {
  if (input.intent.trim() === "") fail("intent", "must not be empty");
  if (/[\r\n]/.test(input.intent)) fail("intent", "must be one line");
}

// A bool or an enum value is typed as a long flag (`--word-end`), so those words must be unique per command and must not take over `--help`. A short flag is one letter, unique per command.
function check_flags(input: CommandInput, fail: Fail): void {
  const owner_of_long = new Map<string, string>();
  const owner_of_short = new Map<string, string>();
  for (const param of input.params ?? []) {
    const at = `params.${param.name}`;
    const values = static_values(param);
    const longs = param.type === "bool" ? [param.name] : param.type === "enum" ? (values ?? []) : [];
    for (const value of longs) {
      if (!FLAG_WORD_PATTERN.test(value)) fail(at, `"${value}" must be lowercase with underscores to work as a flag`);
      const flag = value.replaceAll("_", "-");
      if (flag === "help") fail(at, `"${value}" would read as --help, which is reserved`);
      const owner = owner_of_long.get(flag);
      if (owner !== undefined) fail(at, `flag --${flag} is also used by param "${owner}"`);
      owner_of_long.set(flag, param.name);
    }
    if (param.short === undefined) continue;
    if (param.main || param.rest) fail(`${at}.short`, "main and rest params take no flag");
    if (typeof param.short === "string") {
      if (param.type === "enum") fail(`${at}.short`, "an enum takes a map from value to letter");
      add_short(param.short, `${at}.short`);
    } else {
      if (param.type !== "enum" || !values) fail(`${at}.short`, "only an enum with a fixed value list takes a short map");
      for (const [value, letter] of Object.entries(param.short)) {
        if (!values?.includes(value)) fail(`${at}.short.${value}`, "is not one of the values");
        if (always_default(param, value)) fail(`${at}.short.${value}`, "the default value has no short, because the printer leaves it out");
        add_short(letter, `${at}.short.${value}`);
      }
    }
  }

  function add_short(letter: string, field: string): void {
    if (!SHORT_FLAG_PATTERN.test(letter)) fail(field, `"${letter}" must be one letter`);
    if (letter === "h") fail(field, `"h" is reserved for -h`);
    const owner = owner_of_short.get(letter);
    if (owner !== undefined) fail(field, `-${letter} is also used by ${owner}`);
    owner_of_short.set(letter, field);
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
    if (param.verbatim) {
      if (param.type !== "string") fail(`${at}.verbatim`, "only a string param can be verbatim");
      if (!param.main) fail(`${at}.verbatim`, "only the main param can be verbatim");
      if (param.value_of !== undefined) fail(`${at}.verbatim`, "a verbatim param cannot hold a setting value (value_of)");
    }
    if (param.value_of !== undefined) {
      const sibling = find_param(input, param.value_of);
      if (sibling?.strict !== true) fail(`${at}.value_of`, `names "${param.value_of}", which is not a strict string param`);
      else if (!(static_values(sibling) ?? []).every(is_setting_name)) fail(`${at}.value_of`, `names "${param.value_of}", whose values are not all setting names`);
    }
    if (param.when) check_when(input, param, at, fail);
    if (is_default_list(param.default)) check_default_arms(input, param, at, fail);
    if (param.value_when) check_value_when(input, param, at, fail);
  });
  check_default_cycles(input, fail);

  const keys = params.filter((param) => param.type === "key");
  if (keys.length > 1) fail("params.key", `only one param can be a key, found ${keys.map((param) => param.name).join(", ")}, because a binding captures one key press`);
  const mains = params.filter((param) => param.main);
  if (mains.length > 1) fail("params.main", `only one param can be main, found ${mains.map((param) => param.name).join(", ")}`);
  const main = mains[0];
  if (main && main.type !== "string") fail(`params.${main.name}.main`, "only a string param can be main");
}

// Each arm reads one or more siblings like a `when`, all of which must hold. Only the last item may be a plain value, and a param with `when` takes a plain default only.
function check_default_arms(input: CommandInput, param: ParamDef, at: string, fail: Fail): void {
  const list = param.default as readonly unknown[];
  if (list.length === 0) fail(`${at}.default`, "a default list must not be empty");
  if (param.when) fail(`${at}.default`, "a default list cannot be combined with `when` on the same param");
  list.forEach((item, index) => {
    const here = `${at}.default[${index}]`;
    if (item === null || item === undefined) return fail(here, "an arm must be a { value, when } object or a plain value");
    if (typeof item !== "object") {
      if (index !== list.length - 1) fail(here, "a plain value must be the last item, because it matches whatever comes before it");
      return;
    }
    check_when(input, { ...param, when: (item as DefaultArm).when }, here, fail, { allow_several: true });
  });
}

// A rule per enum value. Each default arm must satisfy the rule of its own value, so no default is refused at run time.
function check_value_when(input: CommandInput, param: ParamDef, at: string, fail: Fail): void {
  const values = static_values(param) ?? [];
  if (param.type !== "enum") fail(`${at}.value_when`, "only an enum param can have value_when");
  for (const [value, rule] of Object.entries(param.value_when ?? {})) {
    const here = `${at}.value_when.${value}`;
    if (!values.includes(value)) fail(here, `"${value}" is not one of the param's values`);
    check_when(input, { ...param, when: rule }, here, fail, { allow_several: true });
  }
  const list = param.default;
  // A plain default applies under any sibling value, so its rule must allow every value of each sibling it names.
  const plain = is_default_list(list) ? list[list.length - 1] : list;
  const plain_rule = typeof plain === "string" ? param.value_when?.[plain] : undefined;
  for (const [name, allowed] of Object.entries(plain_rule ?? {})) {
    const sibling_values = static_values(find_param(input, name) as ParamDef) ?? [];
    const refused = sibling_values.filter((value) => !allowed.includes(value));
    if (refused.length > 0 || sibling_values.length === 0) fail(`${at}.default`, `value "${plain}" is refused by value_when under ${name} ${refused.join(", ")}`);
  }
  if (!is_default_list(list)) return;
  list.forEach((item, index) => {
    if (typeof item !== "object" || item === null) return;
    const arm = item as DefaultArm;
    // An arm holds for every combination of its listed values, so each must be allowed, and the arm must name every sibling the rule names.
    const rule = param.value_when?.[String(arm.value)];
    if (!rule) return;
    const outside = Object.entries(rule).flatMap(([name, allowed]) => {
      const listed = arm.when[name];
      return listed === undefined ? [`${name} (the arm does not name it)`] : listed.filter((value) => !allowed.includes(value)).map((value) => `${name} ${value}`);
    });
    if (outside.length > 0) fail(`${at}.default[${index}]`, `value "${arm.value}" is refused by value_when under ${outside.join(", ")}`);
  });
}

// An arm names the siblings it reads, so the arms of all params form a graph that must have no cycle.
function check_default_cycles(input: CommandInput, fail: Fail): void {
  const reads = (name: string): string[] => {
    const declared = find_param(input, name) && declared_default(find_param(input, name) as ParamDef);
    return is_default_list(declared) ? split_default(declared).arms.flatMap((arm) => arm_conditions(arm).map(([name]) => name)) : [];
  };
  const visit = (name: string, path: string[]): void => {
    const loop_at = path.indexOf(name);
    if (loop_at >= 0) fail(`params.${name}.default`, `defaults depend on each other: ${[...path.slice(loop_at), name].join(" -> ")}`);
    for (const next of reads(name)) visit(next, [...path, name]);
  };
  for (const param of input.params ?? []) visit(param.name, []);
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
    if (from !== "search_engines" && from !== "containers" && from !== "tabs" && from !== "bookmarks" && from !== "history" && from !== "open" && from !== "windows" && from !== "headings" && from !== "sessions" && from !== "registers" && from !== "folders" && from !== "marks" && from !== "quickmarks" && from !== "saved_quickmarks" && from !== "anything") fail(`${at}.values`, `unknown source "${String(from)}"`);
  }
  check_rules(param, at, fail);
  check_value_labels(param, at, fail);
  check_description(param, at, fail);
  if (is_default_list(param.default)) {
    param.default.forEach((item, index) => {
      if (item === null || item === undefined) return;
      const problem = value_problem(param, typeof item === "object" ? item.value : item);
      if (problem) fail(`${at}.default[${index}]${typeof item === "object" ? ".value" : ""}`, problem);
    });
  } else if (param.default !== undefined) {
    if (is_context_source(param.default)) {
      if (param.type !== "string") fail(`${at}.default`, "a context source fits only a string param");
    } else {
      const problem = value_problem(param, param.default);
      if (problem) fail(`${at}.default`, problem);
    }
  }
}

function check_rules(param: ParamDef, at: string, fail: Fail): void {
  if (param.optional !== undefined) {
    if (param.type !== "string" && param.type !== "enum") fail(`${at}.optional`, "only a string or enum param can be optional");
    if (param.default !== undefined) fail(`${at}.optional`, "an optional param reads as an empty text, so it takes no `default`");
    if (param.when) fail(`${at}.optional`, "an optional param cannot also carry `when`");
  }
  if (param.min !== undefined) {
    if (param.type !== "int") fail(`${at}.min`, "only an int param takes a minimum");
    else if (!Number.isInteger(param.min)) fail(`${at}.min`, "must be a whole number");
  }
  if (param.max !== undefined) {
    if (param.type !== "int") fail(`${at}.max`, "only an int param takes a maximum");
    else if (!Number.isInteger(param.max)) fail(`${at}.max`, "must be a whole number");
  }
  if (param.pattern !== undefined) {
    if (param.type !== "string" && param.type !== "key") fail(`${at}.pattern`, "only a string or key param takes a pattern");
    try {
      new RegExp(param.pattern);
    } catch {
      fail(`${at}.pattern`, `${JSON.stringify(param.pattern)} is not a regular expression`);
    }
  }
  if (param.format !== undefined && (param.type !== "string" || param.format !== "url")) fail(`${at}.format`, 'only a string param takes the format "url"');
  if (param.value_of !== undefined && param.type !== "string") fail(`${at}.value_of`, "only a string param can hold a setting value");
  if (param.strict !== undefined && (param.type !== "string" || !static_values(param))) {
    fail(`${at}.strict`, "only a string param with a fixed value list can be strict");
  }
}

function check_value_labels(param: ParamDef, at: string, fail: Fail): void {
  if (param.value_labels === undefined) return;
  const list = static_values(param);
  if (param.type !== "enum" || !list) return fail(`${at}.value_labels`, "only an enum with a fixed value list takes value labels");
  for (const [value, phrase] of Object.entries(param.value_labels)) {
    if (!list.includes(value)) fail(`${at}.value_labels.${value}`, "is not one of the values");
    else if (phrase === "" || phrase !== phrase.trim()) fail(`${at}.value_labels.${value}`, "must be a non-empty phrase without edge spaces");
    else if (always_default(param, value)) fail(`${at}.value_labels.${value}`, "the default value has no phrase");
  }
}

// A fixed enum describes each value, any other param describes itself. Whether a flag has one is checked in the registry audit test.
function check_description(param: ParamDef, at: string, fail: Fail): void {
  const description = param.description;
  if (description === undefined) return;
  const list = static_values(param);
  if (typeof description === "string") {
    if (param.type === "enum" && list) return fail(`${at}.description`, "a fixed enum takes a map from value to sentence");
    const problem = description_problem(description);
    if (problem) fail(`${at}.description`, problem);
    return;
  }
  if (!list) return fail(`${at}.description`, "only an enum with a fixed value list takes a map");
  for (const [value, text] of Object.entries(description)) {
    if (!list.includes(value)) fail(`${at}.description.${value}`, "is not one of the values");
    else if (always_default(param, value)) fail(`${at}.description.${value}`, "the default value has no flag to describe");
    const problem = description_problem(text);
    if (problem) fail(`${at}.description.${value}`, problem);
  }
}

// Null when `value` is valid for the param. Dynamic lists are not known at define time.
function value_problem(param: ParamDef, value: unknown): string | null {
  const type_ok =
    (param.type === "int" && Number.isInteger(value)) ||
    (param.type === "float" && typeof value === "number" && Number.isFinite(value)) ||
    (param.type === "bool" && typeof value === "boolean") ||
    ((param.type === "string" || param.type === "enum") && typeof value === "string") ||
    (param.type === "key" && typeof value === "string" && [...value].length === 1);
  if (!type_ok) return `${JSON.stringify(value)} is not a ${param.type}`;
  const list = static_values(param);
  if (param.type === "enum" && list && !list.includes(value as string)) {
    return `${JSON.stringify(value)} is not one of ${list.join(", ")}`;
  }
  if (param.type === "int" && param.min !== undefined && (value as number) < param.min) return `${JSON.stringify(value)} is below the minimum ${param.min}`;
  if (param.type === "int" && param.max !== undefined && (value as number) > param.max) return `${JSON.stringify(value)} is above the maximum ${param.max}`;
  if ((param.type === "string" || param.type === "key") && param.pattern !== undefined && !new RegExp(param.pattern).test(value as string)) return `${JSON.stringify(value)} does not match ${param.pattern}`;
  if (param.type === "string" && param.format === "url" && !URL.canParse(value as string)) return `${JSON.stringify(value)} is not an address`;
  if (param.type === "string" && param.strict && list && !list.includes(value as string)) return `${JSON.stringify(value)} is not one of ${list.join(", ")}`;
  return null;
}

// A param's own `when` names exactly one sibling. An arm of a default list may name several, which must all hold.
function check_when(input: CommandInput, param: ParamDef, at: string, fail: Fail, { allow_several = false } = {}): void {
  const entries = Object.entries(param.when ?? {});
  if (entries.length === 0) fail(`${at}.when`, allow_several ? "must name at least one other param" : "must name exactly one other param");
  if (entries.length > 1 && !allow_several) fail(`${at}.when`, "must name exactly one other param");
  for (const [sibling_name, allowed] of entries) {
    if (sibling_name === param.name) fail(`${at}.when`, "must not name the param itself");
    const sibling = find_param(input, sibling_name);
    if (!sibling) fail(`${at}.when`, `names "${sibling_name}", which is not a param`);
    if (allowed.length === 0) fail(`${at}.when.${sibling_name}`, "must list at least one value");
    for (const value of allowed) {
      const problem = value_problem(sibling, value);
      if (problem) fail(`${at}.when.${sibling_name}`, problem);
    }
  }
}

function check_count_and_modes(input: CommandInput, fail: Fail): void {
  if (input.runs_in !== "background" && input.runs_in !== "content") fail("runs_in", "must be background or content");
  if (input.bundle !== undefined && input.runs_in !== "content") fail("bundle", "belongs to a content command");
  if (input.runs_in === "content" && input.run) fail("run", "belongs to a background command, since content code lives in the page");
  if (input.runs_in === "background" && !input.run) fail("run", "is missing");
  if (typeof input.count === "object" && !find_param(input, input.count.param)) {
    fail("count", `names "${input.count.param}", which is not a param`);
  }
  if (input.count !== undefined && typeof input.count !== "object" && input.count !== "repeat" && input.count !== "ignore") {
    fail("count", `unknown rule "${String(input.count)}"`);
  }
  if (input.repeat_limit !== undefined) {
    if (!Number.isInteger(input.repeat_limit) || input.repeat_limit < 1) fail("repeat_limit", "must be a positive whole number");
    else if (input.count === undefined || input.count === "ignore") fail("repeat_limit", "needs a count rule, because it limits the count");
  }
  for (const mode of input.modes ?? []) {
    if (!MODES.includes(mode)) fail("modes", `unknown mode "${String(mode)}"`);
  }
  if (input.modes?.length === 0) fail("modes", "must not be empty");
  if (input.completion !== undefined && input.completion !== "hidden") {
    for (const mode of input.completion) if (!MODES.includes(mode)) fail("completion", `unknown mode "${String(mode)}"`);
    if (input.completion.length === 0) fail("completion", 'must not be empty, use "hidden"');
  }
  if (input.needs?.some((need) => need === "")) fail("needs", "must not hold an empty name");
}
