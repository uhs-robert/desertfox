import assert from "node:assert/strict";
import { test } from "node:test";
import { choose_frames, clock, describe_change, run_media, type FrameScan, type MediaDeps } from "../../src/background/media_actions.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import type { QualityAnswer, QualityRequest } from "../../src/shared/quality.ts";
import type { MediaRequest, MediaResult, MediaScan, MediaState } from "../../src/shared/media.ts";

const ctx: CommandContext = { tab_id: 4, window_id: 1, frame_id: 0, mode: "normal" };
const empty: MediaScan = { count: 0, playing: 0, audible: 0, playing_audio: 0, audible_audio: 0, video_area: 0, playing_video_area: 0, audible_video_area: 0, pip_open: false, fullscreen_open: false, pinned: false, has_video: false };
const scan = (frame_id: number, fields: Partial<MediaScan>): FrameScan => ({ ...empty, count: 1, has_video: true, ...fields, frame_id });
const state: MediaState = { captions: "off", rate: 1.25, volume: 0.6, muted: false, position: 85, duration: 220, paused: false, pip: false, loop: false, fullscreen: false };

test("every frame with playing media acts, even beside a larger idle video", () => {
  const scans = [scan(0, { video_area: 90_000 }), scan(3, { playing: 1, playing_audio: 1, has_video: false }), scan(5, { playing: 2, playing_audio: 2, has_video: false })];
  assert.deepEqual(choose_frames(scans, "speed"), [
    { frame_id: 3, target: "playing" },
    { frame_id: 5, target: "playing" },
  ]);
});

test("media with sound acts before a muted preview that also plays, in another frame or the same", () => {
  const preview_beside_main = [scan(0, { playing: 1, playing_video_area: 400, video_area: 400 }), scan(4, { playing: 1, audible: 1, playing_video_area: 90_000, audible_video_area: 90_000, video_area: 90_000 })];
  assert.deepEqual(choose_frames(preview_beside_main, "speed"), [{ frame_id: 4, target: "audible" }]);
  assert.deepEqual(choose_frames(preview_beside_main, "pip"), [{ frame_id: 4, target: "audible" }]);
  assert.deepEqual(choose_frames([scan(0, { playing: 2, audible: 1 })], "volume"), [{ frame_id: 0, target: "audible" }]);
});

