// The tab events the bridge host streams to its subscribers: a tab was activated, changed its title or address, started or stopped
// playing sound, or closed. Each goes up the port as `{ verb: "event", event, ...fields }` while `bridge_share_tabs` is on, and only
// for a tab of a normal window: every event starts from a `normal_tab` lookup, so a private or popup window sends nothing.
// The host makes the `mode` events itself, from the mode messages, so they need no tab sharing.

import type { TabInfo } from "./tab_switch.ts";

// Pages that animate their title (a player's clock, an unread count) change it every second. A tab's title and address
// changes inside this window go out as one event that carries the values at its end.
export const TAB_UPDATE_SETTLE_MS = 250;

export const TABS_OFF_EVENT = { verb: "event", event: "tabs_off" } as const;

export type TabChange = { title?: string | undefined; url?: string | undefined; audible?: boolean | undefined };

export type BridgeEventsDeps = {
  sharing: () => boolean;
  send: (event: object) => void;
  normal_tab: (tab_id: number) => Promise<TabInfo | undefined>;
  // Runs `run` once after `delay_ms` and returns a cancel function.
  after: (run: () => void, delay_ms: number) => () => void;
};

export function create_bridge_events(deps: BridgeEventsDeps) {
  // Tab id to the cancel of its pending update.
  const settling = new Map<number, () => void>();
  // The tabs an event already named to the host. A closed tab can no longer be looked up, so only one of these sends
  // `tab_removed`, which keeps a private tab's id off the port. The host passes a removal only to a subscriber that heard of the tab.
  const announced = new Set<number>();
  // Events go out one after another, so a slow lookup cannot let an update land after the tab's removal.
  let turns: Promise<void> = Promise.resolve();
  const in_turn = (work: () => Promise<void>) => {
    turns = turns.then(work).catch(() => undefined);
    return turns;
  };

  // Sharing is read again after the lookup: it can go off while the lookup runs.
  const send_about = (tab_id: number, event_of: (tab: TabInfo & { windowId: number }) => object) =>
    in_turn(async () => {
      if (!deps.sharing()) return;
      const tab = await deps.normal_tab(tab_id);
      if (!tab || !deps.sharing()) return;
      announced.add(tab_id);
      deps.send({ verb: "event", ...event_of(tab as TabInfo & { windowId: number }) });
    });

  function tab_updated(tab_id: number, change: TabChange): void {
    if (!deps.sharing()) return;
    const { audible } = change;
    if (audible !== undefined) void send_about(tab_id, (tab) => ({ event: "tab_audible", tab_id, window_id: tab.windowId, audible, title: tab.title ?? "", url: tab.url ?? "" }));
    if ((change.title === undefined && change.url === undefined) || settling.has(tab_id)) return;
    settling.set(
      tab_id,
      deps.after(() => {
        settling.delete(tab_id);
        void send_about(tab_id, (tab) => ({ event: "tab_updated", tab_id, window_id: tab.windowId, title: tab.title ?? "", url: tab.url ?? "" }));
      }, TAB_UPDATE_SETTLE_MS),
    );
  }

  function tab_removed(tab_id: number): void {
    settling.get(tab_id)?.();
    settling.delete(tab_id);
    void in_turn(async () => {
      if (announced.delete(tab_id) && deps.sharing()) deps.send({ verb: "event", event: "tab_removed", tab_id });
    });
  }

  // Sharing went off: no pending update may go out, and subscribers learn to forget the tabs. The host deletes its caches on this event.
  function sharing_off(): void {
    for (const cancel of settling.values()) cancel();
    settling.clear();
    announced.clear();
    deps.send(TABS_OFF_EVENT);
  }

  return {
    tab_activated: (tab_id: number) => send_about(tab_id, (tab) => ({ event: "tab_activated", tab_id, window_id: tab.windowId })),
    tab_updated,
    tab_removed,
    sharing_off,
  };
}
