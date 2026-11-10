// Turns the engine tree of the config into a flat map keyed by the dotted full name. Runs in the config build only,
// so the extension stores and reads finished engines.
//
// An engine is a TOML table. A table inside it is a child, unless it is `params` or holds only `only` (a narrowing).
// A child inherits every field of its parent and overrides by name. `hosts` is a list of host names, the sites the engine belongs to. `label` and `keyword` do not inherit:
// the label of an engine is the chain of the labels on its path, and a keyword names one engine.

import type { SearchEngine } from "../config.ts";
import { expressions_of, page_requirements, SLOT_EXPRESSION } from "./fill.ts";
import { is_slot_name, SLOT_NAMES } from "./slots.ts";

// One table of the tree, without its child tables. `path` is the dotted full name.
export type EngineNode = { path: string; file: string; fields: Record<string, unknown> };

// A child table cannot take these names. Slot names are free for children (github.repo) but not for vars and params.
const RESERVED_CHILD_NAMES = new Set(["url", "label", "params", "fallback", "hosts", "keyword"]);
const RESERVED_NAMES = new Set([...RESERVED_CHILD_NAMES, ...SLOT_NAMES]);
const PARAM_KEYS = new Set(["default", "values", "children"]);
const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
export const ENGINE_KEYWORD = /^[a-z0-9]{1,8}$/;
const QUERY_PAIR_WITH_ONE_NAME = /^[^=]*=\{([a-z_][a-z0-9_]*)\}$/;

const is_table = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// A table with only an `only` list narrows a param. It is never a child.
const is_narrowing = (value: Record<string, unknown>): boolean => Object.keys(value).join() === "only";

// Splits one file's tables into nodes. The nodes of all files merge per path before they resolve.
export function nodes_of_file(file: string, data: Record<string, unknown>, problems: string[]): EngineNode[] {
  const nodes: EngineNode[] = [];
  const walk = (path: string, table: Record<string, unknown>) => {
    const fields: Record<string, unknown> = {};
    let has_child = false;
    for (const [key, value] of Object.entries(table)) {
      if (key.includes(".") || key === "") {
        problems.push(`${file}: engine name "${path ? `${path}.` : ""}${key}" cannot be empty or hold a dot`);
      } else if (is_table(value) && key !== "params" && !is_narrowing(value)) {
        has_child = true;
        walk(path === "" ? key : `${path}.${key}`, value);
      } else if (path === "") {
        problems.push(`${file}: "${key}" is not an engine table`);
      } else {
        fields[key] = value;
      }
    }
    // A table that only holds children is implicit, as `[github.repo]` makes `github`. Without this, a later file that
    // writes `[github.repo]` would replace the whole `github` node with an empty one.
    if (path !== "" && !(has_child && Object.keys(fields).length === 0)) nodes.push({ path, file, fields });
  };
  walk("", data);
  return nodes;
}

type Origined = { value: string; origin: string };
type ParamDecl = { values: Record<string, string>; default?: string; children: boolean };
type Level = {
  url?: Origined;
  fallback?: Origined;
  hosts?: { value: string[]; origin: string };
  keyword?: Origined;
  vars: Record<string, Origined>;
  params: Record<string, ParamDecl>;
  allowed: Record<string, string[]>;
  assigned: Record<string, Origined>;
  labels: string[];
  // Where this level's own `label` came from. Labels do not inherit, so each level starts without one.
  label_origin?: string;
};

const copy_level = (level: Level): Level => ({
  ...level,
  vars: { ...level.vars },
  params: { ...level.params },
  allowed: { ...level.allowed },
  assigned: { ...level.assigned },
  labels: [...level.labels],
});

export type Resolved = { engines: Record<string, SearchEngine>; problems: string[] };