test("ap pauses every playing element on the tab when anything plays with sound, a muted preview included", () => {
  const scans = [scan(0, { playing: 1, playing_video_area: 400, video_area: 400 }), scan(4, { playing: 1, audible: 1, playing_video_area: 90_000, audible_video_area: 90_000, video_area: 90_000 })];
  assert.deepEqual(choose_frames(scans, "play_pause"), [
    { frame_id: 0, target: "playing" },
    { frame_id: 4, target: "playing" },
  ]);
  assert.deepEqual(choose_frames([scan(0, { playing: 1 })], "play_pause"), [{ frame_id: 0, target: "playing" }]);
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

test("size beats playing: a small playing ad does not outrank a large video that waits, for every key", () => {
  const ad_beside_main = [scan(0, { video_area: 700_000 }), scan(3, { playing: 1, audible: 1, playing_video_area: 75_000, audible_video_area: 75_000, video_area: 75_000 })];
  for (const action of ["fullscreen", "pip", "speed", "volume", "play_pause"] as const) assert.deepEqual(choose_frames(ad_beside_main, action), [{ frame_id: 0, target: "largest" }], action);
  const half_size = [scan(0, { video_area: 700_000 }), scan(3, { playing: 1, playing_video_area: 175_000, video_area: 175_000 })];
  assert.deepEqual(choose_frames(half_size, "fullscreen"), [{ frame_id: 3, target: "playing" }]);
  assert.deepEqual(choose_frames([scan(0, { video_area: 700_000 }), scan(3, { playing: 1, playing_video_area: 174_999, video_area: 174_999 })], "fullscreen"), [{ frame_id: 0, target: "largest" }]);
});

test("a playing audio-only frame still acts beside a large idle video", () => {
  const scans = [scan(0, { video_area: 700_000 }), scan(3, { playing: 1, audible: 1, playing_audio: 1, audible_audio: 1, has_video: false })];
  assert.deepEqual(choose_frames(scans, "volume"), [{ frame_id: 3, target: "audible" }]);
});

test("a playing video that is hidden or off screen does not beat the visible player", () => {
  const scans = [scan(0, { video_area: 700_000 }), scan(3, { playing: 1, audible: 1, has_video: true, playing_video_area: 0, audible_video_area: 0, video_area: 0 })];
  for (const action of ["fullscreen", "volume"] as const) assert.deepEqual(choose_frames(scans, action), [{ frame_id: 0, target: "largest" }], action);
});

test("playing audio beside a hidden video in the same frame still acts, and the hidden video alone does not", () => {
  const with_audio = [scan(0, { video_area: 700_000 }), scan(3, { playing: 2, audible: 2, playing_audio: 1, audible_audio: 1, video_area: 0 })];
  assert.deepEqual(choose_frames(with_audio, "volume"), [{ frame_id: 3, target: "audible" }]);
  assert.deepEqual(choose_frames(with_audio, "fullscreen"), [{ frame_id: 0, target: "largest" }]);
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

// `scan` is what the frame answers to a scan once the bundle runs in it (nothing when undefined). `resident` means an earlier key already injected the bundle. `refuses_scripts` makes the injection reject. `hangs` makes every call to the frame wait for ever and `hangs_apply` only the apply. `scan_after_ms` delays the scan answer, and `gone_after_scan` makes the apply fail as a closed tab or frame does.
type Frame = { refuses_scripts?: boolean; scan?: unknown; resident?: boolean; scan_after_ms?: number; apply?: (request: MediaRequest) => unknown; hangs?: boolean; hangs_apply?: boolean; gone_after_scan?: boolean };

function fake_tab(frames: Record<number, Frame>, { pip = true, scan_timeout_ms = 40, answer_timeout_ms = 50, quality = (() => undefined) as (request: QualityRequest) => QualityAnswer | undefined, pin_frame = undefined as number | undefined } = {}) {
  const asked: QualityRequest[] = [];
  const injected: number[] = [];
  const scanned: number[] = [];
  const attempted: number[] = [];
  const applied: { frame_id: number; request: Extract<MediaRequest, { type: "media_apply" }> }[] = [];
  const toasts: string[] = [];
  const preferred: (number | undefined)[] = [];
  const entered: { tab_id: number; frame_id: number }[] = [];
  const resident = new Set(Object.keys(frames).map(Number).filter((frame_id) => frames[frame_id]!.resident));
  const deps: MediaDeps = {
    tab_media: { enter: async (tab_id, frame_id) => void entered.push({ tab_id, frame_id }), pin_of: async () => pin_frame },
    list_frames: async () => Object.keys(frames).map(Number),
    inject: async (_tab_id, frame_id) => {
      const frame = frames[frame_id]!;
      attempted.push(frame_id);
      if (frame.hangs) return new Promise(() => {});
      if (frame.refuses_scripts) throw new Error("Missing host permission for the tab or frames");
      injected.push(frame_id);
      resident.add(frame_id);
    },
    ask: async (_tab_id, frame_id, request) => {
      const frame = frames[frame_id]!;
      if (frame.hangs) return new Promise(() => {});
      if (!resident.has(frame_id)) throw new Error("Could not establish connection. Receiving end does not exist.");
      if (request.type === "media_scan") {
        scanned.push(frame_id);
        if (frame.scan_after_ms) await new Promise((resolve) => setTimeout(resolve, frame.scan_after_ms));
        return frame.scan;
      }
      if (frame.hangs_apply) return new Promise(() => {});
      if (frame.gone_after_scan) throw new Error("No matching message handler");
      applied.push({ frame_id, request: request as Extract<MediaRequest, { type: "media_apply" }> });
      return frame.apply?.(request);
    },
    quality: async (_tab_id, request, prefer_frame) => (asked.push(request), preferred.push(prefer_frame), quality(request)),
    can_picture_in_picture: () => pip,
    toast: async (_ctx, message) => void toasts.push(message),
    scan_timeout_ms,
    answer_timeout_ms,
  };
  return { deps, injected, attempted, scanned, applied, toasts, asked, entered, preferred };
}

const acted = (count: number, fields: Partial<MediaState> = {}): MediaResult => ({ acted: count, state: { ...state, ...fields } });

test("a frame that refuses scripts or never answers counts as one without media", async () => {
  const tab = fake_tab({ 0: { refuses_scripts: true }, 1: { hangs: true }, 2: { scan: scan(2, { video_area: 10 }), apply: () => acted(1) } });
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.injected, [2]);
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [2]);
  assert.deepEqual(tab.toasts, ["Speed 1.25x"]);
});

test("a frame that answers nothing counts as no media", async () => {
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

test("a frame that never answers holds the key only until the scan timeout, and the others still rank", async () => {
  const tab = fake_tab({ 0: { hangs: true }, 1: { scan: scan(1, { playing: 1 }), resident: true, apply: () => acted(1) } }, { scan_timeout_ms: 40, answer_timeout_ms: 5000 });
  const started = Date.now();
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  const waited = Date.now() - started;
  assert.ok(waited >= 35 && waited < 1000, String(waited));
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [1]);
});

test("a frame that already ran the bundle answers with no injection at all", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, {}), resident: true }, 1: { scan: scan(1, { playing: 1 }), resident: true, apply: () => acted(1) } });
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.injected, []);
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [1]);
});

