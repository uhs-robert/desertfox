# quality

The `quality` bundle (`quality.js`, 4 KB limit). Like `media.js`, the content script never loads it: the background injects it into every frame for each `media quality` and `media skip` command (`src/background/quality_levels.ts`) and for each navigation, which starts the `media_quality` rule (`src/background/media_quality.ts`). Each frame reports whether it has a site player, and the background sends the request to one chosen frame.

- `main.ts`: probes the page for a driver, reports it, starts the rule on `quality_rule`, and answers `quality_apply`, one `runtime.onMessage` listener per frame however often the file runs. It reads the page through `window.wrappedJSObject`.
- `apply.ts`: one request against one driver: list, set and skip.
- `choose_level.ts`: the policy, which level a value (`max`, `min`, a height, `up`, `down`) picks. Pure.
- `driver.ts`: what a driver offers, and `copy_of`, which copies a page array by index because a content-script function passed into a page call is refused.
- `youtube.ts`: the `#movie_player` element's unofficial calls. `hls.ts`: `html5player.hlsobj`, the hls.js instance that some sites expose. A driver matches by the handle it finds, never by host, and reads the page again at each call so a replaced player is found.

- `rule.ts`: the `media_quality` rule in one frame. On `quality_rule` it reads the rule for the frame's address, then polls for a driver and takes it to the level. A newer start or a manual choice (`media quality` that took) ends an earlier poll. A start that is not a navigation leaves a manual choice standing.

The message types are in `src/shared/quality.ts`.
