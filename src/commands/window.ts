import type { CommandContext } from "../shared/command.ts";
import { define } from "../shared/registry/index.ts";
import { numbered_windows } from "../background/complete_items.ts";
import type { NumberedWindow, WindowLike } from "../background/complete_items.ts";
import { typed_url_target } from "./open_target.ts";

export type WindowDeps = {
  create: (open: { url: string | undefined; private_window: boolean }) => Promise<void>;
  close: (window_id: number) => Promise<void>;
  // False when the closed-window list is empty.
  restore_last_closed_window: () => Promise<boolean>;
  windows: () => Promise<WindowLike[]>;
  // Moves the tab to the end of its kind (pinned or not) in the window, then shows it there.
  move_tab_to_window: (tab_id: number, window_id: number) => Promise<void>;
};

const LEADING_NUMBER = /^(\d+)(?:\s|$)/;

// A bare attach goes to the window that was used last: the one whose active tab was touched most recently.
function last_used_other(windows: readonly NumberedWindow[], current: NumberedWindow): NumberedWindow {
  const others = windows.filter((window) => window.id !== current.id && window.incognito === current.incognito);
  const [first, ...rest] = others;
  if (!first) throw new Error("No other window to move to");
  return rest.reduce((best, window) => (window.last_used > best.last_used ? window : best), first);
}

// `2 GitHub` is what a completion pick puts in the line. Only the number counts, because the title may have changed since the pick.
function window_by_number(windows: readonly NumberedWindow[], text: string): NumberedWindow {
  const number = LEADING_NUMBER.exec(text)?.[1];
  if (number === undefined) throw new Error(`Give a window number, not "${text}"`);
  const found = windows.find((window) => window.number === Number(number));
  if (!found) throw new Error(`No window ${number}`);
  return found;
}

export function make_window_handlers(deps: WindowDeps) {
  return {
    create: (args: { url: string; private: boolean }) =>
      deps.create({ url: args.url === "" ? undefined : args.url, private_window: args.private }),
    close: async (ctx: CommandContext) => {
      if (ctx.window_id === undefined) throw new Error("no active window");
      await deps.close(ctx.window_id);
    },
    attach: async (ctx: CommandContext, args: { window: string }) => {
      if (ctx.window_id === undefined || ctx.tab_id === undefined) throw new Error("no active tab");
      const windows = numbered_windows(await deps.windows());
      const current = windows.find((window) => window.id === ctx.window_id);
      if (!current) throw new Error("no active window");
      const text = args.window.trim();
      const target = text === "" ? last_used_other(windows, current) : window_by_number(windows, text);
      if (target.id === current.id) throw new Error("The tab is already in that window");
      if (target.incognito !== current.incognito) throw new Error("Cannot move a tab between private and normal windows");
      await deps.move_tab_to_window(ctx.tab_id, target.id);
    },
    undo_close: async () => {
      if (!(await deps.restore_last_closed_window())) throw new Error("no closed window to restore");
    },
  };
}

export const browser_window_deps: WindowDeps = {
  create: async ({ url, private_window }) => {
    await browser.windows.create({ ...(url === undefined ? {} : { url }), incognito: private_window });
  },
  close: (window_id) => browser.windows.remove(window_id),
  windows: () => browser.windows.getAll({ populate: true }),
  move_tab_to_window: async (tab_id, window_id) => {
    // Firefox ignores a move of a pinned tab past the pinned area, so a pinned tab goes to the end of the pinned tabs instead.
    const { pinned } = await browser.tabs.get(tab_id);
    const index = pinned ? (await browser.tabs.query({ windowId: window_id, pinned: true })).length : -1;
    await browser.tabs.move(tab_id, { windowId: window_id, index });
    await browser.windows.update(window_id, { focused: true });
    await browser.tabs.update(tab_id, { active: true });
  },
  restore_last_closed_window: async () => {
    const [closed] = (await browser.sessions.getRecentlyClosed()).filter((item) => item.window);
    if (!closed?.window?.sessionId) return false;
    await browser.sessions.restore(closed.window.sessionId);
    return true;
  },
};

const handlers = make_window_handlers(browser_window_deps);

define("window.new", {
  label: "New window",
  intent: "Open a new window. It is blank unless a url is given. With private on, the window is private.",
  params: [
    { name: "url", type: "string", main: true, default: "" },
    { name: "private", type: "bool", default: false, short: "p", description: "Open a private window." },
  ],
  runs_in: "background",
  run: async (_ctx, args) => {
    const { url, private: private_window } = args as { url: string; private: boolean };
    await handlers.create({ url: url.trim() === "" ? "" : await typed_url_target(url), private: private_window });
  },
});

define("window.close", {
  label: "Close window",
  intent: "Close the current window with all its tabs.",
  runs_in: "background",
  run: (ctx) => handlers.close(ctx),
});

define("window.undo_close", {
  label: "Reopen closed window",
  intent: "Reopen the last closed window. A count prefix restores that many.",
  runs_in: "background",
  count: "repeat",
  run: () => handlers.undo_close(),
});

define("tab.attach", {
  label: "Attach tab to window",
  intent: "Move the current tab to another window of the same privacy. Without a window it goes to the one used last.",
  params: [{ name: "window", type: "string", rest: true, main: true, default: "", values: { from: "windows" } }],
  runs_in: "background",
  run: (ctx, args) => handlers.attach(ctx, args as { window: string }),
});