test("every frame with no listener gets the bundle and is asked again, and the next key injects nothing", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, {}) }, 1: { scan: scan(1, { playing: 1 }), apply: () => acted(1) } });
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.injected.sort(), [0, 1]);
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [1]);
  // The second key finds the listeners and injects nothing more.
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.injected.sort(), [0, 1]);
});

test("a hung frame on the first key holds it for one scan timeout, not the 1.5 s timer, and is not injected", async () => {
  const tab = fake_tab({ 0: { hangs: true }, 1: { scan: scan(1, { playing: 1 }), apply: () => acted(1) } }, { scan_timeout_ms: 40, answer_timeout_ms: 5000 });
  const started = Date.now();
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.ok(Date.now() - started < 400);
  assert.deepEqual(tab.attempted, [1]);
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [1]);
});

test("a frame that answers after the scan timeout is dropped and never acts", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), resident: true, scan_after_ms: 150, apply: () => acted(1) } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 }), { message: "No video or audio on this page" });
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.deepEqual(tab.applied, []);
  assert.deepEqual(tab.toasts, []);
});

test("a frame that answers the apply after the timeout counts as one with no result, and the apply goes out once", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), resident: true, hangs_apply: true }, 1: { scan: scan(1, { playing: 1 }), resident: true, apply: () => acted(1) } });
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [1]);
  assert.deepEqual(tab.toasts, ["Speed 1.25x"]);
});

test("a frame with no listener beside an answering one is injected, asked again and acted on", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, {}), resident: true }, 2: { scan: scan(2, { playing: 1 }), apply: () => acted(1) } });
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.injected, [2]);
  assert.deepEqual(tab.scanned.sort(), [0, 2]);
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [2]);
});

test("a hung frame is never injected, and a refusing frame is tried without stopping the others", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), resident: true, apply: () => acted(1) }, 1: { hangs: true }, 2: { refuses_scripts: true } }, { scan_timeout_ms: 40, answer_timeout_ms: 5000 });
  const started = Date.now();
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.ok(Date.now() - started < 400);
  assert.deepEqual(tab.injected, []);
  assert.deepEqual(tab.attempted, [2]);
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [0]);
});

test("frames rank by frame id whatever order the list comes in", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { video_area: 100 }), resident: true, apply: () => acted(1) }, 5: { scan: scan(5, { video_area: 100 }), resident: true, apply: () => acted(1) } });
  tab.deps.list_frames = async () => [5, 0];
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [0]);
});

test("an about:blank or srcdoc frame is listed like any other and injected when it has no listener", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, {}), resident: true }, 4: { scan: scan(4, { playing: 1 }), apply: () => acted(1) } });
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.injected, [4]);
});

test("a frame that unloads after its scan refuses as no media, not as an error", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), resident: true, gone_after_scan: true } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "volume", value: "up", times: 1 }), { name: "RuntimeRefusal", message: "No video or audio on this page" });
  assert.deepEqual(tab.toasts, []);
});

