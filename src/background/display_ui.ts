// Whether the display host currently draws the mode badge, which the page keymap answer reads. Kept apart from the host client so `page_keymap.ts` needs no import of it.

let hidden = false;

export const set_badge_hidden = (value: boolean): void => void (hidden = value);
export const badge_hidden = (): boolean => hidden;
