// What the `media` bundle does in one frame: find the media elements, describe them for the background's choice, and change the chosen ones.

import { shadow_root_of } from "../shadow.ts";
import { SEEK_RULE, SPEED_RULE, VOLUME_RULE } from "../../shared/media.ts";
import type { LevelRule, MediaRequest, MediaResult, MediaScan, MediaState, MediaTarget } from "../../shared/media.ts";

// The parts of a media element this file reads and writes, so the tests can pass plain objects.
export type Player = {
  localName: string;
  paused: boolean;
  loop: boolean;
  ended: boolean;
  playbackRate: number;
  volume: number;
  muted: boolean;
  currentTime: number;
  duration: number;
  play: () => Promise<void>;
  pause: () => void;
  requestPictureInPicture?: () => Promise<unknown>;
};

// The frame's reads: the players in document order with their visible area, and the open picture-in-picture element.
export type FrameView = {
  players: () => { player: Player; area: number }[];
  pip_element: () => unknown;
  exit_pip: () => Promise<void>;
  fullscreen_element: () => unknown;
  // requestFullscreen needs a user gesture. Firefox keeps the key press as one for a short window, which the message from the background reaches in time.
  toggle_fullscreen: (player: Player) => Promise<unknown>;
};

export function next_level(current: number, value: string | undefined, times: number, rule: LevelRule): number {
  if (value === undefined) return current;
  // A live stream has no end to jump to.
  if ((value === "end" || value === "percent") && !Number.isFinite(rule.max)) return current;
  const wanted =
    value === "up" ? current + rule.step * times
    : value === "down" ? current - rule.step * times
    : value === "reset" ? rule.reset
    : value === "end" ? rule.max
    : value === "percent" ? rule.min + ((rule.max - rule.min) * times) / 100
    : value.startsWith("+") || value.startsWith("-") ? current + Number(value)
    : Number(value);
  return Math.min(Math.max(wanted, rule.min), rule.max);
}

const is_video = (player: Player): boolean => player.localName === "video";
const is_playing = (player: Player): boolean => !player.paused && !player.ended;
// A muted autoplay preview plays too, so sound is what marks the media the user listens to.
const is_audible = (player: Player): boolean => is_playing(player) && !player.muted && player.volume > 0;

// Below the background's answer timeout. A play() still pending by then counts as started, since a buffering source resolves it only once playback runs, and a refusal comes at once.
const PLAY_GRACE_MS = 300;
const within_grace = (pending: Promise<unknown> | void): Promise<unknown> | void => pending && Promise.race([pending, new Promise((resolve) => setTimeout(resolve, PLAY_GRACE_MS))]);

// Firefox gives content scripts closed shadow roots, so a custom player's video is found too.
export function media_in(root: ParentNode, found: Element[] = []): Element[] {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (element.localName === "video" || element.localName === "audio") found.push(element);
    const shadow = shadow_root_of(element);
    if (shadow) media_in(shadow, found);
  }
  return found;
}

// The part of the box inside the viewport. A hidden element counts 0.
export function visible_area(element: Element, width: number, height: number): number {
  if (element.checkVisibility && !element.checkVisibility({ visibilityProperty: true })) return 0;
  const box = element.getBoundingClientRect();
  return Math.max(0, Math.min(box.right, width) - Math.max(box.left, 0)) * Math.max(0, Math.min(box.bottom, height) - Math.max(box.top, 0));
}

export function scan_frame(view: FrameView): MediaScan {
  const found = view.players();
  const video_areas = (list: typeof found) => Math.max(0, ...list.filter(({ player }) => is_video(player)).map(({ area }) => area));
  const playing = found.filter(({ player }) => is_playing(player));
  const audible = found.filter(({ player }) => is_audible(player));
  return {
    count: found.length,
    playing: playing.length,
    audible: audible.length,
    video_area: video_areas(found),
    playing_video_area: video_areas(playing),
    audible_video_area: video_areas(audible),
    pip_open: Boolean(view.pip_element()),
    fullscreen_open: Boolean(view.fullscreen_element()),
  };
}

