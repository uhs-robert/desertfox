// Which paths the files editor may store, shared by the page (to refuse early) and the background (which decides).
// A path outside these shapes is never read by the build, so storing it would only hide a typo.

import { DATA_KINDS } from "./config_build/source_files.ts";
import { check_path, DEFAULT_ZIP_LIMITS, ZipError } from "./zip.ts";

const utf8 = new TextEncoder();
const byte_length = (text: string) => utf8.encode(text).length;

const DATA_DIRS = DATA_KINDS.map((kind) => `${kind}.d`);
const SHAPES: RegExp[] = [
  new RegExp(`^(${DATA_KINDS.join("|")})\\.toml$`),
  new RegExp(`^(${DATA_DIRS.map((dir) => dir.replace(".", "\\.")).join("|")})/[^/.][^/]*\\.toml$`),
  /^style\.css$/,
  /^style\.d\/[^/.][^/]*\.css$/,
  /^themes\/[^/.][^/]*\.toml$/,
  /^snippets\/[^/.][^/]*\.js$/,
];

export const is_snippet_file = (path: string) => path.startsWith("snippets/");

// The reason a path or text cannot be stored, or undefined. The zip rules apply to the path and sizes count UTF-8 bytes, so anything stored can be exported and imported again.
export function edit_problem(path: string, text: string | null, other_files: Record<string, string>): string | undefined {
  try {
    check_path(path, false);
  } catch (error) {
    if (!(error instanceof ZipError)) throw error;
    return `${error.message}.`;
  }
  if (!SHAPES.some((shape) => shape.test(path))) {
    return `${path} is not a config file. Use ${DATA_KINDS[0]}.toml and the other kind files, a .toml file in a kind's .d folder, style.css, style.d/*.css, themes/*.toml or snippets/*.js.`;
  }
  if (text === null) return undefined;
  const { max_entry_bytes, max_total_bytes, max_entries } = DEFAULT_ZIP_LIMITS;
  const size = byte_length(text);
  if (size > max_entry_bytes) return `${path} is too large (limit ${max_entry_bytes} bytes).`;
  const others = Object.entries(other_files).filter(([name]) => name !== path);
  if (!Object.hasOwn(other_files, path) && others.length >= max_entries) return `The config would hold more than ${max_entries} files.`;
  if (others.reduce((total, [, other]) => total + byte_length(other), size) > max_total_bytes) return `The config files would pass ${max_total_bytes} bytes together.`;
  return undefined;
}
