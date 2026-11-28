import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { numbered_windows } from "../background/complete_items.ts";
import type { NumberedWindow, WindowLike } from "../background/complete_items.ts";
import { read_recent_window_ids } from "../background/window_focus.ts";
import { own_pages_for, typed_url_target } from "./open_target.ts";

export type WindowDeps = {
  create: (open: { url: string | undefined; private_window: boolean }) => Promise<void>;
  close: (window_id: number) => Promise<void>;
  // False when the closed-window list is empty.
  restore_last_closed_window: () => Promise<boolean>;
  windows: () => Promise<WindowLike[]>;
  // Window ids, the one focused last first.
  recent_window_ids: () => Promise<number[]>;
  // Moves the tabs to the end of their kind (pinned or not) in the window, in the given order, then shows the first one there.
  move_tabs_to_window: (tab_ids: number[], window_id: number) => Promise<void>;
};

const LEADING_NUMBER = /^(\d+)(?:\s|$)/;

// A bare attach goes to the window focused last. With no focus record of any candidate it goes to the one whose active tab was touched most recently.
function last_used_other(windows: readonly NumberedWindow[], current: NumberedWindow, recent_ids: readonly number[]): NumberedWindow {
  const others = windows.filter((window) => window.id !== current.id && window.incognito === current.incognito);
  const [first, ...rest] = others;
  if (!first) throw new RuntimeRefusal("No other window to move to");
  const focused = recent_ids.map((id) => others.find((window) => window.id === id)).find((window) => window !== undefined);
  return focused ?? rest.reduce((best, window) => (window.last_used > best.last_used ? window : best), first);
}

// `2 GitHub` is what a completion pick puts in the line. Only the number counts, because the title may have changed since the pick.
function window_by_number(windows: readonly NumberedWindow[], text: string): NumberedWindow {
  const number = LEADING_NUMBER.exec(text)?.[1];
  const found = windows.find((window) => window.number === Number(number));
  if (!found) throw new RuntimeRefusal(`No window ${number}`);
  return found;
}

export function make_window_handlers(deps: WindowDeps) {
  async function attach_target(ctx: CommandContext, window_text: string): Promise<NumberedWindow> {
    if (ctx.window_id === undefined) throw new RuntimeRefusal("no active window");
    const windows = numbered_windows(await deps.windows());
    const current = windows.find((window) => window.id === ctx.window_id);
    if (!current) throw new RuntimeRefusal("no active window");
    const text = window_text.trim();
    const target = text === "" ? last_used_other(windows, current, await deps.recent_window_ids()) : window_by_number(windows, text);
    if (target.id === current.id) throw new RuntimeRefusal("The tab is already in that window");
    if (target.incognito !== current.incognito) throw new RuntimeRefusal("Cannot move a tab between private and normal windows");
    return target;
  }

  return {
    create: (args: { url: string; private: boolean }) =>
      deps.create({ url: args.url === "" ? undefined : args.url, private_window: args.private }),
    close: async (ctx: CommandContext) => {
      if (ctx.window_id === undefined) throw new RuntimeRefusal("no active window");
      await deps.close(ctx.window_id);
    },
    attach: async (ctx: CommandContext, args: { window: string }) => {
      if (ctx.window_id === undefined || ctx.tab_id === undefined) throw new RuntimeRefusal("no active tab");
      await deps.move_tabs_to_window([ctx.tab_id], (await attach_target(ctx, args.window)).id);
    },
    // The selected tabs of the window go where a bare `attach` goes, the first of them shown.
    attach_many: async (ctx: CommandContext, tab_ids: number[]) => {
      await deps.move_tabs_to_window(tab_ids, (await attach_target(ctx, "")).id);
    },
    undo_close: async () => {
      if (!(await deps.restore_last_closed_window())) throw new RuntimeRefusal("no closed window to restore");
    },
  };
}

export const browser_window_deps: WindowDeps = {
  create: async ({ url, private_window }) => {
    await browser.windows.create({ ...(url === undefined ? {} : { url }), incognito: private_window });
  },
  close: (window_id) => browser.windows.remove(window_id),
  windows: () => browser.windows.getAll({ populate: true }),
  recent_window_ids: () => read_recent_window_ids(browser.storage.session),
  move_tabs_to_window: async (tab_ids, window_id) => {
    // Firefox ignores a move of a pinned tab past the pinned area, so pinned tabs go to the end of the pinned tabs instead.
    const tabs = await Promise.all(tab_ids.map((id) => browser.tabs.get(id)));
    const ids_where = (pinned: boolean) => tabs.filter((tab) => tab.pinned === pinned).map((tab) => tab.id!);
    const pinned_ids = ids_where(true);
    if (pinned_ids.length > 0) await browser.tabs.move(pinned_ids, { windowId: window_id, index: (await browser.tabs.query({ windowId: window_id, pinned: true })).length });
    if (pinned_ids.length < tabs.length) await browser.tabs.move(ids_where(false), { windowId: window_id, index: -1 });
    await browser.windows.update(window_id, { focused: true });
    await browser.tabs.update(tab_ids[0]!, { active: true });
  },
  restore_last_closed_window: async () => {
    const [closed] = (await browser.sessions.getRecentlyClosed()).filter((item) => item.window);
    if (!closed?.window?.sessionId) return false;
    await browser.sessions.restore(closed.window.sessionId);
    return true;
  },
};

const handlers = make_window_handlers(browser_window_deps);
export const attach_many_tabs = handlers.attach_many;

define("window.new", {
  label: "New window",
  intent: "Open a new window. It is blank unless a url is given. With private on, the window is private.",
  params: [
    { name: "url", type: "string", main: true, optional: true },
    { name: "private", type: "bool", default: false, short: "p", description: "Open a private window." },
  ],
  bridge: false,
  runs_in: "background",
  run: async (ctx, args) => {
    const { url, private: private_window } = args;
    await handlers.create({ url: url.trim() === "" ? "" : await typed_url_target(url, own_pages_for(ctx)), private: private_window });
  },
});

define("window.close", {
  label: "Close window",
  intent: "Close the current window with all its tabs.",
  bridge: false,
  runs_in: "background",
  run: (ctx) => handlers.close(ctx),
});

define("window.undo_close", {
  label: "Reopen closed window",
  intent: "Reopen the last closed window. A count prefix restores that many.",
  bridge: false,
  runs_in: "background",
  count: "repeat",
  run: () => handlers.undo_close(),
});

define("tab.attach", {
  label: "Attach tab to window",
  intent: "Move the current tab to another window of the same privacy. Without a window it goes to the one used last.",
  params: [{ name: "window", type: "string", rest: true, main: true, optional: true, values: { from: "windows" }, pattern: "^\\s*\\d+(\\s|$)" }],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handlers.attach(ctx, args),
});
