import type { CommandContext } from "../shared/command.ts";
import type { FocusPage } from "../shared/messages.ts";
import { define } from "../shared/registry/index.ts";
import { require_tab_id } from "./open_target.ts";

export type BrowserDeps = {
  window_ids: () => Promise<number[]>;
  close_window: (window_id: number) => Promise<void>;
  focus_window: (window_id: number) => Promise<void>;
  activate_tab: (tab_id: number) => Promise<void>;
  focus_page_content: (tab_id: number) => Promise<void>;
};

export function make_browser_handlers(deps: BrowserDeps) {
  return {
    close_all: async () => {
      await Promise.all((await deps.window_ids()).map((window_id) => deps.close_window(window_id)));
    },
    // Firefox has no call that moves focus out of the address bar. Re-focusing the window and tab, then the
    // page, is the best attempt. The key test decides whether it works.
    focus_page: async (ctx: CommandContext) => {
      const tab_id = require_tab_id(ctx);
      if (ctx.window_id === undefined) throw new Error("No window");
      await deps.focus_window(ctx.window_id);
      await deps.activate_tab(tab_id);
      await deps.focus_page_content(tab_id);
    },
  };
}

export const browser_browser_deps: BrowserDeps = {
  window_ids: async () => (await browser.windows.getAll()).flatMap((window) => (window.id === undefined ? [] : [window.id])),
  close_window: (window_id) => browser.windows.remove(window_id),
  focus_window: async (window_id) => void (await browser.windows.update(window_id, { focused: true })),
  activate_tab: async (tab_id) => void (await browser.tabs.update(tab_id, { active: true })),
  // Pages without a content script reject, which is fine.
  focus_page_content: async (tab_id) => {
    await browser.tabs.sendMessage(tab_id, { type: "focus_page" } satisfies FocusPage).catch(() => undefined);
  },
};

const handlers = make_browser_handlers(browser_browser_deps);

define("browser.focus_page", {
  name: "focuspage",
  label: "Focus page",
  intent: "Move focus from the address bar to the page. Firefox has no direct call, so this is a best effort.",
  runs_in: "background",
  run: (ctx) => handlers.focus_page(ctx),
});

define("browser.close_all", {
  name: "quitall",
  label: "Close all windows",
  intent: "Close every browser window, which quits Firefox.",
  runs_in: "background",
  run: () => handlers.close_all(),
});
