// Which keys hint mode takes. key_flow reads this to hold only those keys while the hints bundle loads, so the typing side and the hold rule share one source.

// A label character. Hint mode takes it and drops a slip that continues no label.
export const is_hint_char = (token: string): boolean => token.length === 1;

// Backspace edits what was typed, and Escape leaves the mode through the keymap. Every other key reaches the page.
export const hint_mode_takes = (token: string): boolean => is_hint_char(token) || token === "<Backspace>" || token === "<Escape>";
