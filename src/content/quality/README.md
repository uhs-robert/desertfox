# quality

The `quality` bundle (`quality.js`): the video quality commands and the `media_quality` rule. The background injects it, never the content script.

Behavior is in `docs/design/interfaces_media.md`, section "Quality files for the quality bundle".

The probe (`quality_probe.js`) finds a video. The rule injects it at each navigation, unless its value is `off` or `auto` with no site row.

- `probe_main.ts`: the probe entry. It sends `quality_probe` once per address.
- `probe.ts`: the probe in one frame, with its deps injected for tests.
- `find_video.ts`: the player handles and the `video` search, through open shadow roots.

The bundle:

- `main.ts`: the bundle entry: probes for a driver, reports, and answers `quality_apply`.
- `apply.ts`: one request against one driver: list, set, skip and captions.
- `choose_level.ts`: which level a value (`max`, `min`, a height, `up`, `down`) picks. Pure.
- `driver.ts`: what a driver offers, and `copy_of`.
- `youtube.ts`: the `#movie_player` calls of YouTube.
- `hls.ts`: the `html5player.hlsobj` hls.js instance.
- `rule.ts`: the `media_quality` rule in one frame.

Rules across files:

- A driver matches by the handle it finds, never by host.
- The injecting background files are `src/background/quality_levels.ts` and `src/background/media_quality.ts`. The message types are in `src/shared/quality.ts`.
