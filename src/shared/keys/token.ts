// Normalized key tokens. The compiler, the matcher and the content script all
// use this file, so a sequence in the keymap and a keydown event meet in one form.
//
// A token is one of:
//   - a single printable character, for example `j`, `J`, `$`, `<`. Shift is already in the character.
//   - `<MODS-name>` for a chord or a named key. MODS is any of A (Alt), C (Ctrl), M (Meta), S (Shift),
//     in alphabetical order, and is left out when empty, as in `<Escape>`. `name` is a key name such
//     as `Escape`, `F1`, `Space`, or one character: a lowercase letter or punctuation.
//
// Shift rules: a printable character keeps its Shift in the character (`J`, not `<S-j>`).
// With Ctrl, Alt or Meta, a letter is lowercase and Shift shows as `S`, for example `<CS-j>`.
// Shift on a non-letter printable character is dropped, because the layout decides it (`!`, not `<S-1>`).
//
// Layout: the token follows `event.key`, so a character binding means the character the user types.
// A Ctrl/Alt/Meta chord on a letter from another script falls back to `event.code`, so `<C-d>` still works
// on a Cyrillic layout. A plain letter of another script keeps its own token. The setting `layout_fallback` lets the
// caller swap in `physical_token` when the typed token binds nothing, so Cyrillic text and `f` targets still work.

export type KeyEventLike = {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

const MODIFIER_KEY_NAMES = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "OS", "CapsLock", "Dead", "Unidentified", "Process"]);

const is_letter = (char: string) => char.toLowerCase() !== char.toUpperCase();

// A chord carries Ctrl, Alt or Meta. Shift alone is a plain key (`J`, `<S-Escape>`). The modifiers come in alphabetical order, so Shift is never first in a chord.
export const is_chord = (token: string): boolean => /^<[ACM][ACMS]*-/.test(token);

export function format_token(mods: string, name: string): string {
  return mods === "" && name.length > 1 ? `<${name}>` : mods === "" ? name : `<${mods}-${name}>`;
}

// The Latin letter on the physical key of a plain letter from another script, or null. Shift makes it upper case.
export function physical_token(event: KeyEventLike): string | null {
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  return letter && /^[^\x00-\x7f]$/u.test(event.key) && is_letter(event.key) ? (event.shiftKey ? letter : letter.toLowerCase()) : null;
}

// Returns null for a key press that is only a modifier or has no usable key.
export function event_to_token(event: KeyEventLike): string | null {
  let key = event.key;
  if (MODIFIER_KEY_NAMES.has(key)) return null;
  if (key === " ") key = "Space";

  const is_single_char = [...key].length === 1;
  const has_command_modifier = event.ctrlKey || event.altKey || event.metaKey;
  let shift = event.shiftKey;

  if (is_single_char) {
    if (has_command_modifier && is_letter(key) && !/^[a-z]$/i.test(key)) {
      const code_letter = /^Key([A-Z])$/.exec(event.code);
      if (code_letter) key = code_letter[1]!;
    }
    if (is_letter(key)) {
      if (has_command_modifier) key = key.toLowerCase();
      else shift = false;
    } else {
      shift = false;
    }
  }

  const mods = (event.altKey ? "A" : "") + (event.ctrlKey ? "C" : "") + (event.metaKey ? "M" : "") + (shift ? "S" : "");
  return format_token(mods, key);
}
