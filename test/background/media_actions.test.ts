import assert from "node:assert/strict";
import { test } from "node:test";
import { choose_frames, clock, create_media_reports, describe_change, run_media, type FrameScan, type MediaDeps } from "../../src/background/media_actions.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import type { QualityAnswer, QualityRequest } from "../../src/shared/quality.ts";
import type { MediaRequest, MediaResult, MediaScan, MediaState } from "../../src/shared/media.ts";

const ctx: CommandContext = { tab_id: 4, window_id: 1, frame_id: 0, mode: "normal" };
const empty: MediaScan = { count: 0, playing: 0, audible: 0, video_area: 0, playing_video_area: 0, audible_video_area: 0, pip_open: false, fullscreen_open: false };
const scan = (frame_id: number, fields: Partial<MediaScan>): FrameScan => ({ ...empty, count: 1, ...fields, frame_id });
const state: MediaState = { rate: 1.25, volume: 0.6, muted: false, position: 85, duration: 220, paused: false, pip: false, loop: false, fullscreen: false };

test("every frame with playing media acts, even beside a larger idle video", () => {
  const scans = [scan(0, { video_area: 90_000 }), scan(3, { playing: 1, video_area: 100 }), scan(5, { playing: 2 })];
  assert.deepEqual(choose_frames(scans, "speed"), [
    { frame_id: 3, target: "playing" },
    { frame_id: 5, target: "playing" },
  ]);
});

test("media with sound acts before a muted preview that also plays, in another frame or the same", () => {
  const preview_beside_main = [scan(0, { playing: 1, playing_video_area: 90_000, video_area: 90_000 }), scan(4, { playing: 1, audible: 1, playing_video_area: 400, audible_video_area: 400 })];
  assert.deepEqual(choose_frames(preview_beside_main, "speed"), [{ frame_id: 4, target: "audible" }]);
  assert.deepEqual(choose_frames(preview_beside_main, "pip"), [{ frame_id: 4, target: "audible" }]);
  assert.deepEqual(choose_frames([scan(0, { playing: 2, audible: 1 })], "volume"), [{ frame_id: 0, target: "audible" }]);
});

test("ap pauses every playing element on the tab when anything plays with sound, a muted preview included", () => {
  const scans = [scan(0, { playing: 1, playing_video_area: 90_000, video_area: 90_000 }), scan(4, { playing: 1, audible: 1, playing_video_area: 400, audible_video_area: 400 })];
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

// `scan` is what the frame pushes after it runs the bundle (nothing when undefined). `report_after_ms` delays the push, `reports_twice` pushes it again, and `hangs` swallows the apply.
type Frame = { refuses_scripts?: boolean; scan?: unknown; report_after_ms?: number; reports_twice?: boolean; apply?: (request: MediaRequest) => unknown; hangs?: boolean };

function fake_tab(frames: Record<number, Frame>, { pip = true, inject_delay_ms = 0, answer_timeout_ms = 50, quality = (() => undefined) as (request: QualityRequest) => QualityAnswer | undefined } = {}) {
  const asked: QualityRequest[] = [];
  const injected: number[] = [];
  const applied: { frame_id: number; request: MediaRequest }[] = [];
  const toasts: string[] = [];
  const reports = create_media_reports();
  const deps: MediaDeps = {
    reports,
    inject_all: async (tab_id) => {
      const running = Object.keys(frames).map(Number).reverse().filter((frame_id) => !frames[frame_id]!.refuses_scripts);
      if (running.length === 0) throw new Error("Missing host permission for the tab or frames");
      for (const frame_id of running) {
        injected.push(frame_id);
        const frame = frames[frame_id]!;
        const push = () => reports.receive(tab_id, frame_id, frame.scan as MediaScan);
        if (frame.scan === undefined) continue;
        setTimeout(() => (push(), frame.reports_twice && push()), frame.report_after_ms ?? 0);
      }
      await new Promise((resolve) => setTimeout(resolve, inject_delay_ms));
      return running.length;
    },
    ask: async (_tab_id, frame_id, request) => {
      const frame = frames[frame_id]!;
      if (frame.hangs) return new Promise(() => {});
      applied.push({ frame_id, request });
      return frame.apply?.(request);
    },
    quality: async (_tab_id, request) => (asked.push(request), quality(request)),
    can_picture_in_picture: () => pip,
    toast: async (_ctx, message) => void toasts.push(message),
    answer_timeout_ms,
  };
  return { deps, injected, applied, toasts, reports, asked };
}

const acted = (count: number, fields: Partial<MediaState> = {}): MediaResult => ({ acted: count, state: { ...state, ...fields } });

test("a frame that refuses scripts or never answers counts as one without media", async () => {
  const tab = fake_tab({ 0: { refuses_scripts: true }, 1: {}, 2: { scan: scan(2, { video_area: 10 }), apply: () => acted(1) } });
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.injected.sort(), [1, 2]);
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [2]);
  assert.deepEqual(tab.toasts, ["Speed 1.25x"]);
});

