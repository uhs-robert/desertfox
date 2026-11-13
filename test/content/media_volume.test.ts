import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_in_frame, type FrameView, type Player } from "../../src/content/media/frame_media.ts";
import { youtube_volume } from "../../src/content/quality/youtube.ts";
import type { MediaRequest } from "../../src/shared/media.ts";

type Apply = Extract<MediaRequest, { type: "media_apply" }>;
const apply = (fields: Partial<Apply>): Apply => ({ type: "media_apply", target: "largest", action: "volume", value: "down", times: 1, ...fields });

// Like YouTube's player, this one puts the element back to its own volume after a write to the element, and takes a change only through its own call.
function youtube_page() {
  const player_state = { volume: 100 };
  const element = {
    localName: "video", paused: true, loop: false, ended: false, playbackRate: 1, muted: false, currentTime: 0, duration: 100,
    play: async () => {}, pause: () => {},
    held: 1,
    get volume() { return this.held; },
    set volume(_written: number) { this.held = player_state.volume / 100; },
  };
  const movie_player = {
    getVolume: () => player_state.volume,
    setVolume: (volume: number) => { player_state.volume = volume; element.held = volume / 100; },
  };
  const page = { document: { getElementById: (id: string) => (id === "movie_player" ? movie_player : null) } };
  return { element, page };
}

const view_of = (element: unknown, site_volume: FrameView["site_volume"]): FrameView => ({
  players: () => [{ player: element as Player, area: 5 }],
  site_volume,
  pip_element: () => null,
  exit_pip: async () => {},
  fullscreen_element: () => null,
  toggle_fullscreen: async () => {},
});

test("on a page whose player puts the element volume back, volume keys step through the player", async () => {
  const { element, page } = youtube_page();
  const view = view_of(element, () => youtube_volume(page));
  for (let press = 0; press < 4; press++) await apply_in_frame(view, apply({}));
  assert.equal(element.volume, 0.8);
  const result = await apply_in_frame(view, apply({ value: "up" }));
  assert.equal(result.state?.volume, 0.85);
});

test("a page without the player calls keeps writing the element", async () => {
  const element = { localName: "video", paused: true, loop: false, ended: false, playbackRate: 1, muted: false, currentTime: 0, duration: 100, volume: 1, play: async () => {}, pause: () => {} };
  const view = view_of(element, () => youtube_volume({ document: { getElementById: () => ({}) } }));
  await apply_in_frame(view, apply({}));
  assert.equal(element.volume, 0.95);
});
