// The `media` command's reach across frames. The key arrives from one frame, but the player often sits in another (an embedded video), so every frame of the tab gets the `media` bundle, reports its media, and only the chosen frames act.

import { RuntimeRefusal, type CommandContext } from "../shared/command.ts";
import type { MediaAction, MediaRequest, MediaResult, MediaScan, MediaState, MediaTarget } from "../shared/media.ts";
import type { TabMedia } from "./tab_media.ts";
import type { QualityAnswer, QualityRequest } from "../shared/quality.ts";

// The scans that frames push in answer to an injection. A command listens for its tab while it waits, so a report that arrives with no command waiting is dropped.
export function create_media_reports() {
  const listeners = new Map<number, Set<(scan: FrameScan) => void>>();
  return {
    listen(tab_id: number, on_scan: (scan: FrameScan) => void): () => void {
      const set = listeners.get(tab_id) ?? new Set();
      set.add(on_scan);
      listeners.set(tab_id, set);
      return () => {
        set.delete(on_scan);
        if (set.size === 0 && listeners.get(tab_id) === set) listeners.delete(tab_id);
      };
    },
    receive(tab_id: number | undefined, frame_id: number | undefined, scan: MediaScan): void {
      if (tab_id === undefined || frame_id === undefined || !is_scan(scan)) return;
      for (const on_scan of listeners.get(tab_id) ?? []) on_scan({ ...scan, frame_id });
    },
  };
}

export type MediaReports = ReturnType<typeof create_media_reports>;

export type MediaDeps = {
  reports: MediaReports;
  // Runs the `media` bundle in every frame of the tab, each of which then pushes its scan to `reports`. Resolves with how many frames ran it. Rejects where scripts are refused: a privileged page.
  inject_all: (tab_id: number) => Promise<number>;
  ask: (tab_id: number, frame_id: number, request: MediaRequest) => Promise<unknown>;
  // Runs the `quality` bundle in every frame of the tab and sends the request to the one frame with a site player. Resolves with its answer, else undefined. The call holds its own deadline, so the caller adds no second timer. Rejects where scripts are refused: a privileged page.
  // `prefer_frame` is the frame of the pinned video, whose player acts when it has one.
  quality: (tab_id: number, request: QualityRequest, prefer_frame?: number) => Promise<QualityAnswer | undefined>;
  can_picture_in_picture: () => boolean;
  // The media mode of the tab: `enter` starts it on a frame, `pin_of` is the frame whose video `;M` pinned while the mode holds.
  tab_media: Pick<TabMedia, "enter" | "pin_of">;
  toast: (ctx: CommandContext, message: string) => Promise<void>;
  // A frame that has not answered by then counts as one with no media, so a hung frame cannot hold the key.
  answer_timeout_ms: number;
};

export type MediaArgs = { action: MediaAction; value?: string; times?: number };

export type FrameScan = MediaScan & { frame_id: number };

export type FramePlan = { frame_id: number; target: MediaTarget };

const is_scan = (answer: unknown): answer is MediaScan => typeof (answer as MediaScan | undefined)?.count === "number";
const is_result = (answer: unknown): answer is MediaResult => typeof (answer as MediaResult | undefined)?.acted === "number";

function within<T>(pending: Promise<T>, timeout_ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeout_ms);
    pending.then(
      (value) => resolve(value),
      () => resolve(undefined),
    ).finally(() => clearTimeout(timer));
  });
}

// Waits until every frame that ran the bundle has reported, or until the timeout, whichever is first. A frame that never reports (it navigated or closed, or its page blocks messages) counts as one with no media, so a hung frame cannot hold the key beyond the timeout.
async function scan_frames(deps: MediaDeps, tab_id: number): Promise<FrameScan[]> {
  const scans = new Map<number, FrameScan>();
  let expected: number | undefined;
  let finish!: () => void;
  const complete = () => expected !== undefined && scans.size >= expected;
  const done = new Promise<void>((resolve) => (finish = resolve));
  // The listener comes first: a frame can report before the injection resolves.
  const stop = deps.reports.listen(tab_id, (scan) => {
    scans.set(scan.frame_id, scan);
    if (complete()) finish();
  });
  const timer = setTimeout(finish, deps.answer_timeout_ms);
  try {
    deps.inject_all(tab_id).then(
      (count) => ((expected = count), complete() && finish()),
      // One frame that throws rejects the whole call while the other frames still report, so only the timer ends the wait.
      () => undefined,
    );
    await done;
  } finally {
    clearTimeout(timer);
    stop();
  }
  return [...scans.values()].sort((a, b) => a.frame_id - b.frame_id);
}

