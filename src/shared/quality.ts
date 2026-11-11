// The messages between the background and the `quality` bundle. The background injects the bundle into every frame of the tab, each frame reports whether it has a site player, and the background sends one request to the chosen frame alone.

// `list` reads the levels, `set` picks one from a `media quality` value and `skip` goes to the next or previous video.
export type QualityRequest = { type: "quality_apply"; op: "list" | "set" | "skip"; value: string | undefined; times: number };

// The levels are in ascending order of height. `label` is what the site calls the level, such as "1080p60". `height` is the number a `media quality` value takes.
export type QualityLevel = { label: string; height: number; active: boolean };

// `levels` is empty while the player does not know its levels yet (YouTube answers "unknown" until it plays). `chosen` is the label that `set` picked, or "auto". `skipped` tells whether the site player took a skip.
export type QualityAnswer = { levels: QualityLevel[]; chosen?: string; skipped?: boolean };

// What each frame pushes to the background when the bundle runs in it, so the background picks one player to act on. `ready` means the player lists its levels.
export type QualityReport = { type: "quality_report"; player: boolean; ready: boolean };
