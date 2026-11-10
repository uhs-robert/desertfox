import assert from "node:assert/strict";
import { test } from "node:test";
import { choose_frames, clock, describe_change, run_media, type FrameScan, type MediaDeps } from "../../src/background/media_actions.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import type { MediaRequest, MediaResult, MediaScan, MediaState } from "../../src/shared/media.ts";

const ctx: CommandContext = { tab_id: 4, window_id: 1, frame_id: 0, mode: "normal" };
const empty: MediaScan = { count: 0, playing: 0, video_area: 0, playing_video_area: 0, pip_open: false };
const scan = (frame_id: number, fields: Partial<MediaScan>): FrameScan => ({ ...empty, count: 1, ...fields, frame_id });
const state: MediaState = { rate: 1.25, volume: 0.6, muted: false, position: 85, duration: 220, paused: false, pip: false };

test("every frame with playing media acts, even beside a larger idle video", () => {
  const scans = [scan(0, { video_area: 90_000 }), scan(3, { playing: 1, video_area: 100 }), scan(5, { playing: 2 })];
  assert.deepEqual(choose_frames(scans, "speed"), [
    { frame_id: 3, target: "playing" },
    { frame_id: 5, target: "playing" },
  ]);
});

test("with nothing playing the largest visible video acts, else the first frame with media", () => {
  assert.deepEqual(choose_frames([scan(0, { video_area: 100 }), scan(2, { video_area: 400 }), scan(4, { video_area: 400 })], "play_pause"), [{ frame_id: 2, target: "largest" }]);
  assert.deepEqual(choose_frames([{ ...empty, frame_id: 0 }, scan(6, {})], "volume"), [{ frame_id: 6, target: "largest" }]);
  assert.deepEqual(choose_frames([{ ...empty, frame_id: 0 }], "volume"), []);
});

test("picture-in-picture closes an open window first, then takes the largest playing video, then the largest visible one", () => {
  assert.deepEqual(choose_frames([scan(0, { playing: 1, playing_video_area: 500 }), scan(2, { pip_open: true })], "pip"), [{ frame_id: 2, target: "largest" }]);
  assert.deepEqual(choose_frames([scan(0, { playing: 1, playing_video_area: 500 }), scan(2, { playing: 1, playing_video_area: 900 })], "pip"), [{ frame_id: 2, target: "playing" }]);
  assert.deepEqual(choose_frames([scan(0, { playing: 1 }), scan(1, { video_area: 300 })], "pip"), [{ frame_id: 1, target: "largest" }]);
  assert.deepEqual(choose_frames([scan(0, { playing: 1 })], "pip"), []);
});

test("the notice names the new value, the player count and a live stream's position alone", () => {
  assert.equal(describe_change("speed", state, 1), "Speed 1.25x");
  assert.equal(describe_change("speed", state, 2), "Speed 1.25x, 2 players");
  assert.equal(describe_change("volume", { ...state, muted: true }, 1), "Volume 60%, muted");
  assert.equal(describe_change("seek", state, 1), "1:25 of 3:40");
  assert.equal(describe_change("seek", { ...state, duration: null }, 1), "1:25");
  assert.equal(describe_change("play_pause", { ...state, paused: true }, 1), "Paused");
  assert.equal(describe_change("pip", { ...state, pip: true }, 1), "Picture-in-picture on");
  assert.equal(clock(3725), "1:02:05");
});

type Frame = { refuses_scripts?: boolean; scan?: unknown; apply?: (request: MediaRequest) => unknown; hangs?: boolean };

function fake_tab(frames: Record<number, Frame>, { pip = true } = {}) {
  const injected: number[] = [];
  const applied: { frame_id: number; request: MediaRequest }[] = [];
  const toasts: string[] = [];
  const deps: MediaDeps = {
    frame_ids: async () => Object.keys(frames).map(Number).reverse(),
    inject: async (_tab_id, frame_id) => {
      if (frames[frame_id]?.refuses_scripts) throw new Error("Missing host permission for the tab or frames");
      injected.push(frame_id);
    },
    ask: async (_tab_id, frame_id, request) => {
      const frame = frames[frame_id]!;
      if (frame.hangs) return new Promise(() => {});
      if (request.type === "media_scan") return frame.scan;
      applied.push({ frame_id, request });
      return frame.apply?.(request);
    },
    can_picture_in_picture: () => pip,
    toast: async (_ctx, message) => void toasts.push(message),
    answer_timeout_ms: 50,
  };
  return { deps, injected, applied, toasts };
}

const acted = (count: number, fields: Partial<MediaState> = {}): MediaResult => ({ acted: count, state: { ...state, ...fields } });

test("a frame that refuses scripts or never answers counts as one without media", async () => {
  const tab = fake_tab({ 0: { refuses_scripts: true }, 1: { hangs: true }, 2: { scan: scan(2, { video_area: 10 }), apply: () => acted(1) } });
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.injected.sort(), [1, 2]);
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [2]);
  assert.deepEqual(tab.toasts, ["Speed 1.25x"]);
});

test("a frame that answers with something else, such as a new page's content script, counts as no media", async () => {
  const tab = fake_tab({ 0: { scan: undefined }, 1: { scan: { type: "other" } } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "play_pause" }), { name: "RuntimeRefusal", message: "No video or audio on this page" });
});

test("a frame that navigates or closes between the scan and the apply refuses as no media, not as an error", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), apply: () => undefined }, 1: { scan: scan(1, { playing: 1 }), apply: () => ({ acted: 0 }) } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "volume", value: "up", times: 1 }), { message: "No video or audio on this page" });
  assert.deepEqual(tab.toasts, []);
});

test("two playing frames both act and the notice counts every player", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), apply: () => acted(1, { rate: 2 }) }, 7: { scan: scan(7, { playing: 2 }), apply: () => acted(2, { rate: 2 }) } });
  await run_media(tab.deps, ctx, { action: "speed", value: "2", times: 1 });
  assert.deepEqual(
    tab.applied.map(({ frame_id, request }) => [frame_id, request]),
    [
      [0, { type: "media_apply", target: "playing", action: "speed", value: "2", times: 1 }],
      [7, { type: "media_apply", target: "playing", action: "speed", value: "2", times: 1 }],
    ],
  );
  assert.deepEqual(tab.toasts, ["Speed 2x, 3 players"]);
});

test("a blocked play and picture-in-picture errors become refusals in words", async () => {
  const blocked = { acted: 0, error_name: "NotAllowedError", error_message: "play() failed" };
  let tab = fake_tab({ 0: { scan: scan(0, { video_area: 5 }), apply: () => blocked } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "play_pause" }), { message: "The page blocked play until you click it" });
  tab = fake_tab({ 0: { scan: scan(0, { video_area: 5 }), apply: () => blocked } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "pip" }), { message: "This frame allows picture-in-picture only from a click in it" });
  tab = fake_tab({ 0: { scan: scan(0, { video_area: 5 }), apply: () => ({ acted: 0, error_name: "SecurityError", error_message: "" }) } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "pip" }), { message: "This frame does not allow picture-in-picture" });
});

test("picture-in-picture refuses before any frame is touched on a Firefox without the API", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { video_area: 5 }) } }, { pip: false });
  await assert.rejects(run_media(tab.deps, ctx, { action: "pip" }), { message: "Picture-in-picture needs Firefox 153 or newer" });
  assert.deepEqual(tab.injected, []);
});

test("picture-in-picture on a page with only audio says there is no video", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }) } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "pip" }), { message: "No video on this page" });
});