test("two keys pressed fast each get their own scan and their own result", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), apply: (request) => acted(1, { rate: Number((request as { value: string }).value) }) } });
  // The fake takes both keys through the injection together.
  await Promise.all([run_media(tab.deps, ctx, { action: "speed", value: "2", times: 1 }), run_media(tab.deps, ctx, { action: "speed", value: "3", times: 1 })]);
  assert.deepEqual(tab.toasts.sort(), ["Speed 2x", "Speed 3x"]);
  assert.deepEqual(tab.applied.map(({ request }) => request.value).sort(), ["2", "3"]);
});

test("a tab that closes mid-request ends in the no-media refusal at every step", async () => {
  const closed = Promise.reject(new Error("Invalid tab ID"));
  closed.catch(() => undefined);
  const no_list = fake_tab({ 0: { scan: scan(0, { playing: 1 }) } });
  no_list.deps.list_frames = () => closed;
  no_list.deps.ask = () => closed;
  no_list.deps.inject = () => closed;
  await assert.rejects(run_media(no_list.deps, ctx, { action: "play_pause" }), { name: "RuntimeRefusal", message: "No video or audio on this page" });
  const mid = fake_tab({ 0: { scan: scan(0, { playing: 1 }), resident: true } });
  mid.deps.ask = async (_tab_id, _frame_id, request) => {
    if (request.type === "media_scan") return scan(0, { playing: 1 });
    throw new Error("Invalid tab ID");
  };
  await assert.rejects(run_media(mid.deps, ctx, { action: "play_pause" }), { message: "No video or audio on this page" });
});

test("a failed frame list falls back to the top frame", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), resident: true, apply: () => acted(1) }, 3: { scan: scan(3, { playing: 1 }), resident: true, apply: () => acted(1) } });
  tab.deps.list_frames = async () => Promise.reject(new Error("webNavigation failed"));
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.scanned, [0]);
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [0]);
  const empty_list = fake_tab({ 0: { scan: scan(0, { playing: 1 }), resident: true, apply: () => acted(1) } });
  empty_list.deps.list_frames = async () => [];
  await run_media(empty_list.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(empty_list.scanned, [0]);
});

test("a frame list that never resolves is cut off at the scan timeout and the top frame is asked", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), resident: true, apply: () => acted(1) }, 3: { scan: scan(3, { playing: 1 }), resident: true, apply: () => acted(1) } }, { scan_timeout_ms: 40, answer_timeout_ms: 5000 });
  tab.deps.list_frames = () => new Promise(() => {});
  const started = Date.now();
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.ok(Date.now() - started < 400);
  assert.deepEqual(tab.scanned, [0]);
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [0]);
});

test("a frame that answers with something else counts as no media", async () => {
  const tab = fake_tab({ 0: { scan: { type: "other" }, resident: true } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "play_pause" }), { message: "No video or audio on this page" });
});

test("a page that refuses the bundle, such as a privileged one, refuses with no media", async () => {
  const tab = fake_tab({ 0: { refuses_scripts: true } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "play_pause" }), { message: "No video or audio on this page" });
});

test("a data: or sandboxed frame is listed and asked, and refuses the script without stopping the others", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), apply: () => acted(1) }, 1: { refuses_scripts: true }, 2: { refuses_scripts: true } });
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [0]);
});

test("fullscreen takes one video like picture-in-picture, and an open one first", () => {
  const scans = [scan(0, { playing: 1, audible: 1, audible_video_area: 400, playing_video_area: 400, video_area: 400 }), scan(2, { video_area: 900, fullscreen_open: true })];
  assert.deepEqual(choose_frames(scans, "fullscreen"), [{ frame_id: 2, target: "largest" }]);
  assert.deepEqual(choose_frames([scans[0]!], "fullscreen"), [{ frame_id: 0, target: "audible" }]);
});

