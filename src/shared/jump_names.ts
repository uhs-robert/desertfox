// The limits and the entry the jump list shares between its store, its step and the page.

// A jump list entry is a page address (no hash, like a mark) and the scroll offset left behind there.
export type JumpEntry = { url: string; x: number; y: number };

export const MAX_JUMPS = 100;

// Two entries on the same page this close in y are one place.
export const JUMP_SAME_PLACE_PX = 4;
