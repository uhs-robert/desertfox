// The jump of a global mark: switch to the tab that has the marked address, or open the address in the current tab, then scroll there.
// The jump answers the key press as soon as the switch or the navigation has started. Waiting for the load would keep the old tab holding its keys while the user already looks at another tab.
// The scroll then comes from the background: it pushes `mark.jump` into the top frame of the target tab, and that page asks for the stored position like any mark jump.

import { RuntimeRefusal } from "../shared/command.ts";
import { mark_page_url } from "../shared/mark_names.ts";
import type { MarkAnswer, MarkJump } from "../shared/messages.ts";
import type { GlobalJump, MarkSender, MarkStore } from "./mark_store.ts";
import { PAGE_READY_TIMEOUT_MS, type PageReady, type PageWatch } from "./page_ready.ts";

export type MarkTab = { id: number; window_id: number; index: number; url: string; incognito: boolean; last_accessed: number; discarded: boolean };

// Same privacy and the same address with the hash ignored. The container does not matter. Order: the tab itself, then its window by the newest access (then the lowest index), then the other windows by the newest access (then the lowest id).
export function find_mark_tab(tabs: readonly MarkTab[], mark_url: string, from: { id: number; window_id: number; incognito: boolean }): MarkTab | undefined {
  const rank = (tab: MarkTab): number => (tab.id === from.id ? 0 : tab.window_id === from.window_id ? 1 : 2);
  return tabs
    .filter((tab) => tab.incognito === from.incognito && mark_page_url(tab.url) === mark_url)
    .sort((left, right) => rank(left) - rank(right) || right.last_accessed - left.last_accessed || (rank(left) === 1 ? left.index - right.index : left.id - right.id))[0];
}

export type GlobalJumpDeps = {
  store: MarkStore;
  list_tabs: () => Promise<MarkTab[]>;
  activate_tab: (tab_id: number) => Promise<unknown>;
  focus_window: (window_id: number) => Promise<unknown>;
  // Rejects when Firefox refuses the address.
  navigate: (tab_id: number, url: string) => Promise<unknown>;
  watch: (tab_id: number) => PageWatch;
  // Runs `mark.jump` for the key in the top frame of the tab. The reply is the content script's.
  push_jump: (tab_id: number, key: string) => Promise<unknown>;
  show_refusal: (tab_id: number, message: string) => Promise<unknown>;
};

// `armed` is set once the page is ready and the push goes out. Before that the entry only marks the newest jump of the tab.
type Arrival = { key: string; armed: boolean };

export function create_global_mark_jump(deps: GlobalJumpDeps): GlobalJump {
  const arrivals = new Map<number, Arrival>();

  const problem_of_page: Record<Exclude<PageReady, "ready" | "gone">, string> = {
    timeout: "The page did not finish loading",
    no_script: "DesertFox does not run on this page, so it cannot scroll",
  };

  async function arrive(tab_id: number, arrival: Arrival, watch: PageWatch, requires_navigation: boolean): Promise<void> {
    try {
      const result = await watch.done(PAGE_READY_TIMEOUT_MS, { requires_navigation });
      if (result === "gone" || arrivals.get(tab_id) !== arrival) return;
      if (result !== "ready") return void (await deps.show_refusal(tab_id, problem_of_page[result]));
      await push(tab_id, arrival);
    } finally {
      watch.stop();
      if (arrivals.get(tab_id) === arrival) arrivals.delete(tab_id);
    }
  }

  // Arms the entry and runs `mark.jump` in the top frame, which asks the background again and scrolls.
  async function push(tab_id: number, arrival: Arrival): Promise<void> {
    try {
      arrival.armed = true;
      const reply = (await deps.push_jump(tab_id, arrival.key)) as { ok?: boolean; message?: string } | undefined;
      if (reply?.ok === false) await deps.show_refusal(tab_id, reply.message ?? "Mark jump failed");
    } catch (error) {
      await deps.show_refusal(tab_id, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    } finally {
      // A newer jump of the tab owns its own entry.
      if (arrivals.get(tab_id) === arrival) arrivals.delete(tab_id);
    }
  }

  return async (request: MarkJump, tab: MarkSender): Promise<MarkAnswer> => {
    if (tab.id === undefined || tab.window_id === undefined) throw new RuntimeRefusal("No tab to jump from");
    const { id: tab_id, window_id } = tab;
    // The page that was sent here by an earlier jump asks again, and gets the stored position whatever address it ended on. Without this a redirect would match no tab and open the address again, in a loop.
    const arrival = arrivals.get(tab_id);
    if (arrival?.armed && arrival.key === request.key) {
      arrivals.delete(tab_id);
      return deps.store.run(request, tab.incognito);
    }
    const mark = await deps.store.global_of(request.key, tab.incognito);
    if (!mark) throw new RuntimeRefusal(`No mark ${request.key}`);
    const found = find_mark_tab(await deps.list_tabs(), mark.url, { id: tab_id, window_id, incognito: tab.incognito });
    // The tab you are on: the scroll is the page's, as for a local mark.
    if (found?.id === tab_id) {
      arrivals.delete(tab_id);
      if (tab.frame_id === 0) return deps.store.run(request, tab.incognito);
      // The frame would scroll its own box and keep its own address, so the top frame jumps instead.
      const own: Arrival = { key: request.key, armed: false };
      arrivals.set(tab_id, own);
      void push(tab_id, own);
      return { ok: true };
    }
    const target_id = found?.id ?? tab_id;
    const next: Arrival = { key: request.key, armed: false };
    // A new jump supersedes the unfinished one of this tab and of the target tab.
    arrivals.delete(tab_id);
    arrivals.set(target_id, next);
    // Before the step that navigates: right after it the tab still reads as loaded.
    const watch = deps.watch(target_id);
    try {
      if (found) {
        await deps.activate_tab(found.id);
        // A compositor may refuse to raise a window. The tab is active in its window anyway.
        if (found.window_id !== window_id) await deps.focus_window(found.window_id).catch(() => undefined);
      } else {
        await deps.navigate(tab_id, mark.url).catch(() => {
          throw new RuntimeRefusal(`Firefox does not let extensions open ${mark.url}`);
        });
      }
    } catch (error) {
      watch.stop();
      if (arrivals.get(target_id) === next) arrivals.delete(target_id);
      throw error;
    }
    // A discarded tab reads `complete` until it loads, so it waits for the load like a navigation.
    void arrive(target_id, next, watch, !found || found.discarded);
    return { ok: true };
  };
}
