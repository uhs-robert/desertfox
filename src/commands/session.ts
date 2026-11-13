import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { DEFAULT_COOKIE_STORE_ID } from "../shared/container_store.ts";
import type { ToastKind } from "../shared/messages.ts";
import { define } from "../shared/registry/builtin.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";
import { is_openable } from "./open_target.ts";
import { browser_session_storage, make_session_store, NEW_NAME_PATTERN, plan_restore } from "../background/session_store.ts";
import type { ContainerRef, SessionStore, SessionTab } from "../background/session_store.ts";
import { ignore_refusal } from "../shared/swallow.ts";

// A tab of the window being saved.
export type LiveTab = {
  index: number;
  url: string | undefined;
  title: string | undefined;
  pinned: boolean;
  active: boolean;
  cookie_store_id: string | undefined;
};

export type OpenTab = {
  window_id: number;
  url: string;
  // Only used with `discarded`, because Firefox shows a title only for a tab it did not load.
  title: string;
  // Absent when the tab goes to the end of the window.
  index: number | undefined;
  active: boolean;
  discarded: boolean;
  // Never set together with `discarded`: Firefox refuses that pair.
  pinned: boolean;
  cookie_store_id: string | undefined;
};

export type SessionDeps = {
  store: SessionStore;
  is_private: (ctx: CommandContext) => Promise<boolean>;
  window_tabs: (window_id: number) => Promise<LiveTab[]>;
  containers: () => Promise<ContainerRef[]>;
  // A new window with one blank tab, which the restore removes once the session's tabs are in.
  create_window: () => Promise<{ window_id: number; blank_tab_id: number | undefined }>;
  window_exists: (window_id: number) => Promise<boolean>;
  // Rejects for an address Firefox does not let an extension open.
  create_tab: (open: OpenTab) => Promise<number>;
  set_pinned: (tab_id: number, pinned: boolean) => Promise<void>;
  activate: (tab_id: number) => Promise<void>;
  remove_tab: (tab_id: number) => Promise<void>;
  close_window: (window_id: number) => Promise<void>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
};

// Not named `where`: that name carries the `-t -b -w` flags and a default of here, which a session has no use for.
export type SessionInto = "window" | "tab";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function make_session_handlers(deps: SessionDeps) {
  async function refuse_private(ctx: CommandContext): Promise<void> {
    if (await deps.is_private(ctx)) throw new RuntimeRefusal("Sessions are not available in private windows");
  }

  async function saved_tabs(window_id: number): Promise<SessionTab[]> {
    // One read of the tabs and one of the containers. A tab that closes after them stays in the session, and nothing asks for it again.
    const [tabs, containers] = await Promise.all([deps.window_tabs(window_id), deps.containers()]);
    const names = new Map(containers.map((container) => [container.id, container.name]));
    return tabs
      .filter((tab) => tab.url !== undefined && tab.url !== "")
      .toSorted((a, b) => a.index - b.index)
      .map((tab): SessionTab => {
        const container_id = tab.cookie_store_id === DEFAULT_COOKIE_STORE_ID ? undefined : tab.cookie_store_id;
        const container_name = container_id === undefined ? undefined : names.get(container_id);
        return {
          url: tab.url as string,
          title: tab.title || (tab.url as string),
          pinned: tab.pinned,
          active: tab.active,
          ...(container_id === undefined ? {} : { container_id }),
          ...(container_name === undefined ? {} : { container_name }),
        };
      });
  }

  return {
    save: async (ctx: CommandContext, args: { name: string }) => {
      await refuse_private(ctx);
      if (ctx.window_id === undefined) throw new RuntimeRefusal("No window");
      const tabs = await saved_tabs(ctx.window_id);
      if (tabs.length === 0) throw new RuntimeRefusal("No tabs to save");
      const { name, previous_tabs } = await deps.store.save(args.name, tabs);
      const message =
        previous_tabs === undefined ? `Saved "${name}": ${plural(tabs.length, "tab")}` : `Updated "${name}": ${plural(tabs.length, "tab")}, was ${previous_tabs}`;
      await deps.toast(ctx, "success", message);
    },

    open: async (ctx: CommandContext, args: { name: string; into: SessionInto }) => {
      await refuse_private(ctx);
      if (args.into === "tab" && ctx.window_id === undefined) throw new RuntimeRefusal("No window");
      // The plan comes from the session as it is now. A save of the same name while the tabs open changes the store and not this restore.
      const session = await deps.store.get(args.name);
      const planned = plan_restore(session.tabs, await deps.containers());
      if (planned.length === 0) throw new RuntimeRefusal(`The session "${session.name}" has no tabs`);

      const into_window = args.into === "window";
      const target = into_window ? await deps.create_window() : { window_id: ctx.window_id as number, blank_tab_id: undefined };
      const opened: number[] = [];
      let active_tab_id: number | undefined;
      let window_closed = false;
      for (const tab of planned) {
        // A stored session can come from an imported file, so its addresses pass the same allow-list as any open. A refused one counts as skipped.
        if (!is_openable(tab.url)) continue;
        // Into the current window every tab is discarded and the user's tab stays active. Appending with no index keeps two restores at once from interleaving.
        const discarded = !(into_window && tab.active);
        try {
          const tab_id = await deps.create_tab({
            window_id: target.window_id,
            url: tab.url,
            title: tab.title,
            index: into_window ? opened.length : undefined,
            active: !discarded,
            discarded,
            pinned: tab.pinned && !discarded,
            cookie_store_id: tab.cookie_store_id,
          });
          // A pinned tab is created unpinned and pinned after, because Firefox refuses to create a tab both pinned and discarded.
          if (tab.pinned && discarded) await deps.set_pinned(tab_id, true);
          opened.push(tab_id);
          if (!discarded) active_tab_id = tab_id;
        } catch {
          // Firefox refuses addresses such as about:config for an extension, and the rest go on. A window that is gone ends the restore.
          if (!(await deps.window_exists(target.window_id))) {
            window_closed = true;
            break;
          }
        }
      }
      if (window_closed) throw new RuntimeRefusal(`The window closed while "${session.name}" was opening`);
      const skipped = planned.length - opened.length;
      if (opened.length === 0) {
        if (into_window) await ignore_refusal(deps.close_window(target.window_id));
        throw new RuntimeRefusal(`No tab of "${session.name}" could be opened`);
      }
      // The active tab was one Firefox refused, so the first tab that opened takes its place and loads.
      if (into_window && active_tab_id === undefined) {
        active_tab_id = opened[0] as number;
        await ignore_refusal(deps.activate(active_tab_id));
      }
      if (target.blank_tab_id !== undefined) await ignore_refusal(deps.remove_tab(target.blank_tab_id));

      const lost_container = planned.filter((tab) => tab.container_lost).length;
      const notes = [skipped > 0 ? `skipped ${skipped}` : "", lost_container > 0 ? `${plural(lost_container, "tab")} lost their container` : ""].filter(Boolean);
      const message = `Opened "${session.name}": ${plural(opened.length, "tab")}${notes.length > 0 ? `, ${notes.join(", ")}` : ""}`;
      // The user is looking at the new window, so the toast goes on its tab.
      const toast_ctx = into_window ? { ...ctx, tab_id: active_tab_id, frame_id: 0 } : ctx;
      await deps.toast(toast_ctx, notes.length > 0 ? "warning" : "success", message);
    },

    remove: async (ctx: CommandContext, args: { name: string }) => {
      await refuse_private(ctx);
      const name = await deps.store.remove(args.name);
      await deps.toast(ctx, "success", `Deleted "${name}"`);
    },

    rename: async (ctx: CommandContext, args: { name: string; to: string }) => {
      await refuse_private(ctx);
      const { from, to } = await deps.store.rename(args.name, args.to);
      await deps.toast(ctx, "success", `Renamed "${from}" to "${to}"`);
    },
  };
}