test("the notice names mute, loop, fullscreen and the info line", () => {
  assert.equal(describe_change("mute", { ...state, muted: true }, 1), "Muted");
  assert.equal(describe_change("mute", state, 1), "Unmuted");
  assert.equal(describe_change("loop", { ...state, loop: true }, 1), "Loop on");
  assert.equal(describe_change("fullscreen", { ...state, fullscreen: true }, 1), "Fullscreen on");
  assert.equal(describe_change("info", { ...state, loop: true }, 1), "1:25 of 3:40, 1.25x, volume 60%, loop");
});

test("fullscreen asks the frame that holds the video when the top document is fullscreen too", () => {
  const scans = [scan(0, { count: 0, fullscreen_open: true }), scan(3, { video_area: 900, fullscreen_open: true })];
  assert.deepEqual(choose_frames(scans, "fullscreen"), [{ frame_id: 3, target: "largest" }]);
});

const levels = [
  { label: "720p", height: 720, active: false },
  { label: "1080p", height: 1080, active: true },
  { label: "1440p", height: 1440, active: false },
];

test("media quality without a value lists the levels best first with the playing one marked", async () => {
  const tab = fake_tab({ 0: {} }, { quality: () => ({ levels }) });
  await run_media(tab.deps, ctx, { action: "quality" });
  assert.deepEqual(tab.asked, [{ type: "quality_apply", op: "list", value: undefined, times: 1 }]);
  assert.deepEqual(tab.toasts, ["Quality: 1440p, 1080p (now), 720p"]);
});

test("media quality with a value asks the player to set it and names the level it chose", async () => {
  const tab = fake_tab({ 0: {} }, { quality: () => ({ levels, chosen: "1440p" }) });
  await run_media(tab.deps, ctx, { action: "quality", value: "max" });
  assert.deepEqual(tab.asked, [{ type: "quality_apply", op: "set", value: "max", times: 1 }]);
  assert.deepEqual(tab.toasts, ["Quality 1440p"]);
  const stepped = fake_tab({ 0: {} }, { quality: () => ({ levels, chosen: "720p" }) });
  await run_media(stepped.deps, ctx, { action: "quality", value: "down", times: 2 });
  assert.deepEqual(stepped.asked, [{ type: "quality_apply", op: "set", value: "down", times: 2 }]);
});

test("auto goes through while the player has no levels yet, a level pick refuses", async () => {
  const tab = fake_tab({ 0: {} }, { quality: () => ({ levels: [], chosen: "auto" }) });
  await run_media(tab.deps, ctx, { action: "quality", value: "auto" });
  assert.deepEqual(tab.toasts, ["Quality auto"]);
  const not_ready = fake_tab({ 0: {} }, { quality: () => ({ levels: [] }) });
  await assert.rejects(run_media(not_ready.deps, ctx, { action: "quality", value: "max" }), { name: "RuntimeRefusal", message: "The player has no quality levels yet" });
});

test("a page with no site player refuses quality in words, and so does a privileged page", async () => {
  const none = fake_tab({ 0: {} });
  await assert.rejects(run_media(none.deps, ctx, { action: "quality", value: "max" }), { name: "RuntimeRefusal", message: "No quality control on this page" });
  const refused = fake_tab({ 0: {} });
  refused.deps.quality = () => Promise.reject(new Error("Missing host permission"));
  await assert.rejects(run_media(refused.deps, ctx, { action: "quality" }), { message: "No quality control on this page" });
});

test("media skip goes next by default and refuses where the player has no skip", async () => {
  const tab = fake_tab({ 0: {} }, { quality: () => ({ levels: [], skipped: true }) });
  await run_media(tab.deps, ctx, { action: "skip" });
  await run_media(tab.deps, ctx, { action: "skip", value: "previous" });
  assert.deepEqual(tab.asked.map(({ op, value }) => [op, value]), [["skip", "next"], ["skip", "previous"]]);
  assert.deepEqual(tab.toasts, ["Next video", "Previous video"]);
  const hls = fake_tab({ 0: {} }, { quality: () => ({ levels: [], skipped: false }) });
  await assert.rejects(run_media(hls.deps, ctx, { action: "skip", value: "next" }), { message: "No next video" });
  const none = fake_tab({ 0: {} });
  await assert.rejects(run_media(none.deps, ctx, { action: "skip", value: "previous" }), { message: "No previous video" });
});