// The scan with the largest positive measure. Ties go to the first, the lowest frame id.
function largest_by(scans: FrameScan[], measure: (scan: FrameScan) => number): FrameScan | undefined {
  let best: FrameScan | undefined;
  for (const scan of scans) if (measure(scan) > 0 && (!best || measure(scan) > measure(best))) best = scan;
  return best;
}

// Media that plays with sound acts first, then any playing media, so a muted autoplay preview yields to the video the user hears. Play or pause is the exception: with sound playing anywhere, it pauses everything that plays. Every frame with such media acts on all of it, so two players that play together move together. With nothing playing, the largest visible video acts, else the first frame with any media. Picture-in-picture and fullscreen take one video: the open one, else the largest audible, else the largest playing, else the largest visible.
export function choose_frames(scans: FrameScan[], action: MediaAction, pin_frame?: number): FramePlan[] {
  // The pinned video acts for every key of the mode, until it leaves the page. Then the rule below picks again.
  if (scans.some((scan) => scan.frame_id === pin_frame && scan.pinned)) return [{ frame_id: pin_frame!, target: "pinned" }];
  if (action === "pip" || action === "fullscreen") {
    const is_open = (scan: FrameScan) => (action === "pip" ? scan.pip_open : scan.fullscreen_open);
    // A fullscreen video in a child frame leaves the top document fullscreen too, so the frame that holds media is the one to ask.
    const open = scans.find((scan) => is_open(scan) && scan.count > 0) ?? scans.find(is_open);
    if (open) return [{ frame_id: open.frame_id, target: "largest" }];
    const audible = largest_by(scans, (scan) => scan.audible_video_area);
    if (audible) return [{ frame_id: audible.frame_id, target: "audible" }];
    const playing = largest_by(scans, (scan) => scan.playing_video_area);
    if (playing) return [{ frame_id: playing.frame_id, target: "playing" }];
    const shown = largest_by(scans, (scan) => scan.video_area);
    return shown ? [{ frame_id: shown.frame_id, target: "largest" }] : [];
  }
  const audible = scans.filter((scan) => scan.audible > 0);
  const playing = scans.filter((scan) => scan.playing > 0);
  // A pause takes every playing element on the tab, a muted preview too, so the next ap finds nothing playing and resumes in one press.
  const pauses_all = action === "play_pause" && audible.length > 0;
  if (audible.length > 0 && !pauses_all) return audible.map((scan) => ({ frame_id: scan.frame_id, target: "audible" }));
  if (playing.length > 0) return playing.map((scan) => ({ frame_id: scan.frame_id, target: "playing" }));
  const shown = largest_by(scans, (scan) => scan.video_area) ?? scans.find((scan) => scan.count > 0);
  return shown ? [{ frame_id: shown.frame_id, target: "largest" }] : [];
}

