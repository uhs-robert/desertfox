import { define } from "../shared/registry/builtin.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { clean_letters } from "../shared/hints/labels.ts";
import { THEME_STORAGE_KEY } from "../shared/theme/apply.ts";
import type { StoredTheme } from "../shared/theme/apply.ts";
import { get_config } from "../background/config_main.ts";
import { browser_module_call, browser_module_push } from "../background/browser_module_call.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";
import { create_chrome_hints } from "../background/chrome_hints.ts";

// The roles the label sheet reads, for the dark and the light scheme.
const LABEL_ROLES = ["primary", "bg_core", "fg_core"] as const;
const label_colors = (theme: StoredTheme | undefined): string =>
  theme ? JSON.stringify(Object.fromEntries((["dark", "light"] as const).map((scheme) => [scheme, Object.fromEntries(LABEL_ROLES.map((role) => [role, theme[scheme]?.[role]]))]))) : "";

export const chrome_hints = create_chrome_hints({
  // Read at each call: the registry loads this file in Node too, where `browser` is missing.
  storage: { get: (keys) => browser.storage.session.get(keys), set: (items) => browser.storage.session.set(items), remove: (keys) => browser.storage.session.remove(keys) },
  push: browser_module_push,
  call: (kind, args) => browser_module_call.call(kind, args),
  letters: async () => clean_letters((await get_config()).settings.hint_letters),
  colors: async () => label_colors((await browser.storage.local.get(THEME_STORAGE_KEY))[THEME_STORAGE_KEY] as StoredTheme | undefined),
  notify: async (window_id, message) => {
    const [tab] = await browser.tabs.query({ active: true, windowId: window_id });
    await show_toast_on_tab({ tab_id: tab?.id }, "hint.browser", message, "error");
  },
  new_session: () => 1 + Math.floor(Math.random() * 0x7ffffffe),
});

define("hint.browser", {
  label: "Hint browser buttons",
  intent: "Pick a button of Firefox itself by its label. It labels the toolbar buttons, the tabs, the bookmarks toolbar, the sidebar buttons and the menu bar. A button is clicked, a tab is selected, and a menu or a bookmarks folder opens. With the app menu or the downloads panel open, it labels the rows of the panel instead. Escape ends it. Needs the browser module.",
  bridge: false,
  runs_in: "background",
  run: async (ctx) => {
    if (ctx.window_id === undefined) throw new RuntimeRefusal("no active window");
    const result = await chrome_hints.start(ctx.window_id);
    if (!result.ok) throw new RuntimeRefusal(result.error);
  },
});
