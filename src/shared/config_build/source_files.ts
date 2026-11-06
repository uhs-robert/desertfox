// Parses the config directory from raw file text keyed by relative path ("keymap.d/10-x.toml"):
// the main file of each data kind, then its `.d` files in name order. Rejects names the tool does not know.
// Uses no Node API, so the extension and the build-config tool share it. A directory entry carries a
// trailing slash in its key and an empty text; such an entry is always unknown.

import { parse, TomlError } from "smol-toml";

export const DATA_KINDS = ["keymap", "search_engines", "command_aliases", "settings"] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export type DataLayer = { file: string; data: Record<string, unknown> };

export type SourceFiles = {
  layers: Record<DataKind, DataLayer[]>;
  snippet_files: { file: string; text: string }[];
  css_files: { file: string; text: string }[];
};

// Raw file text by path relative to the config directory, "/" separated.
export type ConfigFiles = Record<string, string>;

export const KNOWN_TOP_LEVEL = new Set<string>([
  ...DATA_KINDS.flatMap((kind) => [`${kind}.toml`, `${kind}.d`]),
  "snippets",
  "style.css",
  "style.d",
  "themes",
]);

// `dir_label` is the config directory as the user knows it. It prefixes every path in a problem message.
export function labeled_path(dir_label: string, relative_path: string): string {
  return dir_label === "" ? relative_path : `${dir_label.replace(/\/+$/, "")}/${relative_path}`;
}

function is_visible(name: string): boolean {
  return !name.startsWith(".");
}

// The sorted names directly inside `dir` ("" for the top level). A nested path counts as its first segment, which then is a directory.
export function entry_names(files: ConfigFiles, dir: string): string[] {
  const prefix = dir === "" ? "" : `${dir}/`;
  const names = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length).split("/")[0]!;
    if (name !== "" && is_visible(name)) names.add(name);
  }
  return [...names].sort();
}

function is_file_entry(files: ConfigFiles, dir: string, name: string): boolean {
  return Object.hasOwn(files, dir === "" ? name : `${dir}/${name}`);
}

export function parse_toml_text(label: string, text: string, problems: string[]): Record<string, unknown> | undefined {
  try {
    // smol-toml builds tables without a prototype. Clone to plain objects, as JSON.parse would give.
    return structuredClone(parse(text));
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    problems.push(`${label}:${error.line}:${error.column}: ${error.message.split("\n")[0]}`);
    return undefined;
  }
}

// The tool no longer reads JSONC. Name the file to write instead of calling it unknown.
function jsonc_problem(path: string): string {
  return `${path}: JSONC is no longer read, use ${path.replace(/\.jsonc$/, ".toml")}`;
}

function parse_data_layers(files: ConfigFiles, dir_label: string, kind: DataKind, problems: string[]): DataLayer[] {
  const paths: string[] = [];
  const main_path = `${kind}.toml`;
  if (is_file_entry(files, "", main_path)) paths.push(main_path);

  const d_dir = `${kind}.d`;
  for (const name of entry_names(files, d_dir)) {
    const path = `${d_dir}/${name}`;
    const label = labeled_path(dir_label, path);
    if (name.endsWith(".toml") && is_file_entry(files, d_dir, name)) paths.push(path);
    else if (name.endsWith(".jsonc")) problems.push(jsonc_problem(label));
    else problems.push(`${label}: unknown file, only .toml files belong in ${kind}.d`);
  }

  const layers: DataLayer[] = [];
  for (const path of paths) {
    const file = labeled_path(dir_label, path);
    const data = parse_toml_text(file, files[path]!, problems);
    if (data) layers.push({ file, data });
  }
  return layers;
}

function parse_text_dir(files: ConfigFiles, dir_label: string, dir: string, extension: string, problems: string[]) {
  const parsed: { file: string; text: string }[] = [];
  for (const name of entry_names(files, dir)) {
    const file = labeled_path(dir_label, `${dir}/${name}`);
    if (name.endsWith(extension) && is_file_entry(files, dir, name)) parsed.push({ file, text: files[`${dir}/${name}`]! });
    else problems.push(`${file}: unknown file, only ${extension} files belong in ${dir}`);
  }
  return parsed;
}

export function parse_source_files(files: ConfigFiles, dir_label: string, problems: string[]): SourceFiles {
  for (const name of entry_names(files, "")) {
    if (KNOWN_TOP_LEVEL.has(name)) continue;
    const label = labeled_path(dir_label, name);
    if (DATA_KINDS.some((kind) => name === `${kind}.jsonc`)) problems.push(jsonc_problem(label));
    else problems.push(`${label}: unknown file or directory (known: ${[...KNOWN_TOP_LEVEL].join(", ")})`);
  }

  const layers = Object.fromEntries(
    DATA_KINDS.map((kind) => [kind, parse_data_layers(files, dir_label, kind, problems)]),
  ) as Record<DataKind, DataLayer[]>;

  const css_files: SourceFiles["css_files"] = [];
  if (is_file_entry(files, "", "style.css")) css_files.push({ file: labeled_path(dir_label, "style.css"), text: files["style.css"]! });
  css_files.push(...parse_text_dir(files, dir_label, "style.d", ".css", problems));

  return { layers, snippet_files: parse_text_dir(files, dir_label, "snippets", ".js", problems), css_files };
}