export function resolve_engines(nodes: EngineNode[]): Resolved {
  const engines: Record<string, SearchEngine> = {};
  const problems: string[] = [];
  const visited = new Set<string>();
  const children_of = new Map<string, EngineNode[]>();
  for (const node of nodes) {
    const parent = node.path.includes(".") ? node.path.slice(0, node.path.lastIndexOf(".")) : "";
    children_of.set(parent, [...(children_of.get(parent) ?? []), node]);
  }

  const read_params = (node: EngineNode, level: Level, where: string) => {
    const declared = node.fields.params;
    if (declared === undefined) return;
    if (!is_table(declared)) {
      problems.push(`${where}: params must be a table of param tables`);
      return;
    }
    for (const [name, raw] of Object.entries(declared)) {
      if (RESERVED_NAMES.has(name)) {
        problems.push(`${where}: param "${name}" is a reserved name`);
        continue;
      }
      const values = is_table(raw) ? raw.values : undefined;
      const valid_values = is_table(values) && Object.values(values).every((value) => typeof value === "string");
      const valid_keys = is_table(raw) && Object.keys(raw).every((key) => PARAM_KEYS.has(key));
      const valid_children = is_table(raw) && (raw.children === undefined || typeof raw.children === "boolean");
      if (!is_table(raw) || !valid_keys || !valid_values || !valid_children) {
        problems.push(`${where}: param "${name}" is { default = "value name", values = { name = "url text" }, children = true|false }`);
        continue;
      }
      const value_names = Object.keys(values as Record<string, string>);
      if (raw.default !== undefined && (typeof raw.default !== "string" || !value_names.includes(raw.default))) {
        problems.push(`${where}: param "${name}" default ${JSON.stringify(raw.default)} is not one of its values (${value_names.join(", ")})`);
        continue;
      }
      level.params[name] = { values: values as Record<string, string>, children: raw.children === true, ...(raw.default === undefined ? {} : { default: raw.default as string }) };
      level.allowed[name] = value_names;
    }
  };

  const read_fields = (node: EngineNode, level: Level) => {
    const origin = `${node.file} [${node.path}]`;
    const where = `${node.file}: [${node.path}]`;
    read_params(node, level, where);
    for (const [key, value] of Object.entries(node.fields)) {
      if (key === "params") continue;
      if (key === "hosts") {
        const is_host_list = Array.isArray(value) && value.length > 0 && value.every((host) => typeof host === "string" && HOST_NAME.test(host));
        if (is_host_list) level.hosts = { value: value as string[], origin };
        else problems.push(`${where}: hosts must be a non-empty list of host names such as "github.com", lower case, with no scheme, path or wildcard`);
      } else if (is_table(value)) {
        narrow(key, value, level, where);
      } else if (typeof value !== "string") {
        problems.push(`${where}: ${key} must be a string`);
      } else if (key === "url") {
        level.url = { value, origin };
      } else if (key === "fallback") {
        level.fallback = { value, origin };
      } else if (key === "keyword") {
        if (ENGINE_KEYWORD.test(value)) level.keyword = { value, origin };
        else problems.push(`${where}: keyword must be one to eight lower case letters or digits, such as "g"`);
      } else if (key === "label") {
        if (value === "") problems.push(`${where}: label cannot be empty`);
        else {
          level.labels[level.labels.length - 1] = value;
          level.label_origin = origin;
        }
      } else if (Object.hasOwn(level.params, key)) {
        if (level.allowed[key]?.includes(value)) level.assigned[key] = { value, origin };
        else problems.push(`${where}: ${key} = "${value}" is outside the declared list (${level.allowed[key]?.join(", ")})`);
      } else if (RESERVED_NAMES.has(key)) {
        problems.push(`${where}: "${key}" is a reserved name`);
      } else {
        level.vars[key] = { value, origin };
      }
    }
  };

  const narrow = (param: string, table: Record<string, unknown>, level: Level, where: string) => {
    const only = table.only;
    if (!Object.hasOwn(level.params, param)) {
      problems.push(`${where}: "${param}" is a table but no param of that name is declared above it`);
    } else if (!Array.isArray(only) || !only.every((item) => typeof item === "string")) {
      problems.push(`${where}: ${param}.only must be a list of value names`);
    } else {
      const outside = (only as string[]).filter((item) => !level.allowed[param]?.includes(item));
      if (outside.length > 0) problems.push(`${where}: ${param}.only names ${outside.join(", ")}, outside the declared list (${level.allowed[param]?.join(", ")})`);
      else level.allowed[param] = (level.allowed[param] ?? []).filter((item) => (only as string[]).includes(item));
    }
  };

  // Replaces vars and params with their text. Slots stay. `used` collects the names read, for the unused param check.
  const expand = (text: string, level: Level, used: Set<string>, where: string, stack: string[] = []): string =>
    text.replace(SLOT_EXPRESSION, (whole, body: string | undefined) => {
      if (whole === "%s") return "{query}";
      if (body === undefined || body.includes("|") || is_slot_name(body)) return whole;
      if (Object.hasOwn(level.params, body)) {
        used.add(body);
        const param = level.params[body]!;
        const key = level.assigned[body]?.value ?? param.default;
        return expand(key === undefined ? "" : (param.values[key] ?? ""), level, used, where, stack);
      }
      const variable = Object.hasOwn(level.vars, body) ? level.vars[body] : undefined;
      if (!variable) return whole;
      used.add(body);
      if (stack.includes(body)) {
        problems.push(`${where}: ${[...stack, body].join(" -> ")} refer to each other`);
        return "";
      }
      return expand(variable.value, level, used, where, [...stack, body]);
    });

  // A query pair whose whole value is one var or param that is empty is left out: "&type=" would ask for a type of nothing.
  const expand_url = (template: string, level: Level, used: Set<string>, where: string): string => {
    const hash = template.indexOf("#");
    const head = hash === -1 ? template : template.slice(0, hash);
    const fragment = hash === -1 ? "" : template.slice(hash);
    const mark = head.indexOf("?");
    const base = mark === -1 ? head : head.slice(0, mark);
    const pairs = (mark === -1 ? [] : head.slice(mark + 1).split("&")).filter((pair) => {
      const name = QUERY_PAIR_WITH_ONE_NAME.exec(pair)?.[1];
      const names_text = name !== undefined && (Object.hasOwn(level.params, name) || Object.hasOwn(level.vars, name));
      // `used` is passed on: a pair left out still read its var, so the unused var check must not report it.
      return !(names_text && expand(`{${name}}`, level, used, where) === "");
    });
    const query = pairs.length === 0 ? "" : `?${pairs.join("&")}`;
    return expand(`${base}${query}${fragment}`, level, used, where);
  };

  const emit = (path: string, level: Level, used: Set<string>) => {
    const where = `${level.url?.origin ?? path}`;
    if (!level.url) {
      problems.push(level.hosts ? `${level.hosts.origin}: hosts on "${path}" belong to no engine: no url on it or above it` : `${path}: no url, set one here or on a parent`);
      return;
    }
    const url = expand_url(level.url.value, level, used, where);
    const unknown = expressions_of(url).flatMap((expression) => expression.alternatives).filter((name) => !is_slot_name(name));
    for (const name of new Set(unknown)) problems.push(`${where}: engine "${path}" uses the unknown slot {${name}} (slots: ${SLOT_NAMES.join(", ")})`);
    for (const piece of url.matchAll(SLOT_EXPRESSION)) {
      const name = piece[1];
      if (name !== undefined && !name.includes("|") && !is_slot_name(name)) used.add(name);
    }
    if (!expressions_of(url).some((expression) => expression.alternatives.includes("query"))) {
      problems.push(`${where}: engine "${path}" has no {query} in its url`);
    }
    const slots = page_requirements(url);
    const origins: Record<string, string> = { url: level.url.origin, label: level.label_origin ?? `${path} (labels on the path)` };
    if (level.fallback) origins.fallback = level.fallback.origin;
    if (level.hosts) origins.hosts = level.hosts.origin;
    if (level.keyword) origins.keyword = level.keyword.origin;
    for (const [name, found] of Object.entries(level.vars)) origins[name] = found.origin;
    for (const [name, found] of Object.entries(level.assigned)) origins[name] = found.origin;
    engines[path] = {
      url,
      label: level.labels.join(": "),
      origins,
      ...(slots.length === 0 ? {} : { slots }),
      ...(level.fallback ? { fallback: level.fallback.value } : {}),
      ...(level.hosts ? { hosts: level.hosts.value } : {}),
      ...(level.keyword ? { keyword: level.keyword.value } : {}),
    };
  };

  // Resolves one engine and its children. Returns the var and param names its subtree read.
  const visit = (path: string, node: EngineNode | undefined, parent: Level, generated?: { param: string; value: string; origin: string }): Set<string> => {
    visited.add(path);
    const level = copy_level(parent);
    delete level.label_origin;
    delete level.keyword;
    const name = path.slice(path.lastIndexOf(".") + 1);
    level.labels.push(generated ? generated.value : name);
    if (generated) level.assigned[generated.param] = { value: generated.value, origin: generated.origin };
    if (node) read_fields(node, level);

    const used = new Set<string>();
    emit(path, level, used);

    const origin = node ? `${node.file} [${path}]` : `generated under ${path}`;
    const generated_children = Object.entries(level.params)
      .filter(([param, decl]) => decl.children && !Object.hasOwn(level.assigned, param))
      .flatMap(([param]) => (level.allowed[param] ?? []).map((value) => ({ param, value, origin })));

    const hand = children_of.get(path) ?? [];
    for (const child of hand) {
      const child_name = child.path.slice(child.path.lastIndexOf(".") + 1);
      if (RESERVED_CHILD_NAMES.has(child_name) || Object.hasOwn(level.vars, child_name) || Object.hasOwn(level.params, child_name)) {
        problems.push(`${child.file}: [${child.path}] child name "${child_name}" is reserved or names a field or param of ${path}`);
        visited.add(child.path);
        continue;
      }
      // A hand child named like a generated one replaces it, so it keeps the value the generated child would assign.
      const replaced = generated_children.find(({ value }) => value === child_name);
      for (const name of visit(child.path, child, level, replaced)) used.add(name);
    }
    const taken = new Set(hand.map((child) => child.path.slice(child.path.lastIndexOf(".") + 1)));
    for (const generated_child of generated_children) {
      if (taken.has(generated_child.value)) continue;
      taken.add(generated_child.value);
      for (const name of visit(`${path}.${generated_child.value}`, undefined, level, generated_child)) used.add(name);
    }

    const declared_here = node && is_table(node.fields.params) ? Object.keys(node.fields.params) : [];
    for (const param of declared_here) {
      if (Object.hasOwn(level.params, param) && !used.has(param)) problems.push(`${node?.file}: [${path}] param "${param}" is not used by any url under it`);
    }
    // Any other string field is a var, so a misspelled field such as `lable` shows up here.
    const vars_here = Object.entries(level.vars).filter(([, found]) => found.origin === origin).map(([name]) => name);
    for (const name of vars_here) {
      if (!used.has(name)) problems.push(`${node?.file}: [${path}] "${name}" is not a field and no url under it uses it as a var`);
    }
    return used;
  };

  const empty: Level = { vars: {}, params: {}, allowed: {}, assigned: {}, labels: [] };
  for (const root of children_of.get("") ?? []) visit(root.path, root, empty);
  for (const node of nodes) {
    if (!visited.has(node.path)) problems.push(`${node.file}: [${node.path}] has no parent engine`);
  }
  return { engines, problems };
}
