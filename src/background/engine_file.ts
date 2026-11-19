// The Engines page's own file, `search_engines.d/zz-desertfox.toml`: the engines the page adds, one table each, written whole with `stringify`.
// The page never edits search_engines.toml or another search_engines.d file. An engine one of those defines stays the user's, and the page refuses it by name.

import { stringify } from "smol-toml";
import { with_fallback_engines } from "../shared/config.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { parse_toml_text } from "../shared/config_build/source_files.ts";
import { ConfigRefusal, KEPT_CURRENT } from "./config_reload.ts";

// The host's `engines` kind writes this path and no other. It sorts after the usual numbered search_engines.d files. A hand file named to sort after it cannot hide a page engine, because the page refuses every name a hand file defines.
export const ENGINE_FILE = "search_engines.d/zz-desertfox.toml";

export type EngineTables = Record<string, Record<string, unknown>>;

const is_table = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// The tables of the page's file. The browser copy built, so a file that does not parse only reaches here from a broken build, and it refuses rather than drop the engines.
export function owned_engines(files: ConfigFiles): EngineTables {
  const text = files[ENGINE_FILE];
  if (text === undefined) return {};
  const problems: string[] = [];
  const parsed = parse_toml_text(ENGINE_FILE, text, problems);
  if (!parsed) throw new ConfigRefusal(`${KEPT_CURRENT.layer} ${problems[0]}`, problems);
  return Object.fromEntries(Object.entries(parsed).filter(([, table]) => is_table(table))) as EngineTables;
}

// The tables of a text of the page's file, or none for no file or a text that does not parse. For a folder text the copy never built, such as a record's base.
export function engines_in_text(text: string | null): EngineTables {
  const parsed = text === null ? undefined : parse_toml_text(ENGINE_FILE, text, []);
  return Object.fromEntries(Object.entries(parsed ?? {}).filter(([, table]) => is_table(table))) as EngineTables;
}

// Whether `tables` define the engine of the dotted full name `name` (`gh.repo` is the `repo` table inside `gh`).
// A child that a param generates has no table of its own, so a missing step counts when the table above it declares `params`.
export function holds_engine(tables: Record<string, unknown>, name: string): boolean {
  let node: Record<string, unknown> = tables;
  for (const [index, step] of name.split(".").entries()) {
    if (step === "params") return false;
    const next = node[step];
    if (!is_table(next)) return index > 0 && is_table(node.params);
    node = next;
  }
  return true;
}

// The files with the page's file holding `engines`, or without it when none is left.
// A table the TOML writer refuses (an array holding `null`, from an old browser layer) refuses the change.
export function with_owned_engines(files: ConfigFiles, engines: EngineTables): ConfigFiles {
  const { [ENGINE_FILE]: _old, ...others } = files;
  if (Object.keys(engines).length === 0) return others;
  try {
    return { ...others, [ENGINE_FILE]: engine_file_text(engines) };
  } catch (error) {
    throw new ConfigRefusal(`${KEPT_CURRENT.layer} An engine holds a value that cannot be saved: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const engine_file_text = (engines: EngineTables): string => stringify(engines);

const is_hand_engine_file = (path: string): boolean => path !== ENGINE_FILE && (path === "search_engines.toml" || (path.startsWith("search_engines.d/") && path.endsWith(".toml") && !path.slice("search_engines.d/".length).includes("/")));

// The first search engines file besides the page's own that defines the engine `name`, or undefined.
// A file that does not parse names nothing: the build refuses it anyway.
export function hand_file_defining(files: ConfigFiles, name: string): string | undefined {
  return Object.keys(files)
    .filter(is_hand_engine_file)
    .sort()
    .find((path) => holds_engine(parse_toml_text(path, files[path]!, []) ?? {}, name));
}

// Whether `name` still names an engine once the page's file lacks it: a hand file or a built-in engine has it.
export const engine_resolves_without_owned = (files: ConfigFiles, name: string): boolean => hand_file_defining(files, name) !== undefined || Object.hasOwn(with_fallback_engines({}), name);
