// Reads the config directory: the main file of each data kind, then its `.d`
// files in name order. Rejects names the tool does not know.

import { parse, TomlError } from "smol-toml";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const DATA_KINDS = ["keymap", "search_engines", "command_aliases", "settings"] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export type DataLayer = { file: string; data: Record<string, unknown> };

export type SourceFiles = {
  layers: Record<DataKind, DataLayer[]>;
  snippet_files: { file: string; text: string }[];
  css_files: { file: string; text: string }[];
};

const KNOWN_TOP_LEVEL = new Set<string>([
  ...DATA_KINDS.flatMap((kind) => [`${kind}.toml`, `${kind}.d`]),
  "snippets",
  "style.css",
  "style.d",
]);

function sorted_entries(dir: string): string[] {
  return readdirSync(dir).filter((name) => !name.startsWith(".")).sort();
}

function parse_toml_file(path: string, problems: string[]): Record<string, unknown> | undefined {
  try {
    // smol-toml builds tables without a prototype. Clone to plain objects, as JSON.parse would give.
    return structuredClone(parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    problems.push(`${path}:${error.line}:${error.column}: ${error.message.split("\n")[0]}`);
    return undefined;
  }
}

// The tool no longer reads JSONC. Name the file to write instead of calling it unknown.
function jsonc_problem(path: string): string {
  return `${path}: JSONC is no longer read, use ${path.replace(/\.jsonc$/, ".toml")}`;
}

function read_data_layers(config_dir: string, kind: DataKind, problems: string[]): DataLayer[] {
  const paths: string[] = [];
  const main_path = join(config_dir, `${kind}.toml`);
  if (existsSync(main_path)) paths.push(main_path);

  const d_dir = join(config_dir, `${kind}.d`);
  if (existsSync(d_dir)) {
    for (const name of sorted_entries(d_dir)) {
      if (name.endsWith(".toml")) paths.push(join(d_dir, name));
      else if (name.endsWith(".jsonc")) problems.push(jsonc_problem(join(d_dir, name)));
      else problems.push(`${join(d_dir, name)}: unknown file, only .toml files belong in ${kind}.d`);
    }
  }

  const layers: DataLayer[] = [];
  for (const path of paths) {
    const data = parse_toml_file(path, problems);
    if (data) layers.push({ file: path, data });
  }
  return layers;
}

function read_text_dir(dir: string, extension: string, problems: string[]) {
  const files: { file: string; text: string }[] = [];
  if (!existsSync(dir)) return files;
  for (const name of sorted_entries(dir)) {
    const path = join(dir, name);
    if (name.endsWith(extension) && statSync(path).isFile()) files.push({ file: path, text: readFileSync(path, "utf8") });
    else problems.push(`${path}: unknown file, only ${extension} files belong in ${dir.split("/").pop()}`);
  }
  return files;
}

export function read_source_files(config_dir: string, problems: string[]): SourceFiles {
  if (!existsSync(config_dir) || !statSync(config_dir).isDirectory()) {
    problems.push(`${config_dir}: config directory not found`);
    return { layers: { keymap: [], search_engines: [], command_aliases: [], settings: [] }, snippet_files: [], css_files: [] };
  }

  for (const name of sorted_entries(config_dir)) {
    if (KNOWN_TOP_LEVEL.has(name)) continue;
    if (DATA_KINDS.some((kind) => name === `${kind}.jsonc`)) problems.push(jsonc_problem(join(config_dir, name)));
    else problems.push(`${join(config_dir, name)}: unknown file or directory (known: ${[...KNOWN_TOP_LEVEL].join(", ")})`);
  }

  const layers = Object.fromEntries(
    DATA_KINDS.map((kind) => [kind, read_data_layers(config_dir, kind, problems)]),
  ) as Record<DataKind, DataLayer[]>;

  const css_files: SourceFiles["css_files"] = [];
  const main_css = join(config_dir, "style.css");
  if (existsSync(main_css)) css_files.push({ file: main_css, text: readFileSync(main_css, "utf8") });
  css_files.push(...read_text_dir(join(config_dir, "style.d"), ".css", problems));

  return { layers, snippet_files: read_text_dir(join(config_dir, "snippets"), ".js", problems), css_files };
}
