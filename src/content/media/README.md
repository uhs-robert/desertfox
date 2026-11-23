# media

The `media` bundle (`media.js`): the media keys, in every frame of a tab. Behavior is in `docs/design/interfaces_media.md`, section "Media files for the media bundle".

- `main.ts`: the `runtime.onMessage` listener for `media_scan` and `media_apply`.
- `fullscreen.ts`: `F`, fullscreen through the site's own button or the player box.
- `frame_media.ts`: finds the frame's `video` and `audio` elements, describes them and applies the chosen action.

Rules across files:

- The content script never loads this bundle. The background injects it by frame id (`src/background/media_actions.ts`).
- The message types live in `src/shared/media.ts`. The bundle works without `content.js`.
