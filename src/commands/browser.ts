import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import type { FocusPage } from "../shared/messages.ts";
import { define } from "../shared/registry/index.ts";
import { require_tab_id } from "./open_target.ts";

const TOP_FRAME_ID = 0;

export type BrowserDeps = {
  window_ids: () => Promise<number[]>;
  close_window: (window_id: number) => Promise<void>;
  focus_window: (window_id: number) => Promise<void>;
  activate_tab: (tab_id: number) => Promise<void>;
  focus_page_content: (tab_id: number, frame_id?: number) => Promise<void>;
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
      if (ctx.window_id === undefined) throw new RuntimeRefusal("No window");
      await deps.focus_window(ctx.window_id);
      await deps.activate_tab(tab_id);
      await deps.focus_page_content(tab_id);
    },
    // Only the top frame acts, on its own iframe element, so it works for a frame of any site. A frame cannot hand focus up itself, because Gecko may give it back to the frame the top page holds as focused.
    // Keys that arrive in the top frame already have the top page, and a focus there would blur an element the user picked.
    exit_frame: async (ctx: CommandContext) => {
      const tab_id = require_tab_id(ctx);
      if (ctx.frame_id === 0) return;
      await deps.focus_page_content(tab_id, TOP_FRAME_ID);
    },
  };
}

export const browser_browser_deps: BrowserDeps = {
  window_ids: async () => (await browser.windows.getAll()).flatMap((window) => (window.id === undefined ? [] : [window.id])),
  close_window: (window_id) => browser.windows.remove(window_id),
  focus_window: async (window_id) => void (await browser.windows.update(window_id, { focused: true })),
  activate_tab: async (tab_id) => void (await browser.tabs.update(tab_id, { active: true })),
  // Pages without a content script reject, which is fine.
  focus_page_content: async (tab_id, frame_id) => {
    await browser.tabs.sendMessage(tab_id, { type: "focus_page" } satisfies FocusPage, frame_id === undefined ? {} : { frameId: frame_id }).catch(() => undefined);
  },
};

const handlers = make_browser_handlers(browser_browser_deps);

define("browser.focus_page", {
  completion: "hidden",
  label: "Focus page",
  intent: "Move focus from the address bar to the page. Firefox has no direct call, so this is a best effort.",
  runs_in: "background",
  repeatable: false,
  run: (ctx) => handlers.focus_page(ctx),
});

define("frame.exit", {
  label: "Focus top page",
  intent: "Return the keys from a frame to the top page. Focus a frame with the frames hint filter or a click.",
  runs_in: "background",
  repeatable: false,
  run: (ctx) => handlers.exit_frame(ctx),
});

define("browser.close_all", {
  label: "Close all windows",
  intent: "Close every browser window, which quits Firefox.",
  runs_in: "background",
  repeatable: false,
  run: () => handlers.close_all(),
});
