// The quickmark keys and limits the commands, the store, the config check and the which-key rows share.

// A quickmark key is one letter or digit. `go<key>` and `gn<key>` read it as a key press, so it is never a prefix of anything.
export const QUICKMARK_KEY = /^[a-zA-Z0-9]$/;

export const MAX_QUICKMARK_URL_CHARS = 2048;

// Key to address.
export type QuickmarkTable = Record<string, string>;
