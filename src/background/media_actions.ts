// The `media` command's reach across frames. The key arrives from one frame, but the player often sits in another (an embedded video), so every frame of the tab gets the `media` bundle, reports its media, and only the chosen frames act.

import { RuntimeRefusal, type CommandContext } from "../shared/command.ts";
import type { MediaAction, MediaRequest, MediaResult, MediaScan, MediaState, MediaTarget } from "../shared/media.ts";

export type MediaDeps = {
  frame_ids: (tab_id: number) => Promise<number[]>;
  // Rejects in a frame that refuses scripts: a privileged page, or a frame that went away.
  inject: (tab_id: number, frame_id: number) => Promise<void>;
  ask: (tab_id: number, frame_id: number, request: MediaRequest) => Promise<unknown>;
  can_picture_in_picture: () => boolean;
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

async function scan_frames(deps: MediaDeps, tab_id: number): Promise<FrameScan[]> {
  const frame_ids = (await deps.frame_ids(tab_id).catch(() => [0])).sort((a, b) => a - b);
  const scan_one = async (frame_id: number): Promise<FrameScan | undefined> => {
    await deps.inject(tab_id, frame_id);
    const answer = await deps.ask(tab_id, frame_id, { type: "media_scan" });
    return is_scan(answer) ? { ...answer, frame_id } : undefined;
  };
  const scans = await Promise.all(frame_ids.map((frame_id) => within(scan_one(frame_id), deps.answer_timeout_ms)));
  return scans.filter((scan): scan is FrameScan => scan !== undefined);
}

// The scan with the largest positive measure. Ties go to the first, the lowest frame id.
function largest_by(scans: FrameScan[], measure: (scan: FrameScan) => number): FrameScan | undefined {
  let best: FrameScan | undefined;
  for (const scan of scans) if (measure(scan) > 0 && (!best || measure(scan) > measure(best))) best = scan;
  return best;
}

// Media that plays with sound acts first, then any playing media, so a muted autoplay preview yields to the video the user hears. Play or pause is the exception: with sound playing anywhere, it pauses everything that plays. Every frame with such media acts on all of it, so two players that play together move together. With nothing playing, the largest visible video acts, else the first frame with any media. Picture-in-picture takes one video: the open one, else the largest audible, else the largest playing, else the largest visible.
export function choose_frames(scans: FrameScan[], action: MediaAction): FramePlan[] {
  if (action === "pip") {
    const open = scans.find((scan) => scan.pip_open);
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

export function describe_change(action: MediaAction, state: MediaState, acted: number): string {
  const text =
    action === "speed" ? `Speed ${rounded(state.rate, 2)}x`
    : action === "volume" ? `Volume ${Math.round(state.volume * 100)}%${state.muted ? ", muted" : ""}`
    : action === "seek" ? (state.duration === null ? clock(state.position) : `${clock(state.position)} of ${clock(state.duration)}`)
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
  if (error_name === "NotAllowedError") return "The page blocked play until you click it";
  return error_message;
}

export async function run_media(deps: MediaDeps, ctx: CommandContext, args: MediaArgs): Promise<void> {
  const tab_id = ctx.tab_id;
  if (tab_id === undefined) throw new RuntimeRefusal("Media needs a tab");
  if (args.action === "pip" && !deps.can_picture_in_picture()) throw new RuntimeRefusal("Picture-in-picture needs Firefox 153 or newer");
  const no_media = new RuntimeRefusal(args.action === "pip" ? "No video on this page" : "No video or audio on this page");
  const plan = choose_frames(await scan_frames(deps, tab_id), args.action);
  if (plan.length === 0) throw no_media;
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
  await deps.toast(ctx, describe_change(args.action, state, acted));
}
