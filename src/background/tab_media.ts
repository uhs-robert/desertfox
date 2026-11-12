// The media mode of a tab. Modes are per frame, but the mode belongs to the tab: the frame that takes `aa` is rarely the frame that holds the video, so the background remembers which frames are in it and ends them together.
// It lives in `storage.session`, so a restarted background still knows and a browser restart clears it.

import type { Mode } from "../shared/command.ts";
import { TAB_MEDIA_STORAGE_PREFIX, TAB_MEDIA_TOP_STORAGE_PREFIX } from "./storage_keys.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

// `pin_frame` is the frame whose video `;M` pinned. The video itself is a weak reference in that frame's page.
// `stepped_on` says that `aa` sent the step on to every frame already, so the first frame to report the mode sends none.
// `lines` are the frames of the hold with a hint or the line open, opened from the mode. `left` are the frames that reported normal while one was open, and go back to the mode when it closes. `line_closed` is the last frame whose line closed back to the mode, and when.
export type MediaHold = { frames: number[]; pin_frame?: number; stepped_on?: true; lines?: number[]; left?: number[]; line_closed?: { frame_id: number; at_ms: number } };

export type TabMediaDeps = {
  storage: SessionStorage;
  // The `MediaStep` message, to one frame or, with no frame, to every frame of the tab that runs the content script.
  send_step: (tab_id: number, on: boolean, frame_id?: number) => Promise<unknown>;
  // Whether the frame still runs the content script: a frame removed with its line open never reports again.
  frame_alive: (tab_id: number, frame_id: number) => Promise<boolean>;
  now: () => number;
};

const key_of = (tab_id: number): string => TAB_MEDIA_STORAGE_PREFIX + tab_id;

const without_pin = ({ pin_frame: _pin_frame, ...hold }: MediaHold): MediaHold => hold;

// A hint or the command line opened from the media mode returns to it, so a frame that reports one of these has not left.
const KEEPS_THE_MODE: readonly Mode[] = ["media", "hint", "cmdline"];
const is_line = (mode: Mode): boolean => mode === "hint" || mode === "cmdline";

