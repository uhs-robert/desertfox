import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_in_frame, type FrameView, type Player } from "../../src/content/media/frame_media.ts";
import { youtube_player } from "../../src/content/quality/youtube.ts";
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
    // 5 is cued: the element has no source, so only the player's own call starts it.
    state: 5,
    getPlayerState() { return this.state; },
    // Like the real player, the state moves only after the call returns, so a read right after it is stale.
    calls: [] as string[],
    playVideo() { this.calls.push("play"); },
    pauseVideo() { this.calls.push("pause"); },
  };
  const page = { document: { getElementById: (id: string) => (id === "movie_player" ? movie_player : null) } };
  return { element, page, movie_player };
}

const view_of = (element: unknown, site_player: FrameView["site_player"], others: unknown[] = [], site_controls: FrameView["site_controls"] = () => true): FrameView => ({
  players: () => [element, ...others].map((player, index) => ({ player: player as Player, area: 5 - index })),
  site_player,
  site_controls,
  pip_element: () => null,
  exit_pip: async () => {},
  fullscreen_element: () => null,
  toggle_fullscreen: async () => {},
});

test("on a page whose player puts the element volume back, volume keys step through the player", async () => {
  const { element, page } = youtube_page();
  const view = view_of(element, () => youtube_player(page));
  for (let press = 0; press < 4; press++) await apply_in_frame(view, apply({}));
  assert.equal(element.volume, 0.8);
  const result = await apply_in_frame(view, apply({ value: "up" }));
  assert.equal(result.state?.volume, 0.85);
});

test("a page without the player calls keeps writing the element", async () => {
  const element = { localName: "video", paused: true, loop: false, ended: false, playbackRate: 1, muted: false, currentTime: 0, duration: 100, volume: 1, play: async () => {}, pause: () => {} };
  const view = view_of(element, () => youtube_player({ document: { getElementById: () => ({}) } }));
  await apply_in_frame(view, apply({}));
  assert.equal(element.volume, 0.95);
});

test("a media element the site player does not control keeps its own volume", async () => {
  const { element: site_element, page } = youtube_page();
  const other = { localName: "audio", paused: true, loop: false, ended: false, playbackRate: 1, muted: false, currentTime: 0, duration: 100, volume: 1, play: async () => {}, pause: () => {} };
  // The other element is the largest, so it is the selected Player.
  const view = view_of(other, () => youtube_player(page), [site_element], (player) => player === site_element);
  const result = await apply_in_frame(view, apply({}));
  assert.equal(other.volume, 0.95);
  assert.equal(site_element.held, 1);
  assert.equal(result.state?.volume, 0.95);
});

test("volume steps reach exactly 0 and 100 through the player and through a plain element", async () => {
  const site = youtube_page();
  const site_view = view_of(site.element, () => youtube_player(site.page));
  const plain = { localName: "video", paused: true, loop: false, ended: false, playbackRate: 1, muted: false, currentTime: 0, duration: 100, volume: 1, play: async () => {}, pause: () => {} };
  const plain_view = view_of(plain, () => undefined);
  const ways = [
    { view: site_view, put: (percent: number) => site.movie_player.setVolume(percent), read: () => site.element.held },
    { view: plain_view, put: (percent: number) => { plain.volume = percent / 100; }, read: () => plain.volume },
  ];
  for (const { view, put, read } of ways) {
    for (const [from, value, end] of [[43, "down", 0], [98, "up", 100]] as const) {
      put(from);
      for (let press = 0; press < 10; press++) await apply_in_frame(view, apply({ value }));
      assert.equal(read(), end / 100, `${value} from ${from}`);
    }
  }
});

test("play on a cued player starts it through the player and reports playing before its state moves", async () => {
  const { element, page, movie_player } = youtube_page();
  let element_plays = 0;
  element.play = async () => { element_plays++; };
  const view = view_of(element, () => youtube_player(page));
  const started = await apply_in_frame(view, apply({ action: "play_pause", value: undefined }));
  assert.deepEqual(movie_player.calls, ["play"]);
  assert.equal(element_plays, 0);
  assert.equal(movie_player.state, 5);
  assert.equal(started.state?.paused, false);
  const later = await apply_in_frame(view, apply({}));
  assert.equal(later.state?.paused, true);
});

test("pause on a playing player goes through the player, and a press in the lag window pauses again", async () => {
  const { element, page, movie_player } = youtube_page();
  movie_player.state = 1;
  element.paused = false;
  const view = view_of(element, () => youtube_player(page));
  const stopped = await apply_in_frame(view, apply({ action: "play_pause", value: undefined }));
  assert.deepEqual(movie_player.calls, ["pause"]);
  assert.equal(stopped.state?.paused, true);
  await apply_in_frame(view, apply({ action: "play_pause", value: undefined }));
  assert.deepEqual(movie_player.calls, ["pause", "pause"]);
});

test("a player without the play calls plays and pauses the element", async () => {
  const { element, page, movie_player } = youtube_page();
  const bare = { document: { getElementById: () => ({ getVolume: movie_player.getVolume, setVolume: movie_player.setVolume }) } };
  let plays = 0;
  element.play = async () => { plays++; };
  const result = await apply_in_frame(view_of(element, () => youtube_player(bare)), apply({ action: "play_pause", value: undefined }));
  assert.equal(plays, 1);
  assert.equal(result.state?.paused, true);
  void page;
});
