// The register names and the one check every register user shares: the store, `:registers`, and later the `"<reg>`
// prefix, `q<reg>` and `@<reg>`. A name is one key, except the direction of the last search.

export const UNNAMED_REGISTER = '"';
export const CLIPBOARD_REGISTER = "+";
export const BLACK_HOLE_REGISTER = "_";
export const SEARCH_QUERY_REGISTER = "/";
export const SEARCH_DIRECTION_REGISTER = "/:direction";

// `a-z` set a register, `A-Z` append to the lowercase one. The rest are the special registers.
export type RegisterKind = "named" | "append" | "unnamed" | "clipboard" | "black_hole" | "search_query" | "search_direction";

export function register_kind(name: string): RegisterKind | undefined {
  if (/^[a-z]$/.test(name)) return "named";
  if (/^[A-Z]$/.test(name)) return "append";
  if (name === UNNAMED_REGISTER) return "unnamed";
  if (name === CLIPBOARD_REGISTER) return "clipboard";
  if (name === BLACK_HOLE_REGISTER) return "black_hole";
  if (name === SEARCH_QUERY_REGISTER) return "search_query";
  if (name === SEARCH_DIRECTION_REGISTER) return "search_direction";
  return undefined;
}

// The register a name reads and writes: `A` appends to `a`, so both are `a`.
export const storage_name = (name: string): string => name.toLowerCase();

// The only names a macro may record into or play from. The special registers are reserved, and so is `@`, which `@@` will use for the last macro played.
export const is_macro_register = (name: string): boolean => /^[a-zA-Z]$/.test(name);
// The same set as a param pattern. `macro.record` takes it.
export const MACRO_REGISTER_PATTERN = "^[a-zA-Z]$";

// For a param of the register commands, which check names in the schema.
export const REGISTER_NAME_PATTERN = '^\\s*(?:[A-Za-z"+_/]|/:direction)\\s*$';

// The one key that names a register after `"` or `<C-r>`.
export const REGISTER_KEY = /^[A-Za-z"+_/]$/;
