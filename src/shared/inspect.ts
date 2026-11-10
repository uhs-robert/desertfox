// What the background relay and the hints bundle agree on for the Inspector handoff.

// How long a pick lives: the relay keeps a pick for a closed toolbox this long, and the page property goes after the same time.
export const PICK_EXPIRY_MS = 60_000;

export const TOOLBOX_CLOSED_MESSAGE = "DevTools is closed: press F12 within 60 s to inspect";

// `waiting` means no toolbox was open, so the pick is queued and F12 completes it.
export type InspectAnswer = { ok: true; waiting?: true } | { ok: false; message: string };
