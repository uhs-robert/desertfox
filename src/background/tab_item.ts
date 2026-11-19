// The item mode of a tab. Modes are per frame, but the mode belongs to the tab: the frame that takes `I` is rarely the frame that holds the list, and a key must act the same wherever the focus is. The background remembers which frames are in it and ends them together.
// It lives in `storage.session`, so a restarted background still knows and a browser restart clears it. It reuses the media step message, which the frames already take.

import type { Mode } from "../shared/command.ts";
import { TAB_ITEM_STORAGE_PREFIX } from "./storage_keys.ts";
import { best_effort, keep_chain } from "../shared/swallow.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

// `rejoined` are frames of the hold whose new document has not reported item mode yet: the report that a load makes first says normal. A frame goes in when its new document commits or when a join reply puts it back in the mode, whichever comes first.
export type ItemHold = { frames: number[]; rejoined?: number[] };

export type TabItemDeps = {
  storage: SessionStorage;
  // The `MediaStep` message with `item` set, to one frame or, with no frame, to every frame of the tab that runs the content script. `from` names the reporter that the step skips.
  send_step: (tab_id: number, on: boolean, frame_id?: number, from?: number) => Promise<unknown>;
};

const key_of = (tab_id: number): string => TAB_ITEM_STORAGE_PREFIX + tab_id;

// A hint or the command line opened from the mode returns to it, so a frame that reports one of these has not left.
const KEEPS_THE_MODE: readonly Mode[] = ["item", "hint", "cmdline"];

export function create_tab_item(deps: TabItemDeps) {
  // One read-then-write at a time, so two reports together do not drop each other's change.
  let chain: Promise<unknown> = Promise.resolve();
  const in_turn = <T>(step: () => Promise<T>): Promise<T> => {
    const run = chain.then(step);
    chain = keep_chain(run);
    return run;
  };
  const read = async (tab_id: number): Promise<ItemHold | undefined> => (await deps.storage.get(key_of(tab_id)))[key_of(tab_id)] as ItemHold | undefined;
  // Every frame of the hold leaves the mode, the one that ended it excepted: it left already, and may sit in a field.
  const end = async (tab_id: number, hold: ItemHold, except?: number) => {
    await deps.storage.remove(key_of(tab_id));
    await Promise.all(hold.frames.filter((frame_id) => frame_id !== except).map((frame_id) => best_effort(deps.send_step(tab_id, false, frame_id))));
  };

  return {
    // The mode a frame reports. Any frame can start the hold, and the first report starts the mode in every other frame in normal mode, which then report and join. A frame of the hold that reports a mode that is not item ends it for every frame.
    // `by_step` says that a step or a join reply put the frame in the mode, so its report never starts a hold. It joins any live hold, even one newer than its step, because the tab and the frame are both in the mode.
    reported: (tab_id: number, frame_id: number, mode: Mode, by_step = false): Promise<void> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (mode === "item") {
          if (hold?.frames.includes(frame_id)) {
            if (hold.rejoined?.includes(frame_id)) await deps.storage.set({ [key_of(tab_id)]: { ...hold, rejoined: hold.rejoined.filter((other) => other !== frame_id) } });
            return;
          }
          // The step came from a hold that ended before the frame took it. Starting a hold here would step every other frame back into the mode.
          if (by_step && !hold) return void (await best_effort(deps.send_step(tab_id, false, frame_id)));
          await deps.storage.set({ [key_of(tab_id)]: { ...hold, frames: [...(hold?.frames ?? []), frame_id] } });
          // No list of frames reaches the background, so the step goes to every frame and names the reporter, which skips it.
          if (!hold) await best_effort(deps.send_step(tab_id, true, undefined, frame_id));
          return;
        }
        if (!hold?.frames.includes(frame_id) || KEEPS_THE_MODE.includes(mode)) return;
        if (mode === "normal" && hold.rejoined?.includes(frame_id)) return;
        await end(tab_id, hold, frame_id);
      }),
    // A frame that starts while the hold is on joins it: the reply to its first keymap read carries the mode. The frame goes into the hold in the same turn as the read, so an end after the read sends it the step off.
    join: (tab_id: number, frame_id: number): Promise<boolean> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (!hold) return false;
        const reloaded = hold.frames.includes(frame_id);
        await deps.storage.set({ [key_of(tab_id)]: { frames: reloaded ? hold.frames : [...hold.frames, frame_id], rejoined: [...new Set([...(hold.rejoined ?? []), frame_id])] } satisfies ItemHold });
        return true;
      }),
    // A child frame of the hold that reloads or navigates keeps the tab in the mode. The commit comes before the new document's first report, which says normal before the keymap read rejoins it. The top frame's load ends the hold instead (`navigated`).
    committed: (tab_id: number, frame_id: number): Promise<void> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (frame_id === 0 || !hold?.frames.includes(frame_id) || hold.rejoined?.includes(frame_id)) return;
        await deps.storage.set({ [key_of(tab_id)]: { ...hold, rejoined: [...(hold.rejoined ?? []), frame_id] } satisfies ItemHold });
      }),
    // A load ends the hold in every frame. Firefox sends `status: "loading"` with no `url` when a load starts (docs/firefox-behavior.md). An address change the page makes itself keeps it.
    navigated: (tab_id: number, change: { status?: string | undefined; url?: string | undefined }): Promise<void> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (hold && change.status === "loading" && change.url === undefined) await end(tab_id, hold);
      }),
    forget: (tab_id: number): Promise<void> => in_turn(() => deps.storage.remove(key_of(tab_id))),
  };
}

export type TabItem = ReturnType<typeof create_tab_item>;

export type ItemStartAsk = {
  // The start for a page at this address, undefined where none is wanted (`item_start_for`).
  start_for: (address: string | undefined) => Promise<{ selector?: string } | undefined>;
  tab_now: (tab_id: number) => Promise<{ url?: string | undefined; status?: string | undefined } | undefined>;
  send_start: (tab_id: number, args: { selector?: string }) => Promise<unknown>;
};

// Asks the top frame of a tab whose load completed at `address` to start item mode. The read takes a while, and a tab that has left the address or loads again meanwhile holds another document, which must not take this page's start.
export async function ask_item_start(deps: ItemStartAsk, tab_id: number, address: string | undefined): Promise<void> {
  const start = await deps.start_for(address);
  if (!start) return;
  const tab = await deps.tab_now(tab_id);
  if (address !== undefined && tab?.url === address && tab.status === "complete") await deps.send_start(tab_id, start);
}