test("info adds the playing level of the site player, and leaves it out when no player answers", async () => {
  const frames = { 0: { scan: scan(0, { playing: 1 }), apply: () => acted(1) } };
  const with_player = fake_tab(frames, { quality: () => ({ levels }) });
  await run_media(with_player.deps, ctx, { action: "info" });
  assert.equal(with_player.toasts[0], "1:25 of 3:40, 1.25x, 1080p, volume 60%");
  const without = fake_tab(frames);
  await run_media(without.deps, ctx, { action: "info" });
  assert.equal(without.toasts[0], "1:25 of 3:40, 1.25x, volume 60%");
});

test("quality and skip need no media element and scan no frame", async () => {
  const tab = fake_tab({ 0: {} }, { quality: () => ({ levels }) });
  await run_media(tab.deps, ctx, { action: "quality" });
  assert.deepEqual(tab.injected, []);
});

test("media enter starts the mode on the frame that took the key, with no change to any video", async () => {
  const tab = fake_tab({ 0: { scan: empty }, 3: { scan: scan(3, { video_area: 500 }) } });
  await run_media(tab.deps, { ...ctx, frame_id: 0 }, { action: "enter" });
  assert.deepEqual(tab.entered, [{ tab_id: 4, frame_id: 0 }]);
  assert.deepEqual(tab.applied, []);
  assert.deepEqual(tab.toasts, []);
});

test("media enter refuses on a page with no media and starts nothing", async () => {
  const tab = fake_tab({ 0: { scan: empty } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "enter" }), { message: "No video on this page" });
  assert.deepEqual(tab.entered, []);
});

test("the pinned video acts for every key, even beside a larger one that plays with sound", () => {
  const scans = [scan(0, { playing: 1, audible: 1, audible_video_area: 90_000, playing_video_area: 90_000, video_area: 90_000 }), scan(2, { pinned: true, video_area: 100 })];
  assert.deepEqual(choose_frames(scans, "volume", 2), [{ frame_id: 2, target: "pinned" }]);
  assert.deepEqual(choose_frames(scans, "fullscreen", 2), [{ frame_id: 2, target: "pinned" }]);
});

test("an open picture-in-picture window is chosen before the pin, so the key closes it", () => {
  const scans = [scan(0, { pip_open: true, count: 1, video_area: 400 }), scan(2, { pinned: true, video_area: 100 })];
  assert.deepEqual(choose_frames(scans, "pip", 2), [{ frame_id: 0, target: "largest" }]);
  assert.deepEqual(choose_frames(scans, "volume", 2), [{ frame_id: 2, target: "pinned" }]);
});

test("a pin whose video left the page falls back to the main video rule", () => {
  const scans = [scan(0, { playing: 1, playing_video_area: 400, video_area: 400 }), scan(2, { pinned: false })];
  assert.deepEqual(choose_frames(scans, "volume", 2), [{ frame_id: 0, target: "playing" }]);
  assert.deepEqual(choose_frames(scans, "volume"), [{ frame_id: 0, target: "playing" }]);
});

test("a key of the mode asks the pinned frame with the pinned target", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { audible: 1, audible_video_area: 900, video_area: 900 }) }, 2: { scan: scan(2, { pinned: true, video_area: 50 }), apply: () => acted(1, { muted: true }) } }, { pin_frame: 2 });
  await run_media(tab.deps, ctx, { action: "mute" });
  assert.deepEqual(tab.applied.map(({ frame_id, request }) => [frame_id, request.target]), [[2, "pinned"]]);
});

test("media enter refuses a page with audio only", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { has_video: false }) } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "enter" }), { message: "No video on this page" });
  assert.deepEqual(tab.entered, []);
});

test("quality and skip ask for the player in the pinned frame", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, {}) }, 2: { scan: scan(2, { pinned: true }) } }, { pin_frame: 2, quality: () => ({ levels: [], chosen: "auto" }) });
  await run_media(tab.deps, ctx, { action: "quality", value: "max" });
  await run_media(tab.deps, ctx, { action: "skip" }).catch(() => undefined);
  assert.deepEqual(tab.preferred, [2, 2]);
});

