// The value an action of the `media` command takes. Kept apart from `media.ts`, which the `media` bundle imports and which must not carry these texts.

const NUMBER = "[+-]?\\d+(\\.\\d+)?";

// The value an action takes, as the pattern arms of the `media` command's `value` param. `up` and `down` move one step per count, `reset` goes back to the rule's reset, `end` to the rule's top (the media end for a seek), `percent` to the count as a percent of the media (a seek only), a signed number moves by it and a bare number sets it. A quality is `max`, `min`, `auto`, a height (`1080` or `1080p`) or `up` or `down` one level. A skip is `next` or `previous`. A frame step is `up` or `down`, one frame per count.
export const MEDIA_VALUE_PATTERNS: Readonly<Record<"speed" | "volume" | "seek" | "quality" | "skip" | "frame", string>> = {
  speed: `^(up|down|reset|${NUMBER})$`,
  volume: `^(up|down|reset|${NUMBER})$`,
  seek: `^(up|down|reset|end|percent|${NUMBER})$`,
  quality: "^(max|min|auto|up|down|\\d+p?)$",
  skip: "^(next|previous)$",
  frame: "^(up|down)$",
};
