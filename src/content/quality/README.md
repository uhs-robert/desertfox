# quality

The `quality` bundle (`quality.js`, 5 KB limit). Like `media.js`, the content script never loads it: the background injects it into every frame for each `media quality` and `media skip` command (`src/background/quality_levels.ts`) and, for the `media_quality` rule (`src/background/media_quality.ts`), into the frames whose probe found a video.

The probe (`quality_probe.js`, 2 KB limit) is what the rule injects into every frame at each navigation:

- `probe_main.ts`: the entry. It leaves one probe on the window and sends `quality_probe` once per address. It also leaves what it found in `desertfox_quality_video` for the bundle.
- `probe.ts`: the probe in one frame, with its deps injected for tests. It looks at once, looks again every 2 s for 10 s, and wakes on a media event. A run at a new address in a document that already reported reports again, so the loaded bundle starts the rule for the new page.
- `find_video.ts`: a `video` query, then the open shadow roots of custom elements (hyphenated names) only. A `:not` selector over the plain element names hands back just the other elements, so a page of plain elements makes no per-element wrappers.

The bundle: Each frame it loads in reports whether it has a site player and a video, and the background sends the request to one chosen frame. The answer to a report from a frame with a video is the rule for the frame's address.

- `main.ts`: probes the page for a driver, reports it and hands the answer to the rule, listens for media events on the document (capture phase) and for `tree_updated`, and answers `quality_apply`, one `runtime.onMessage` listener per frame however often the file runs. A new address in the frame marks the run as a navigation. It reads the page through `window.wrappedJSObject`. It has no search inside shadow roots: the probe's finding stands in for it.
- `apply.ts`: one request against one driver: list, set, skip and captions.
- `choose_level.ts`: the policy, which level a value (`max`, `min`, a height, `up`, `down`) picks. Pure.
- `driver.ts`: what a driver offers, and `copy_of`, which copies a page array by index because a content-script function passed into a page call is refused.
- `youtube.ts`: the `#movie_player` element's unofficial calls. `hls.ts`: `html5player.hlsobj`, the hls.js instance that some sites expose. A driver matches by the handle it finds, never by host, and reads the page again at each call so a replaced player is found.

- `rule.ts`: the `media_quality` rule in one frame. A run reports, and the answer decides: nothing (the frame has no video) ends the run, and the rule starts the look-again check, a video check every 2 s for 10 s with no message until it hits, plus a wake on the first media event (`wake`). A rule value starts the poll for a driver, which takes it to the level. The newest report decides, so a stale answer starts nothing. A settings change (`refresh`, from `tree_updated`) reports again in a frame with a video, and a changed value reaches the running poll or starts a new one. A newer start or a manual choice (`media quality` that took) ends an earlier poll. A start that is not a navigation leaves a manual choice standing, and in a frame that already has a rule it only reports, so a media command that injects the bundle again cannot restart the rule. A navigation that finds no video ends a manual choice and frees the frame for the next video's wake.

The message types are in `src/shared/quality.ts`.