test("quality and skip prefer no frame once the pinned video left the page", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, {}) }, 2: { scan: scan(2, { pinned: false }) } }, { pin_frame: 2, quality: () => ({ levels: [], chosen: "auto" }) });
  await run_media(tab.deps, ctx, { action: "quality", value: "max" });
  await run_media(tab.deps, ctx, { action: "skip" }).catch(() => undefined);
  assert.deepEqual(tab.preferred, [undefined, undefined]);
});

test("captions with no track on the element ask the site player, and refuse when it has none", async () => {
  const none = (): MediaResult => acted(1, { captions: "none" });
  const site = fake_tab({ 0: { scan: scan(0, {}), apply: none } }, { quality: () => ({ levels: [], toggled: true }) });
  await run_media(site.deps, ctx, { action: "captions" });
  assert.deepEqual(site.asked.map(({ op }) => op), ["captions"]);
  assert.deepEqual(site.toasts, ["Asked the player to toggle captions"]);
  const bare = fake_tab({ 0: { scan: scan(0, {}), apply: none } }, { quality: () => ({ levels: [], toggled: false }) });
  await assert.rejects(run_media(bare.deps, ctx, { action: "captions" }), { message: "No captions" });
  const unreachable = fake_tab({ 0: { scan: scan(0, {}), apply: none } }, { quality: () => undefined });
  await assert.rejects(run_media(unreachable.deps, ctx, { action: "captions" }), { message: "No captions" });
});

test("captions on a track need no site player, and the toast names the state", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, {}), apply: () => acted(1, { captions: "on" }) } });
  await run_media(tab.deps, ctx, { action: "captions" });
  assert.deepEqual(tab.asked, []);
  assert.deepEqual(tab.toasts, ["Captions on"]);
});

test("the captions fallback asks the planned frame, the pinned one first", async () => {
  const none = (): MediaResult => acted(1, { captions: "none" });
  const tab = fake_tab({ 0: { scan: scan(0, { video_area: 10 }), apply: none }, 2: { scan: scan(2, { pinned: true, video_area: 5 }), apply: none } }, { pin_frame: 2, quality: () => ({ levels: [], toggled: true, captions: "on" }) });
  await run_media(tab.deps, ctx, { action: "captions" });
  assert.deepEqual(tab.preferred, [2]);
  assert.deepEqual(tab.toasts, ["Captions on"]);
});

test("the site player is asked only when no acted-on player has a track, and the notice does not claim a state it cannot see", async () => {
  const mixed = fake_tab({ 0: { scan: scan(0, { playing: 1, playing_video_area: 9 }), apply: () => acted(1, { captions: "none" }) }, 1: { scan: scan(1, { playing: 1, playing_video_area: 9 }), apply: () => acted(1, { captions: "off" }) } }, { quality: () => ({ levels: [], toggled: true }) });
  await run_media(mixed.deps, ctx, { action: "captions" });
  assert.deepEqual(mixed.asked, []);
  const unknown = fake_tab({ 0: { scan: scan(0, {}), apply: () => acted(1, { captions: "none" }) } }, { quality: () => ({ levels: [], toggled: true }) });
  await run_media(unknown.deps, ctx, { action: "captions" });
  assert.deepEqual(unknown.toasts, ["Asked the player to toggle captions"]);
});

test("a frame step ranks the videos alone, so playing audio does not hide an idle video", () => {
  const audio_and_video = [scan(0, { playing: 1, audible: 1, playing_audio: 1, audible_audio: 1, has_video: false }), scan(1, { video_area: 9000 })];
  assert.deepEqual(choose_frames(audio_and_video, "frame"), [{ frame_id: 1, target: "largest" }]);
  assert.deepEqual(choose_frames([scan(0, { playing: 1, audible: 1, playing_audio: 1, audible_audio: 1, has_video: false })], "frame"), []);
});

test("a captions notice comes from a frame that has a track", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1, playing_video_area: 9 }), apply: () => acted(1, { captions: "none" }) }, 1: { scan: scan(1, { playing: 1, playing_video_area: 9 }), apply: () => acted(1, { captions: "on" }) } });
  await run_media(tab.deps, ctx, { action: "captions" });
  assert.deepEqual(tab.toasts, ["Captions on, 2 players"]);
});
