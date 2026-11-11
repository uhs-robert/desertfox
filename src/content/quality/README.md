# quality

The `quality` bundle (`quality.js`, 4 KB limit). Like `media.js`, the content script never loads it: the background injects it into every frame for each `media quality` and `media skip` command (`src/background/quality_levels.ts`). Each frame reports whether it has a site player, and the background sends the request to one chosen frame.

- `main.ts`: probes the page for a driver, reports it, and answers `quality_apply`, one `runtime.onMessage` listener per frame however often the file runs. It reads the page through `window.wrappedJSObject`.
- `apply.ts`: one request against one driver: list, set and skip.
- `choose_level.ts`: the policy, which level a value (`max`, `min`, a height, `up`, `down`) picks. Pure.
- `driver.ts`: what a driver offers, and `copy_of`, which copies a page array by index because a content-script function passed into a page call is refused.
- `youtube.ts`: the `#movie_player` element's unofficial calls. `hls.ts`: `html5player.hlsobj`, the hls.js instance that some sites expose. A driver matches by the handle it finds, never by host, and reads the page again at each call so a replaced player is found.

The message types are in `src/shared/quality.ts`.
