// The mark keys and limits every mark user shares: the commands, the store and the which-key rows.

// `'` and the backtick are one slot: the position before the last mark jump. Only a jump writes it.
export const PREVIOUS_MARK = "'";

// `mark.add` takes a to z. A jump also takes the previous-position keys.
export const MARK_ADD_KEY = /^[a-z]$/;
export const MARK_JUMP_KEY = /^[a-z'`]$/;

export const MAX_MARK_PAGES = 500;
export const MAX_MARK_URL_CHARS = 2048;

// The storage slot of a mark key.
export const mark_slot = (key: string): string => (key === "`" ? PREVIOUS_MARK : key);

// A mark belongs to a page, not to a place in it, so the hash is not part of the address.
export const mark_page_url = (address: string): string => address.split("#")[0] as string;