// The end of a fullscreen reaches every frame of it at once. Firefox spends the Escape that closes a line in fullscreen on leaving the fullscreen, so the line's frame returns to the mode while the others report normal, in any order. A normal report this soon after a line closed, from a frame without the focus, is that same end. The report carries no cause, and content.js has no room for one.
export const LINE_CLOSE_GRACE_MS = 500;

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
  // The reporter gets no step off. A late step on would put it back in the mode, its report would start a new hold whose step on comes after that step off, and the two would repeat without end.
  const end = async (tab_id: number, hold: MediaHold, except?: number) => {
    await deps.storage.remove(key_of(tab_id));
    await Promise.all(hold.frames.filter((frame_id) => frame_id !== except).map((frame_id) => deps.send_step(tab_id, false, frame_id).catch(() => undefined)));
  };

  const write = (tab_id: number, hold: MediaHold) => deps.storage.set({ [key_of(tab_id)]: hold });
  // A line of another frame closed back to the mode a moment ago, so a normal report now comes from the fullscreen end that closed it. An Escape the user pressed comes from the frame with the focus.
  const line_just_closed = (hold: MediaHold, frame_id: number, focus: boolean): boolean => !focus && !!hold.line_closed && hold.line_closed.frame_id !== frame_id && deps.now() - hold.line_closed.at_ms < LINE_CLOSE_GRACE_MS;
  // A frame removed with its line open never reports again, so only a frame that still runs the content script keeps the mode with its line.
  const open_lines_besides = async (tab_id: number, hold: MediaHold, frame_id: number): Promise<number[]> => {
    const others = (hold.lines ?? []).filter((line_frame) => line_frame !== frame_id);
    const alive = await Promise.all(others.map((line_frame) => deps.frame_alive(tab_id, line_frame).catch(() => false)));
    return others.filter((_line_frame, index) => alive[index]);
  };
  // The line's frame is back in the mode. Once no line is open, every frame that reported normal meanwhile goes back too.
  const after_line_closed = async (tab_id: number, hold: MediaHold, frame_id: number) => {
    const next: MediaHold = { ...hold, lines: await open_lines_besides(tab_id, hold, frame_id), line_closed: { frame_id, at_ms: deps.now() } };
    const all_closed = next.lines?.length === 0;
    if (all_closed) {
      delete next.lines;
      delete next.left;
    }
    await write(tab_id, next);
    if (all_closed) await Promise.all((hold.left ?? []).map((left_frame) => deps.send_step(tab_id, true, left_frame).catch(() => undefined)));
  };

  return {
    // `aa`: starts the mode in every frame, the one that took the key among them. A new start drops an old pin. A frame joins the hold when it reports the mode, because a report of normal that left before the mode arrived must not end the hold.
    // The one step on is the message that starts the mode in the key's frame, so it cannot reach that frame after an Escape there. A second step on, sent when that frame reports, could, and would put the frame back in the mode.
    enter: (tab_id: number, _key_frame_id: number): Promise<void> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        await write(tab_id, { ...(hold && without_pin(hold)), frames: hold?.frames ?? [], stepped_on: true });
        await deps.send_step(tab_id, true).catch(() => undefined);
      }),
    // `;M`: the picked video acts for the keys until the mode ends. The frame enters the mode when its hint ends, and reports it.
    pin: (tab_id: number, frame_id: number): Promise<void> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        await write(tab_id, { ...hold, frames: hold?.frames ?? [], pin_frame: frame_id });
      }),
    // A pin with no frame in the mode is a `;M` that never reached it, so it counts for nothing.
    pin_of: (tab_id: number): Promise<number | undefined> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        return hold && hold.frames.length > 0 ? hold.pin_frame : undefined;
      }),
    // The mode a frame reports. Any frame can start the hold (fullscreen starts it in the frame that sees it), and the first report of media starts the mode in every other frame in normal mode, which then report and join. A frame of the hold that reports a mode that is not media ends it for every frame.
    // A frame of the hold with a hint or the line open keeps the mode for the others too, and when it closes back to the mode, every frame that left meanwhile goes back to it.
    // `focus` says whether the frame's own document holds the keyboard focus.
    reported: (tab_id: number, frame_id: number, mode: Mode, focus: boolean): Promise<void> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (mode === "media") {
          if (hold?.lines?.includes(frame_id)) return after_line_closed(tab_id, hold, frame_id);
          if (hold?.frames.includes(frame_id)) return;
          const { stepped_on, ...rest } = hold ?? { frames: [] };
          await write(tab_id, { ...rest, frames: [...rest.frames, frame_id] });
          // No list of frames reaches the background, so the step goes to every frame, the reporter too, which is in media already and stays.
          if (rest.frames.length === 0 && !stepped_on) await deps.send_step(tab_id, true).catch(() => undefined);
          return;
        }
        if (!hold?.frames.includes(frame_id)) return;
        if (is_line(mode)) {
          if (!hold.lines?.includes(frame_id)) await write(tab_id, { ...hold, lines: [...(hold.lines ?? []), frame_id] });
        } else if (mode === "normal" && line_just_closed(hold, frame_id, focus)) await deps.send_step(tab_id, true, frame_id).catch(() => undefined);
        else if (mode === "normal" && (await open_lines_besides(tab_id, hold, frame_id)).length > 0) {
          if (!hold.left?.includes(frame_id)) await write(tab_id, { ...hold, left: [...(hold.left ?? []), frame_id] });
        } else if (!KEEPS_THE_MODE.includes(mode)) await end(tab_id, hold, frame_id);
      }),
    // A frame that starts while the hold is on joins it: the reply to its first keymap read carries the mode. A pin alone is no hold, since it holds no frame yet.
    // The frame goes into `frames` in the same turn as the read. A hold that ends before the frame reports then still reaches it, and its report cannot start a new hold.
    join: (tab_id: number, frame_id: number): Promise<boolean> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (!hold || (hold.frames.length === 0 && !hold.stepped_on)) return false;
        if (!hold.frames.includes(frame_id)) await write(tab_id, { ...hold, frames: [...hold.frames, frame_id] });
        return true;
      }),
    // A load ends the hold in every frame. Firefox sends `status: "loading"` with no `url` when a load starts (docs/firefox-behavior.md). An address change the page makes itself keeps the hold and drops the pin, so the keys act on the new main video: a `pushState` (YouTube's next video) sends a bare `url`, and a `replaceState` before the load event sends `status: "loading"` with the `url`.
    navigated: (tab_id: number, change: { status?: string | undefined; url?: string | undefined }): Promise<void> =>
      in_turn(async () => {
        const hold = await read(tab_id);
        if (!hold) return;
        if (change.status === "loading" && change.url === undefined) await end(tab_id, hold);
        else if (hold.pin_frame !== undefined) await write(tab_id, without_pin(hold));
      }),
    forget: (tab_id: number): Promise<void> => in_turn(() => deps.storage.remove(key_of(tab_id))),
  };
}