const rounded = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places;

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const [hours, minutes, rest] = [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60];
  const two = (part: number) => String(part).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`;
}

const info_line = (state: MediaState, quality: string | undefined): string =>
  [state.duration === null ? clock(state.position) : `${clock(state.position)} of ${clock(state.duration)}`, `${rounded(state.rate, 2)}x`, ...(quality ? [quality] : []), `volume ${Math.round(state.volume * 100)}%${state.muted ? ", muted" : ""}`, ...(state.loop ? ["loop"] : []), ...(state.paused ? ["paused"] : [])].join(", ");

// `quality` is the active level that the site driver reports, for `info` only.
export function describe_change(action: MediaAction, state: MediaState, acted: number, quality?: string): string {
  const text =
    action === "speed" ? `Speed ${rounded(state.rate, 2)}x`
    : action === "volume" ? `Volume ${Math.round(state.volume * 100)}%${state.muted ? ", muted" : ""}`
    : action === "seek" ? (state.duration === null ? clock(state.position) : `${clock(state.position)} of ${clock(state.duration)}`)
    : action === "mute" ? (state.muted ? "Muted" : "Unmuted")
    : action === "loop" ? `Loop ${state.loop ? "on" : "off"}`
    : action === "fullscreen" ? `Fullscreen ${state.fullscreen ? "on" : "off"}`
    : action === "info" ? info_line(state, quality)
    : action === "pip" ? `Picture-in-picture ${state.pip ? "on" : "off"}`
    : state.paused ? "Paused" : "Playing";
  return acted > 1 ? `${text}, ${acted} players` : text;
}

export function refusal_for(action: MediaAction, error_name: string, error_message: string): string {
  if (action === "pip") {
    if (error_name === "NotAllowedError") return "This frame allows picture-in-picture only from a click in it";
    if (error_name === "SecurityError") return "This frame does not allow picture-in-picture";
    if (error_name === "InvalidStateError") return "This video cannot go to picture-in-picture";
    if (error_name === "NotSupportedError") return "Picture-in-picture is turned off in Firefox";
  }
  if (action === "fullscreen" && (error_name === "NotAllowedError" || error_name === "TypeError")) return "Firefox allows fullscreen only from a key press in the page";
  if (error_name === "NotAllowedError") return "The page blocked play until you click it";
  return error_message;
}

// The quality bundle needs no scan unless a video is pinned: each frame reports its player, and the request goes to the one chosen frame. `deps.quality` holds the only deadline, so a skip that was sent is never reported as refused by a second timer.
async function run_quality(deps: MediaDeps, ctx: CommandContext, tab_id: number, args: MediaArgs): Promise<void> {
  const times = args.times ?? 1;
  const pinned_frame = await deps.tab_media.pin_of(tab_id);
  // As for the other keys, a pinned video that left the page no longer counts. Only a pin costs the scan.
  const pin_frame = pinned_frame !== undefined && (await scan_frames(deps, tab_id)).some((scan) => scan.frame_id === pinned_frame && scan.pinned) ? pinned_frame : undefined;
  const ask = (request: Omit<QualityRequest, "type" | "times">) => deps.quality(tab_id, { type: "quality_apply", times, ...request }, pin_frame).catch(() => undefined);
  if (args.action === "skip") {
    const direction = args.value === "previous" ? "previous" : "next";
    if (!(await ask({ op: "skip", value: direction }))?.skipped) throw new RuntimeRefusal(`No ${direction} video`);
    return deps.toast(ctx, direction === "next" ? "Next video" : "Previous video");
  }
  const answer = await ask({ op: args.value === undefined ? "list" : "set", value: args.value });
  if (!answer) throw new RuntimeRefusal("No quality control on this page");
  if (answer.levels.length === 0 && answer.chosen !== "auto") throw new RuntimeRefusal("The player has no quality levels yet");
  if (answer.chosen) return deps.toast(ctx, `Quality ${answer.chosen}`);
  await deps.toast(ctx, `Quality: ${answer.levels.map(({ label, active }) => (active ? `${label} (now)` : label)).reverse().join(", ")}`);
}

export async function run_media(deps: MediaDeps, ctx: CommandContext, args: MediaArgs): Promise<void> {
  const tab_id = ctx.tab_id;
  if (tab_id === undefined) throw new RuntimeRefusal("Media needs a tab");
  if (args.action === "quality" || args.action === "skip") return run_quality(deps, ctx, tab_id, args);
  if (args.action === "pip" && !deps.can_picture_in_picture()) throw new RuntimeRefusal("Picture-in-picture needs Firefox 153 or newer");
  const no_media = new RuntimeRefusal(args.action === "pip" || args.action === "fullscreen" || args.action === "enter" ? "No video on this page" : "No video or audio on this page");
  const scans = await scan_frames(deps, tab_id);
  // Audio alone has no picture to watch, so the mode needs a video.
  if (args.action === "enter" && !scans.some((scan) => scan.has_video)) throw no_media;
  const plan = choose_frames(scans, args.action, args.action === "enter" ? undefined : await deps.tab_media.pin_of(tab_id));
  if (plan.length === 0) throw no_media;
  if (args.action === "enter") return deps.tab_media.enter(tab_id, ctx.frame_id);
  const answers = await Promise.all(
    plan.map(({ frame_id, target }) => within(deps.ask(tab_id, frame_id, { type: "media_apply", target, action: args.action, value: args.value, times: args.times ?? 1 }), deps.answer_timeout_ms)),
  );
  // A frame that navigated or closed since its scan answers nothing, or nothing it can act on.
  const results = answers.filter(is_result);
  const failed = results.find((result) => result.error_name !== undefined);
  if (failed) throw new RuntimeRefusal(refusal_for(args.action, failed.error_name!, failed.error_message ?? ""));
  const acted = results.reduce((sum, result) => sum + result.acted, 0);
  const state = results.find((result) => result.state)?.state;
  if (acted === 0 || !state) throw no_media;
  const quality = args.action === "info" ? (await deps.quality(tab_id, { type: "quality_apply", op: "list", value: undefined, times: 1 }).catch(() => undefined))?.levels.find((level) => level.active)?.label : undefined;
  await deps.toast(ctx, describe_change(args.action, state, acted, quality));
}