test("a frame that reports something else counts as no media", async () => {
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

test("the key waits for the last frame to report, not for the timeout", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, {}) }, 1: { scan: scan(1, { playing: 1 }), report_after_ms: 30, apply: () => acted(1) } }, { answer_timeout_ms: 5000 });
  const started = Date.now();
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [1]);
});

test("a frame that never reports holds the key only until the timeout, and the others still rank", async () => {
  const tab = fake_tab({ 0: {}, 1: { scan: scan(1, { playing: 1 }), apply: () => acted(1) } });
  const started = Date.now();
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.ok(Date.now() - started >= 45);
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [1]);
});

test("a frame that reports after the timeout, or when no key waits, is dropped", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), report_after_ms: 150, apply: () => acted(1) } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 }), { message: "No video or audio on this page" });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(tab.applied, []);
  // The late report found no listener, so the next key starts with no leftover scan.
  const next = fake_tab({ 0: {} });
  next.reports.receive(4, 0, scan(0, { playing: 1 }));
  await assert.rejects(run_media(next.deps, ctx, { action: "speed", value: "up", times: 1 }), { message: "No video or audio on this page" });
});

test("a frame that reports twice, as a second injection does, still leaves the other frame its turn", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, {}), reports_twice: true }, 3: { scan: scan(3, { playing: 1 }), report_after_ms: 25, apply: () => acted(1) } }, { answer_timeout_ms: 5000 });
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [3]);
});

test("reports that come before the injection resolves count", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), apply: () => acted(1) } }, { inject_delay_ms: 30, answer_timeout_ms: 5000 });
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [0]);
});

test("the frame id comes from the sender, and a report from another tab or with no sender frame is ignored", async () => {
  const tab = fake_tab({ 5: { scan: scan(0, { playing: 1 }), apply: () => acted(1) } });
  tab.deps.inject_all = async (tab_id) => {
    tab.reports.receive(9, 2, scan(2, { playing: 1 }));
    tab.reports.receive(tab_id, undefined, scan(0, { playing: 1 }));
    tab.reports.receive(tab_id, 5, scan(0, { playing: 1 }));
    return 1;
  };
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [5]);
});

test("a call that rejects because one frame threw still takes the reports of the other frames", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), report_after_ms: 20, apply: () => acted(1) } });
  tab.deps.inject_all = async (tab_id) => {
    setTimeout(() => tab.reports.receive(tab_id, 0, scan(0, { playing: 1 })), 20);
    throw new Error("a frame threw");
  };
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.deepEqual(tab.applied.map(({ frame_id }) => frame_id), [0]);
});

test("a chosen frame that hangs on the apply is cut off at the timeout and the others still act", async () => {
  const tab = fake_tab({ 0: { scan: scan(0, { playing: 1 }), hangs: true }, 1: { scan: scan(1, { playing: 1 }), apply: () => acted(1) } });
  const started = Date.now();
  await run_media(tab.deps, ctx, { action: "speed", value: "up", times: 1 });
  assert.ok(Date.now() - started >= 45);
  assert.deepEqual(tab.toasts, ["Speed 1.25x"]);
});

test("a page that refuses the bundle, such as a privileged one, refuses with no media once the wait ends", async () => {
  const tab = fake_tab({ 0: { refuses_scripts: true } });
  await assert.rejects(run_media(tab.deps, ctx, { action: "play_pause" }), { message: "No video or audio on this page" });
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

test("a player that never answers refuses at the timeout, not never", async () => {
  const tab = fake_tab({ 0: {} });
  tab.deps.quality = () => new Promise(() => {});
  await assert.rejects(run_media(tab.deps, ctx, { action: "quality" }), { message: "No quality control on this page" });
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
