// The messages between the background and the `quality` bundle. The background injects the bundle into every frame of the tab, each frame reports whether it has a site player, and the background sends one request to the chosen frame alone.

// `list` reads the levels, `set` picks one from a `media quality` value and `skip` goes to the next or previous video and `captions` toggles the captions.
export type QualityRequest = { type: "quality_apply"; op: "list" | "set" | "skip" | "captions"; value: string | undefined; times: number };

// The levels are in ascending order of height. `label` is what the site calls the level, such as "1080p60". `height` is the number a `media quality` value takes.
export type QualityLevel = { label: string; height: number; active: boolean };

// `levels` is empty while the player does not know its levels yet (YouTube answers "unknown" until it plays). `chosen` is the label that `set` picked, or "auto". `skipped` tells whether the site player took a skip, `toggled` whether it took a captions toggle and `captions` the state afterwards, when the player says it.
export type QualityAnswer = { levels: QualityLevel[]; chosen?: string; skipped?: boolean; toggled?: boolean; captions?: "on" | "off" };

// What each frame pushes to the background when the bundle runs in it, so the background picks one player to act on. `ready` means the player lists its levels. `has_video` means the frame holds a video element (open shadow roots included) or a known player. The background answers a report that has a video with the `media_quality` rule for the frame's address (`max`, `min`, `auto`, a height as text or `off`), and a report without one with nothing.
export type QualityReport = { type: "quality_report"; player: boolean; ready: boolean; has_video: boolean };
