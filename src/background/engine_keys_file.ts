// The Engines page's key letters file, `keymap.d/zz-desertfox.toml`: one `[search_keys]` table, letter to engine name, written whole with `stringify`.
// The page never edits keymap.toml or another keymap.d file, and the key editor's own layer stays apart from this file.
// As with the engine file (`engine_file.ts`), the first line is `KEYS_FILE_MARKER`, and a file at that path without it was written by hand.

import { stringify } from "smol-toml";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { parse_toml_text } from "../shared/config_build/source_files.ts";
import { ConfigRefusal, KEPT_CURRENT } from "./config_reload.ts";
import { spelling_of } from "./edit_layers.ts";
import { is_hand_file_at } from "./engine_file.ts";

// The host's `search_keys` kind writes this path and no other. A hand keymap.d file that sorts after it wins for a letter, so the page refuses a letter such a file sets (`keys_file_after_setting`).
export const KEYS_FILE = "keymap.d/zz-desertfox.toml";

export const KEYS_FILE_MARKER = "# Written by the DesertFox Engines page, which rewrites this whole file. Keep hand-written keys in another file.";

// Key letter to engine name, as `[search_keys]` writes it.
export type Letters = Record<string, string>;

export const keys_path_is_hand_file = (files: ConfigFiles): boolean => is_hand_file_at(files, KEYS_FILE, KEYS_FILE_MARKER);

export const hand_file_at_keys_path = () => new ConfigRefusal(`${KEYS_FILE} was not written by the Engines page, so the page does not change it. Rename it, or move its keys to another keymap.d file.`);

const search_keys_of = (parsed: Record<string, unknown> | undefined): Letters => {
  const table = parsed?.search_keys;
  if (typeof table !== "object" || table === null || Array.isArray(table)) return {};
  return Object.fromEntries(Object.entries(table).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
};

// The letters of the page's file, none for a hand file at its path. As with `owned_engines`, a file that does not parse refuses rather than drop the letters.
export function owned_letters(files: ConfigFiles): Letters {
  const text = files[KEYS_FILE];
  if (text === undefined || keys_path_is_hand_file(files)) return {};
  const problems: string[] = [];
  const parsed = parse_toml_text(KEYS_FILE, text, problems);
  if (!parsed) throw new ConfigRefusal(`${KEPT_CURRENT.layer} ${problems[0]}`, problems);
  return search_keys_of(parsed);
}

// The letters of a keys file text, or none for no file or a text that does not parse. For a folder text the copy never built, such as a record's base.
export const letters_in_text = (text: string | null): Letters => (text === null ? {} : search_keys_of(parse_toml_text(KEYS_FILE, text, [])));

const same_letters = (a: Letters, b: Letters): boolean => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([letter, engine]) => b[letter] === engine);

export const keys_file_text = (letters: Letters): string => `${KEYS_FILE_MARKER}\n\n${stringify({ search_keys: letters })}`;

// The files with the page's keys file holding `letters`, or without it when none is left. Letters equal to the file's leave the files as they are, so a hand file at the path refuses only a change of letters.
export function with_owned_letters(files: ConfigFiles, letters: Letters): ConfigFiles {
  if (same_letters(letters, owned_letters(files))) return files;
  if (keys_path_is_hand_file(files)) throw hand_file_at_keys_path();
  const { [KEYS_FILE]: _old, ...others } = files;
  return Object.keys(letters).length === 0 ? others : { ...others, [KEYS_FILE]: keys_file_text(letters) };
}

// The first keymap.d file that loads after the page's and sets `letter` to another engine than `engine`, or undefined. Its letter would win over the page's without a build problem, so only this check sees it.
export function keys_file_after_setting(files: ConfigFiles, letter: string, engine: string): string | undefined {
  return Object.keys(files)
    .filter((path) => path.startsWith("keymap.d/") && path.endsWith(".toml") && !path.slice("keymap.d/".length).includes("/") && path > KEYS_FILE)
    .sort()
    .find((path) => {
      // The compiled tree spells each key one way, so the file's `<C-D>` rebinds the page's `<C-d>`.
      const bound = Object.entries(search_keys_of(parse_toml_text(path, files[path]!, []))).find(([key]) => spelling_of(key) === spelling_of(letter))?.[1];
      return bound !== undefined && bound !== engine;
    });
}
