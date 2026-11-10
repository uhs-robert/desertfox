import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_in_frame, media_in, next_level, scan_frame, type FrameView, type Player } from "../../src/content/media/frame_media.ts";
import { SEEK_RULE, SPEED_RULE, VOLUME_RULE, type MediaRequest } from "../../src/shared/media.ts";

type Apply = Extract<MediaRequest, { type: "media_apply" }>;
const apply = (fields: Partial<Apply>): Apply => ({ type: "media_apply", target: "largest", action: "speed", value: undefined, times: 1, ...fields });

function player(fields: Partial<Player> = {}): Player & { calls: string[] } {
  const calls: string[] = [];
  return {
    localName: "video",
    paused: true,
    ended: false,
    playbackRate: 1,
    volume: 1,
    muted: false,
    currentTime: 0,
    duration: 100,
    calls,
    play: async function (this: Player) {
      calls.push("play");
      this.paused = false;
    },
    pause: function (this: Player) {
      calls.push("pause");
      this.paused = true;
    },
    ...fields,
  };
}

function frame(entries: { player: Player; area: number }[], pip: { element: unknown } = { element: null }): FrameView {
  return {
    players: () => entries,
    pip_element: () => pip.element,
    exit_pip: async () => void (pip.element = null),
  };
}

test("up and down move by steps times the count, reset and numbers set, a sign moves, and the rule's range clamps", () => {
  assert.equal(next_level(1, "up", 1, SPEED_RULE), 1.25);
  assert.equal(next_level(1, "up", 3, SPEED_RULE), 1.75);
  assert.equal(next_level(0.5, "down", 2, SPEED_RULE), 0.25);
  assert.equal(next_level(3.9, "up", 1, SPEED_RULE), 4);
  assert.equal(next_level(2, "reset", 1, SPEED_RULE), 1);
  assert.equal(next_level(1, "1.5", 1, SPEED_RULE), 1.5);
  assert.equal(next_level(60, "+10", 1, VOLUME_RULE), 70);
  assert.equal(next_level(60, "250", 1, VOLUME_RULE), 100);
  assert.equal(next_level(5, "-10", 1, SEEK_RULE), 0);
  assert.equal(next_level(42, undefined, 1, SEEK_RULE), 42);
});

test("the walk finds media inside open and closed shadow roots, nested", () => {
  const element = (localName: string, shadow?: { querySelectorAll: () => unknown[] }) => ({ localName, openOrClosedShadowRoot: shadow ?? null, shadowRoot: null });
  const inner = { querySelectorAll: () => [element("audio")] };
  const closed = { querySelectorAll: () => [element("div", inner), element("video")] };
  const page = { querySelectorAll: () => [element("video"), element("x-player", closed), element("p")] };
  assert.deepEqual(
    media_in(page as unknown as ParentNode).map((found) => found.localName),
    ["video", "audio", "video"],
  );
});

test("the scan counts playing media and the largest video areas, audio aside", () => {
  const playing_audio = player({ localName: "audio", paused: false });
  const playing_video = player({ paused: false });
  const ended_video = player({ paused: false, ended: true });
  const view = frame([
    { player: player(), area: 900 },
    { player: playing_video, area: 100 },
    { player: ended_video, area: 2000 },
    { player: playing_audio, area: 0 },
  ]);
  assert.deepEqual(scan_frame(view), { count: 4, playing: 2, video_area: 2000, playing_video_area: 100, pip_open: false });
});

test("a playing target changes every playing element and leaves the paused ones", async () => {
  const [one, two, idle] = [player({ paused: false }), player({ paused: false, playbackRate: 2 }), player()];
  const view = frame([
    { player: one, area: 10 },
    { player: idle, area: 900 },
    { player: two, area: 10 },
  ]);
  const result = await apply_in_frame(view, apply({ target: "playing", value: "up", times: 2 }));
  assert.deepEqual([one.playbackRate, two.playbackRate, idle.playbackRate], [1.5, 2.5, 1]);
  assert.equal(result.acted, 2);
  assert.equal(result.state?.rate, 1.5);
});

test("the largest target is found again at apply time, so a video removed since the scan is not touched", async () => {
  const entries = [{ player: player(), area: 900 }];
  const view = frame(entries);
  entries.length = 0;
  assert.deepEqual(await apply_in_frame(view, apply({ action: "volume", value: "up" })), { acted: 0 });
});

test("play_pause pauses every playing element, and plays the largest one when none plays", async () => {
  const [small, large] = [player(), player()];
  const view = frame([
    { player: small, area: 10 },
    { player: large, area: 500 },
  ]);
  const played = await apply_in_frame(view, apply({ action: "play_pause" }));
  assert.deepEqual([small.calls, large.calls], [[], ["play"]]);
  assert.equal(played.state?.paused, false);
  const paused = await apply_in_frame(view, apply({ action: "play_pause", target: "playing" }));
  assert.deepEqual(large.calls, ["play", "pause"]);
  assert.equal(paused.state?.paused, true);
});

test("a play() the page blocks answers its error name", async () => {
  const blocked = player({ play: () => Promise.reject(Object.assign(new Error("play() can only be initiated by a user gesture"), { name: "NotAllowedError" })) });
  const result = await apply_in_frame(frame([{ player: blocked, area: 5 }]), apply({ action: "play_pause" }));
  assert.equal(result.acted, 0);
  assert.equal(result.error_name, "NotAllowedError");
});

test("volume rounds to whole percent, and seek stops at the duration", async () => {
  const video = player({ volume: 0.33, currentTime: 95 });
  const view = frame([{ player: video, area: 5 }]);
  await apply_in_frame(view, apply({ action: "volume", value: "up" }));
  await apply_in_frame(view, apply({ action: "seek", value: "up" }));
  assert.deepEqual([video.volume, video.currentTime], [0.43, 100]);
});

test("picture-in-picture takes the largest video, never audio, and the next press closes it", async () => {
  const pip = { element: null as unknown };
  const audio = player({ localName: "audio" });
  const video = player({ requestPictureInPicture: async () => void (pip.element = video) });
  const view = frame(
    [
      { player: audio, area: 0 },
      { player: video, area: 50 },
    ],
    pip,
  );
  const opened = await apply_in_frame(view, apply({ action: "pip" }));
  assert.equal(opened.state?.pip, true);
  const closed = await apply_in_frame(view, apply({ action: "pip" }));
  assert.equal(pip.element, null);
  assert.equal(closed.state?.pip, false);
});

test("a second injection into the same frame adds no second listener", async () => {
  const listeners: unknown[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = {};
  globals.browser = { runtime: { onMessage: { addListener: (listener: unknown) => listeners.push(listener) } } };
  try {
    // A query makes a fresh module instance, as a second executeScript runs the file again.
    const entry = new URL("../../src/content/media/main.ts", import.meta.url).href;
    await import(`${entry}?first`);
    await import(`${entry}?second`);
    assert.equal(listeners.length, 1);
    const answer = (listeners[0] as (message: unknown) => unknown)({ type: "run_in_content" });
    assert.equal(answer, undefined);
  } finally {
    delete globals.window;
    delete globals.browser;
  }
});
