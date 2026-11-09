// Which keys hint mode takes itself. key_flow reads this to hold those keys while the hints bundle loads, so the typing side and the hold rule share one source.
// Backspace edits what was typed and Escape leaves the mode through the hint keymap. key_flow holds Backspace always and Escape as a bound key, so neither is listed here.

// A label character. Hint mode takes it and drops a slip that continues no label.
export const is_hint_char = (token: string): boolean => token.length === 1;
