// Takes the user to an address with a scroll to follow: switch to the tab that has the address, or open it in the current tab, then wait for the page and let the caller push the scroll into its top frame.
// The step answers as soon as the switch or the navigation has started. Waiting for the load would keep the old tab holding its keys while the user already looks at another tab.
// Global mark jumps and the jump list share this. What the push says and what the page asks for stays with the caller, as `Data`.

import { RuntimeRefusal } from "../shared/command.ts";
import { mark_page_url } from "../shared/mark_names.ts";
import { PAGE_READY_TIMEOUT_MS, type PageReady, type PageWatch } from "./page_ready.ts";

export type MarkTab = { id: number; window_id: number; index: number; url: string; incognito: boolean; last_accessed: number; discarded: boolean };

export type TabOrigin = { id: number; window_id: number; incognito: boolean };

// Same privacy and the same address with the hash ignored. The container does not matter. Order: the tab itself, then its window by the newest access (then the lowest index), then the other windows by the newest access (then the lowest id).
export function find_mark_tab(tabs: readonly MarkTab[], mark_url: string, from: TabOrigin): MarkTab | undefined {
  const rank = (tab: MarkTab): number => (tab.id === from.id ? 0 : tab.window_id === from.window_id ? 1 : 2);
  return tabs
    .filter((tab) => tab.incognito === from.incognito && mark_page_url(tab.url) === mark_url)
    .sort((left, right) => rank(left) - rank(right) || right.last_accessed - left.last_accessed || (rank(left) === 1 ? left.index - right.index : left.id - right.id))[0];
}

export type AddressDeps = {
  list_tabs: () => Promise<MarkTab[]>;
  activate_tab: (tab_id: number) => Promise<unknown>;
  focus_window: (window_id: number) => Promise<unknown>;
  // Rejects when Firefox refuses the address.
  navigate: (tab_id: number, url: string) => Promise<unknown>;
  watch: (tab_id: number) => PageWatch;
  show_refusal: (tab_id: number, message: string) => Promise<unknown>;
  // What a push that answered `ok: false` with no message says.
  failed_text: string;
};

// What the caller runs in the top frame of the target tab once its page is ready. The reply is the content script's.
export type PushToTab<Data> = (tab_id: number, data: Data) => Promise<unknown>;

// `armed` is set once the page is ready and the push goes out. Before that the entry only marks the newest step of the tab.
export type Arrival<Data> = { data: Data; armed: boolean };

export function create_address_arrivals<Data>(deps: AddressDeps) {
  const arrivals = new Map<number, Arrival<Data>>();
  // The tab each origin tab sent its newest step to, and the switch or navigation of that step. A newer step of the same origin cancels the older arrival, and its switch starts after the older one ended, so the newest tab is the one left active.
  const targets = new Map<number, number>();
  const switches = new Map<number, Promise<unknown>>();

  const problem_of_page: Record<Exclude<PageReady, "ready" | "gone">, string> = {
    timeout: "The page did not finish loading",
    no_script: "DesertFox does not run on this page, so it cannot scroll",
  };

  async function arrive(tab_id: number, arrival: Arrival<Data>, watch: PageWatch, requires_navigation: boolean, push: PushToTab<Data>): Promise<void> {
    try {
      const result = await watch.done(PAGE_READY_TIMEOUT_MS, { requires_navigation });
      if (result === "gone" || arrivals.get(tab_id) !== arrival) return;
      if (result !== "ready") return void (await deps.show_refusal(tab_id, problem_of_page[result]));
      await run_push(tab_id, arrival, push);
    } finally {
      watch.stop();
      if (arrivals.get(tab_id) === arrival) arrivals.delete(tab_id);
    }
  }

  // Arms the entry and runs the push, whose page asks the background again and scrolls.
  async function run_push(tab_id: number, arrival: Arrival<Data>, push: PushToTab<Data>): Promise<void> {
    try {
      arrival.armed = true;
      const reply = (await push(tab_id, arrival.data)) as { ok?: boolean; message?: string } | undefined;
      if (reply?.ok === false) await deps.show_refusal(tab_id, reply.message ?? deps.failed_text);
    } catch (error) {
      await deps.show_refusal(tab_id, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    } finally {
      // A newer step of the tab owns its own entry.
      if (arrivals.get(tab_id) === arrival) arrivals.delete(tab_id);
    }
  }

  return {
    // `own_window_only` ignores the tabs of other windows.
    find_tab: async (url: string, from: TabOrigin, own_window_only = false): Promise<MarkTab | undefined> =>
      find_mark_tab((await deps.list_tabs()).filter((tab) => !own_window_only || tab.window_id === from.window_id), url, from),
    // The page that was sent here asks again, and takes its armed entry whatever address it ended on. Without this a redirect would match no tab and open the address again, in a loop.
    claim_armed: (tab_id: number, is_same_step: (data: Data) => boolean): Arrival<Data> | undefined => {
      const arrival = arrivals.get(tab_id);
      if (!arrival?.armed || !is_same_step(arrival.data)) return undefined;
      arrivals.delete(tab_id);
      return arrival;
    },
    forget: (tab_id: number): void => void arrivals.delete(tab_id),
    // True from the start of a step to the tab until its page has arrived.
    is_arriving: (tab_id: number): boolean => arrivals.has(tab_id),
    // Pushes into the tab at once, with no navigation to wait for.
    push_now: (tab_id: number, data: Data, push: PushToTab<Data>): void => {
      const own: Arrival<Data> = { data, armed: false };
      arrivals.set(tab_id, own);
      void run_push(tab_id, own, push);
    },
    // Goes to the found tab, or opens `url` in the sender's tab when none was found, and returns when that has started. A refusal of the switch or the open throws.
    go: async (from: TabOrigin, found: MarkTab | undefined, url: string, data: Data, push: PushToTab<Data>): Promise<void> => {
      const target_id = found?.id ?? from.id;
      const next: Arrival<Data> = { data, armed: false };
      // A new step supersedes the unfinished one of this tab, of the target tab and of the tab the origin's last step went to.
      arrivals.delete(from.id);
      const earlier_target = targets.get(from.id);
      if (earlier_target !== undefined) arrivals.delete(earlier_target);
      targets.set(from.id, target_id);
      arrivals.set(target_id, next);
      const earlier_switch = switches.get(from.id) ?? Promise.resolve();
      // Before the step that navigates: right after it the tab still reads as loaded.
      const watch = deps.watch(target_id);
      const own_switch = earlier_switch.catch(() => undefined).then(() => switch_to(from, found, url, next));
      switches.set(from.id, own_switch);
      try {
        await own_switch;
      } catch (error) {
        watch.stop();
        if (arrivals.get(target_id) === next) arrivals.delete(target_id);
        throw error;
      }
      // A discarded tab reads `complete` until it loads, so it waits for the load like a navigation.
      void arrive(target_id, next, watch, !found || found.discarded, push);
    },
  };

  // The switch or the navigation of one step. A step that a newer one superseded does nothing.
  async function switch_to(from: TabOrigin, found: MarkTab | undefined, url: string, own: Arrival<Data>): Promise<void> {
    if (arrivals.get(found?.id ?? from.id) !== own) return;
    if (found) {
      await deps.activate_tab(found.id);
      // A compositor may refuse to raise a window. The tab is active in its window anyway.
      if (found.window_id !== from.window_id) await deps.focus_window(found.window_id).catch(() => undefined);
      return;
    }
    await deps.navigate(from.id, url).catch(() => {
      throw new RuntimeRefusal(`Firefox does not let extensions open ${url}`);
    });
  }
}
