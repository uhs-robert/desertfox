// Turns the stored theme into CSS for one surface and keeps it current. Runs in pages and in the lazy content bundles, never in content.js.

import { ROLES } from "./roles.ts";
import type { RoleColors } from "./roles.ts";
import { token_name } from "./tokens.ts";
import { watch_stored } from "../storage_watch.ts";

// The theme in force as `{ dark, light }` role colors, from the `theme` and `light_intensity` settings under any live `set`. Rewritten at every publish.
export const THEME_STORAGE_KEY = "desertfox_theme";

// `style.css` then `style.d/*.css` as text, for the surfaces the content script draws. Rewritten at every publish.
export const USER_CSS_STORAGE_KEY = "desertfox_user_css";

// The light set is already the one `light_intensity` picked.
export type StoredTheme = { dark: RoleColors; light: RoleColors };

// Dark is the base block and light sits under the system's light scheme. A value that is not a string is skipped, because the stored
// value can come from a hand-edited local theme. `selector` is the inner element of the surface: a block on the host would lose to the hex blocks that pages still declare there.
export function theme_css(theme: StoredTheme, selector: string): string {
  const block = (colors: RoleColors) => ROLES.filter((role) => typeof colors?.[role] === "string").map((role) => `${token_name(role)}: ${colors[role]};`).join(" ");
  return `${selector} { ${block(theme.dark)} }\n@media (prefers-color-scheme: light) { ${selector} { ${block(theme.light)} } }`;
}

// How long a surface or page stays hidden for its first reads. A hung read must not hide it for good. A read that returns later still applies.
export const FIRST_READ_DEADLINE_MS = 1000;

// A page stays hidden until every read its entry point started has returned or the deadline has passed, so no default color or missing user
// rule shows first. Without storage nothing returns, so nothing is hidden. Each call returns that read's one-shot release.
let page_reads_pending = 0;
let page_deadline: ReturnType<typeof setTimeout> | undefined;
function show_page(): void {
  clearTimeout(page_deadline);
  page_deadline = undefined;
  document.documentElement.style.visibility = "";
}
function hold_page_for_first_read(): () => void {
  if (typeof browser === "undefined") return () => {};
  document.documentElement.style.visibility = "hidden";
  page_deadline ??= setTimeout(show_page, FIRST_READ_DEADLINE_MS);
  page_reads_pending++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--page_reads_pending === 0) show_page();
  };
}

// A page that is not a shadow root. The sheet goes at the end of the head, so it follows the built-in styles.
export function follow_theme(selector: string): HTMLStyleElement {
  const sheet = document.createElement("style");
  document.head.append(sheet);
  const release = hold_page_for_first_read();
  watch_stored<StoredTheme>(THEME_STORAGE_KEY, (theme) => {
    sheet.textContent = theme ? theme_css(theme, selector) : "";
    release();
  });
  return sheet;
}

// The user's own CSS on a page that is not a shadow root. Call it after `follow_theme`, so the user rules follow the theme sheet and win.
export function follow_user_css(): HTMLStyleElement {
  const sheet = document.createElement("style");
  document.head.append(sheet);
  const release = hold_page_for_first_read();
  watch_stored<string>(USER_CSS_STORAGE_KEY, (css) => {
    sheet.textContent = css ?? "";
    release();
  });
  return sheet;
}