function largest(found: { player: Player; area: number }[]): Player | undefined {
  let best = found[0];
  for (const entry of found) if (best && entry.area > best.area) best = entry;
  return best?.player;
}

function in_target(player: Player, target: MediaTarget): boolean {
  return target === "audible" ? is_audible(player) : target === "playing" ? is_playing(player) : true;
}

// The elements are found again here, not kept from the scan: the page may have changed them in between.
function targets_of(view: FrameView, request: Extract<MediaRequest, { type: "media_apply" }>): Player[] {
  const found = view.players();
  if (request.action === "pip" || request.action === "fullscreen") {
    // A frame holds one picture-in-picture window or fullscreen element at most, and the key closes it whatever the target.
    const open = request.action === "pip" ? view.pip_element() : view.fullscreen_element() && found.find(({ player }) => is_video(player))?.player;
    if (open) return [open as Player];
    const videos = found.filter(({ player }) => is_video(player) && in_target(player, request.target));
    const video = largest(videos);
    return video ? [video] : [];
  }
  if (request.target !== "largest") return found.filter(({ player }) => in_target(player, request.target)).map(({ player }) => player);
  const chosen = largest(found);
  return chosen ? [chosen] : [];
}

function state_of(player: Player, view: FrameView): MediaState {
  return {
    rate: player.playbackRate,
    volume: player.volume,
    muted: player.muted,
    position: player.currentTime,
    duration: Number.isFinite(player.duration) ? player.duration : null,
    paused: player.paused,
    // The document retargets the open element to the shadow host of a video inside a shadow root, so a comparison with the player fails there.
    pip: Boolean(view.pip_element()),
    loop: player.loop,
    fullscreen: Boolean(view.fullscreen_element()),
  };
}

function change(player: Player, request: Extract<MediaRequest, { type: "media_apply" }>, view: FrameView): Promise<unknown> | void {
  const { action, value, times } = request;
  // Without a value the command only reports, and even an equal write of currentTime seeks.
  if (value === undefined && (action === "speed" || action === "volume" || action === "seek")) return;
  if (action === "speed") player.playbackRate = next_level(player.playbackRate, value, times, SPEED_RULE);
  else if (action === "volume") player.volume = Math.round(next_level(player.volume * 100, value, times, VOLUME_RULE)) / 100;
  else if (action === "seek") player.currentTime = next_level(player.currentTime, value, times, { ...SEEK_RULE, max: Number.isFinite(player.duration) ? player.duration : SEEK_RULE.max });
  // With any element playing, the key pauses. Else it plays the one chosen element.
  else if (action === "play_pause") return request.target !== "largest" || is_playing(player) ? player.pause() : within_grace(player.play());
  else if (action === "mute") player.muted = !player.muted;
  else if (action === "loop") player.loop = !player.loop;
  else if (action === "fullscreen") return view.toggle_fullscreen(player);
  else if (action === "info") return;
  else if (view.pip_element()) return view.exit_pip();
  else return player.requestPictureInPicture?.();
}

export async function apply_in_frame(view: FrameView, request: Extract<MediaRequest, { type: "media_apply" }>): Promise<MediaResult> {
  const players = targets_of(view, request);
  const settled = await Promise.allSettled(players.map((player) => change(player, request, view)));
  const failure = settled.find((outcome) => outcome.status === "rejected");
  if (failure) return refused(failure.reason);
  const [first] = players;
  return first ? { acted: players.length, state: state_of(first, view) } : { acted: 0 };
}

function refused(error: unknown): MediaResult {
  const { name, message } = (error ?? {}) as { name?: unknown; message?: unknown };
  return { acted: 0, error_name: String(name ?? "Error"), error_message: String(message ?? error) };
}
