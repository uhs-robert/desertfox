// The messages between the background and the `media` bundle, and the step rules of the `media` command. The background injects the bundle into each frame itself, so these never pass through the content script.

export const MEDIA_ACTIONS = ["play_pause", "speed", "volume", "seek", "pip", "fullscreen", "mute", "loop", "info"] as const;
export type MediaAction = (typeof MEDIA_ACTIONS)[number];

// Known gap until PR 2 gives each action its own value rules: the schema accepts `end` and `percent` on speed and volume too. They read the rule's range there (`speed end` is 4x, `volume percent` sets the count), and no key or doc offers them.
// A value for speed, volume or seek: `up` and `down` move one step per count, `reset` goes back to the rule's reset, `end` to the rule's top (the media end for a seek), `percent` to the count as a percent of the rule's span, a signed number moves by it and a bare number sets it.
export const MEDIA_VALUE_PATTERN = "^(up|down|reset|end|percent|[+-]?\\d+(\\.\\d+)?)$";

// Volume is in percent here and 0 to 1 on the element. Seek has no fixed maximum: the media duration is its end.
export type LevelRule = { step: number; min: number; max: number; reset: number };
export const SPEED_RULE: LevelRule = { step: 0.25, min: 0.25, max: 4, reset: 1 };
export const VOLUME_RULE: LevelRule = { step: 10, min: 0, max: 100, reset: 100 };
export const SEEK_RULE: LevelRule = { step: 10, min: 0, max: Infinity, reset: 0 };

// `audible` acts on every element that plays with sound in the frame, `playing` on every element that plays. `largest` acts on the one largest visible video, else the first media element.
export type MediaTarget = "audible" | "playing" | "largest";

export type MediaRequest =
  | { type: "media_apply"; target: MediaTarget; action: MediaAction; value: string | undefined; times: number };

// One frame's media. The areas are in CSS pixels inside the frame's own viewport, videos only.
export type MediaScan = { count: number; playing: number; audible: number; video_area: number; playing_video_area: number; audible_video_area: number; pip_open: boolean; fullscreen_open: boolean };

// The first acted-on element after the change. `duration` is null for a live stream.
export type MediaState = { rate: number; volume: number; muted: boolean; position: number; duration: number | null; paused: boolean; pip: boolean; loop: boolean; fullscreen: boolean };

// `error_name` is the DOMException name of a refused play() or picture-in-picture request.
export type MediaResult = { acted: number; state?: MediaState; error_name?: string; error_message?: string };
