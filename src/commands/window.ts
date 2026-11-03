import type { CommandContext } from "../shared/command.ts";
import { define } from "../shared/registry/index.ts";

export type WindowDeps = {
  create: (open: { url: string | undefined; private_window: boolean }) => Promise<void>;
  close: (window_id: number) => Promise<void>;
  // False when the closed-window list is empty.
  restore_last_closed_window: () => Promise<boolean>;
};

export function make_window_handlers(deps: WindowDeps) {
  return {
    create: (args: { url: string; private: boolean }) =>
      deps.create({ url: args.url === "" ? undefined : args.url, private_window: args.private }),
    close: async (ctx: CommandContext) => {
      if (ctx.window_id === undefined) throw new Error("no active window");
      await deps.close(ctx.window_id);
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
  restore_last_closed_window: async () => {
    const [closed] = (await browser.sessions.getRecentlyClosed()).filter((item) => item.window);
    if (!closed?.window?.sessionId) return false;
    await browser.sessions.restore(closed.window.sessionId);
    return true;
  },
};

const handlers = make_window_handlers(browser_window_deps);

define("window.new", {
  name: "winnew",
  label: "New window",
  intent: "Open a new window, blank unless a url is given. With private on, the window is private.",
  params: [
    { name: "url", type: "string", main: true, default: "" },
    { name: "private", type: "bool", default: false },
  ],
  runs_in: "background",
  run: (_ctx, args) => handlers.create(args as { url: string; private: boolean }),
});

define("window.close", {
  name: "winclose",
  label: "Close window",
  intent: "Close the current window with all its tabs.",
  runs_in: "background",
  run: (ctx) => handlers.close(ctx),
});

define("window.undo_close", {
  name: "undowin",
  label: "Reopen closed window",
  intent: "Restore the most recently closed window. A count prefix restores that many.",
  runs_in: "background",
  count: "repeat",
  run: () => handlers.undo_close(),
});