export type TabMedia = ReturnType<typeof create_tab_media>;

export type MediaDiscoveryDeps = {
  storage: SessionStorage;
  // 0 turns which-key off.
  which_key_delay_ms: () => Promise<number>;
  // A report can land after its tab closed, and must not store anything for it.
  tab_is_open: (tab_id: number) => Promise<boolean>;
  // Runs the conditional open of the panel in the top frame. The frame admits it only while it is in media mode and not in full screen, which a video in a child frame in full screen also sets on the top document.
  open_panel: (tab_id: number) => Promise<unknown>;
  // Hides the panel of the top frame. Closing a panel that is not up does nothing.
  close_panel: (tab_id: number) => Promise<unknown>;
};

// What the top frame of a tab last reported, and how many times that changed.
type TopState = { mode: Mode; changes: number };

const top_key_of = (tab_id: number): string => TAB_MEDIA_TOP_STORAGE_PREFIX + tab_id;

// Opens the which-key panel of the media mode when the top frame moves into it (entry, or the return from a hint or the command line), so the keys can be found. A frame reports its mode again on a window or tab focus, which is no move and opens nothing. Media mode is set in every frame, so only the top frame's report counts. Full screen shows the video alone, and a delay of 0 means no panel unasked.
// The state is in `storage.session`, so a restarted background does not take a focus report for an entry.
export function create_media_discovery(deps: MediaDiscoveryDeps) {
  let chain: Promise<unknown> = Promise.resolve();
  const in_turn = <T>(step: () => Promise<T>): Promise<T> => {
    const run = chain.then(step);
    chain = run.catch(() => undefined);
    return run;
  };
  const read = async (tab_id: number): Promise<TopState | undefined> => (await deps.storage.get(top_key_of(tab_id)))[top_key_of(tab_id)] as TopState | undefined;
  return {
    reported: async (tab_id: number, frame_id: number, mode: Mode): Promise<void> => {
      if (frame_id !== 0) return;
      // Only a change of mode counts, so a repeat report while the checks run does not drop their open.
      const mine = await in_turn(async () => {
        const state = await read(tab_id);
        if (state?.mode === mode || !(await deps.tab_is_open(tab_id))) return undefined;
        const changes = (state?.changes ?? 0) + 1;
        await deps.storage.set({ [top_key_of(tab_id)]: { mode, changes } satisfies TopState });
        return mode === "media" && state?.mode !== "media" ? changes : undefined;
      });
      if (mine === undefined) return;
      if ((await deps.which_key_delay_ms()) === 0) return;
      if ((await in_turn(() => read(tab_id)))?.changes !== mine) return;
      await deps.open_panel(tab_id);
    },
    // A key that runs in a child frame in media mode never reaches the key handling of the top frame, which draws the panel. So the key closes it from here.
    key_ran: async (tab_id: number, frame_id: number, mode: Mode): Promise<void> => {
      if (frame_id !== 0 && mode === "media") await deps.close_panel(tab_id);
    },
    forget: (tab_id: number): Promise<void> => in_turn(() => deps.storage.remove(top_key_of(tab_id))),
  };
}
