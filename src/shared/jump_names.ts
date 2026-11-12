// The limits and the entry the jump list shares between its store, its step and the page.

import { mark_page_url } from "./mark_names.ts";

// A jump list entry is a page address (no hash, like a mark) and the scroll offset left behind there.
export type JumpEntry = { url: string; x: number; y: number };

export const MAX_JUMPS = 100;

// Two entries on the same page this close in both x and y are one place.
export const JUMP_SAME_PLACE_PX = 4;

export const url_origin = (url: string): string => new URL(url).origin;

// The place `offset` names, when its address matches the tab's under `address_of`: by default the same page.
export function place_in_tab(offset: JumpEntry, tab_url: string, address_of: (url: string) => string = mark_page_url): JumpEntry | undefined {
  return address_of(offset.url) === address_of(tab_url) ? { url: mark_page_url(offset.url), x: offset.x, y: offset.y } : undefined;
}
