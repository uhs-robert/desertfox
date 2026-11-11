# media

The `media` bundle (`media.js`, 4 KB limit). Unlike the other bundles, the content script never loads it: the background injects it into every frame of the tab for each `media` command (`src/background/media_actions.ts`), so a key pressed in one frame reaches a player in another. It works without `content.js`, which a frame from another site starts only on its first focus.

- `main.ts`: a scan that each run pushes to the background with `media_report`, and one `runtime.onMessage` listener for `media_apply`, added once per frame however often the file runs. The message types live in `src/shared/media.ts`.
- `frame_media.ts`: finds the `video` and `audio` elements, through closed shadow roots (`shadow_root_of`), measures each video's visible area, describes the frame for the background's choice and changes the chosen elements. The apply finds the elements again, so a page change between scan and apply cannot leave it holding a removed element. It reads the page through a small `FrameView`, so the tests pass plain objects.
