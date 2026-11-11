// The media mode of a tab. Modes are per frame, but the mode belongs to the tab: the frame that takes `aa` is rarely the frame that holds the video, so the background remembers which frames are in it and ends them together.
// It lives in `storage.session`, so a restarted background still knows and a browser restart clears it.

import type { Mode } from "../shared/command.ts";
import { TAB_MEDIA_STORAGE_PREFIX } from "./storage_keys.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

// `pin_frame` is the frame whose video `;M` pinned. The video itself is a weak reference in that frame's page.
export type MediaHold = { frames: number[]; pin_frame?: number };

export type TabMediaDeps = {
  storage: SessionStorage;
  // Rejects for a frame that is gone, which the caller ignores.
  send_mode: (tab_id: number, frame_id: number, mode: "media") => Promise<unknown>;
  // The `MediaStep` message, to one frame or, with no frame, to every frame of the tab that runs the content script.
  send_step: (tab_id: number, on: boolean, frame_id?: number) => Promise<unknown>;
};

const key_of = (tab_id: number): string => TAB_MEDIA_STORAGE_PREFIX + tab_id;

// A hint or the command line opened from the media mode returns to it, so a frame that reports one of these has not left.
const KEEPS_THE_MODE: readonly Mode[] = ["media", "hint", "cmdline"];

export function create_tab_media(deps: TabMediaDeps) {
  // One read-then-write at a time per background, so two reports together do not drop each other's change.
  let chain: Promise<unknown> = Promise.resolve();
  const in_turn = <T>(step: () => Promise<T>): Promise<T> => {
    const run = chain.then(step);
    chain = run.catch(() => undefined);
    return run;
  };
  const read = async (tab_id: number): Promise<MediaHold | undefined> => (await deps.storage.get(key_of(tab_id)))[key_of(tab_id)] as MediaHold | undefined;
  // Every frame of the hold leaves the mode, the one that ended it excepted. A frame with a hint or the line open keeps it, and closing it lands in normal mode.
  const end = async (tab_id: number, hold: MediaHold, except?: number) => {
    await deps.storage.remove(key_of(tab_id));
    await Promise.all(hold.frames.filter((frame_id) => frame_id !== except).map((frame_id) => deps.send_step(tab_id, false, frame_id).catch(() => undefined)));
  };

  return {
    // `aa`: starts the mode on the frame that took the key. A new start drops an old pin. The frame joins the hold when it reports the mode, because a report of normal that left before the mode arrived must not end the hold.
    enter: (tab_id: number, frame_id: number): Promise<void> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (hold) await deps.storage.set({ [key_of(tab_id)]: { frames: hold.frames } satisfies MediaHold });
        await deps.send_mode(tab_id, frame_id, "media");
      }),
    // `;M`: the picked video acts for the keys until the mode ends. The frame enters the mode when its hint ends, and reports it.
    pin: (tab_id: number, frame_id: number): Promise<void> => in_turn(async () => deps.storage.set({ [key_of(tab_id)]: { frames: (await read(tab_id))?.frames ?? [], pin_frame: frame_id } satisfies MediaHold })),
    // A pin with no frame in the mode is a `;M` that never reached it, so it counts for nothing.
    pin_of: (tab_id: number): Promise<number | undefined> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        return hold && hold.frames.length > 0 ? hold.pin_frame : undefined;
      }),
    // The mode a frame reports. Any frame can start the hold (fullscreen starts it in the frame that sees it), and the first report of media starts the mode in every other frame in normal mode, which then report and join. A frame of the hold that reports a mode that is not media ends it for every frame.
    reported: (tab_id: number, frame_id: number, mode: Mode): Promise<void> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (mode === "media") {
          if (hold?.frames.includes(frame_id)) return;
          await deps.storage.set({ [key_of(tab_id)]: { ...hold, frames: [...(hold?.frames ?? []), frame_id] } satisfies MediaHold });
          // No list of frames reaches the background, so the step goes to every frame, the reporter too, which is in media already and stays.
          if (!hold?.frames.length) await deps.send_step(tab_id, true).catch(() => undefined);
        } else if (hold?.frames.includes(frame_id) && !KEEPS_THE_MODE.includes(mode)) await end(tab_id, hold, frame_id);
      }),
    // A load ends the hold in every frame. Firefox sends `status: "loading"` with no `url` when a load starts (docs/firefox-behavior.md). An address change the page makes itself keeps the hold and drops the pin, so the keys act on the new main video: a `pushState` (YouTube's next video) sends a bare `url`, and a `replaceState` before the load event sends `status: "loading"` with the `url`.
    navigated: (tab_id: number, change: { status?: string | undefined; url?: string | undefined }): Promise<void> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (!hold) return;
        if (change.status === "loading" && change.url === undefined) await end(tab_id, hold);
        else if (hold.pin_frame !== undefined) await deps.storage.set({ [key_of(tab_id)]: { frames: hold.frames } satisfies MediaHold });
      }),
    forget: (tab_id: number): Promise<void> => in_turn(() => deps.storage.remove(key_of(tab_id))),
  };
}

export type TabMedia = ReturnType<typeof create_tab_media>;