export const browser_session_deps: SessionDeps = {
  store: make_session_store(browser_session_storage),
  is_private: async (ctx) => ctx.window_id !== undefined && (await browser.windows.get(ctx.window_id)).incognito,
  window_tabs: async (window_id) =>
    (await browser.tabs.query({ windowId: window_id })).map((tab) => ({
      index: tab.index,
      url: tab.url,
      title: tab.title,
      pinned: tab.pinned,
      active: tab.active,
      cookie_store_id: tab.cookieStoreId,
    })),
  // With containers off the query rejects, and the sessions then carry no container.
  containers: async () => {
    const identities = await ignore_refusal(browser.contextualIdentities.query({}));
    return Array.isArray(identities) ? identities.map((identity) => ({ id: identity.cookieStoreId, name: identity.name })) : [];
  },
  create_window: async () => {
    // A blank page, not the home page, so the new window loads nothing a person did not save.
    const created = await browser.windows.create({ url: "about:blank" });
    if (created.id === undefined) throw new RuntimeRefusal("Firefox did not open a window");
    return { window_id: created.id, blank_tab_id: created.tabs?.[0]?.id };
  },
  window_exists: (window_id) => browser.windows.get(window_id).then(() => true, () => false),
  create_tab: async (open) => {
    const created = await browser.tabs.create({
      windowId: open.window_id,
      url: open.url,
      ...(open.index === undefined ? {} : { index: open.index }),
      active: open.active,
      ...(open.pinned ? { pinned: true } : {}),
      ...(open.discarded ? { discarded: true, ...(open.title === "" ? {} : { title: open.title }) } : {}),
      ...(open.cookie_store_id === undefined ? {} : { cookieStoreId: open.cookie_store_id }),
    });
    if (created.id === undefined) throw new RuntimeRefusal("Firefox did not open a tab");
    return created.id;
  },
  set_pinned: async (tab_id, pinned) => void (await browser.tabs.update(tab_id, { pinned })),
  activate: async (tab_id) => void (await browser.tabs.update(tab_id, { active: true })),
  remove_tab: (tab_id) => browser.tabs.remove(tab_id),
  close_window: (window_id) => browser.windows.remove(window_id),
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "session", message, kind),
};

const handlers = make_session_handlers(browser_session_deps);

const NAME_PARAM = { name: "name", type: "string", rest: true, main: true, values: { from: "sessions" } } as const;

define("session.save", {
  label: "Save tab session",
  intent: "Save the tabs of this window under a name. An existing name is updated.",
  params: [{ ...NAME_PARAM, pattern: NEW_NAME_PATTERN }],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handlers.save(ctx, args as { name: string }),
});

define("session.open", {
  label: "Open tab session",
  intent: "Open a saved tab session. It opens in a new window unless into is tab.",
  params: [
    NAME_PARAM,
    {
      name: "into",
      type: "enum",
      values: ["window", "tab"],
      default: "window",
      short: { tab: "t" },
      value_labels: { tab: "into this window" },
      description: { tab: "Add the tabs to this window." },
    },
  ],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handlers.open(ctx, args as { name: string; into: SessionInto }),
});

define("session.delete", {
  label: "Delete tab session",
  intent: "Delete a saved tab session.",
  params: [NAME_PARAM],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handlers.remove(ctx, args as { name: string }),
});

define("session.rename", {
  label: "Rename tab session",
  intent: "Rename a saved tab session to the name given by to.",
  params: [NAME_PARAM, { name: "to", type: "string", pattern: NEW_NAME_PATTERN, description: "Give the session this name." }],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handlers.rename(ctx, args as { name: string; to: string }),
});
