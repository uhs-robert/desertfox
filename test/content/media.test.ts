import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_in_frame, media_in, next_level, scan_frame, visible_area, type FrameView, type Player } from "../../src/content/media/frame_media.ts";
import { choose_frames } from "../../src/background/media_actions.ts";
import { SEEK_RULE, SPEED_RULE, VOLUME_RULE, type MediaRequest } from "../../src/shared/media.ts";

type Apply = Extract<MediaRequest, { type: "media_apply" }>;
const apply = (fields: Partial<Apply>): Apply => ({ type: "media_apply", target: "largest", action: "speed", value: undefined, times: 1, ...fields });

function player(fields: Partial<Player> = {}): Player & { calls: string[] } {
  const calls: string[] = [];
  return {
    localName: "video",
    paused: true,
    loop: false,
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

function frame(entries: { player: Player; area: number }[], pip: { element: unknown } = { element: null }, full: { element: unknown } = { element: null }, pin: { player?: Player } = {}): FrameView {
  return {
    site_volume: () => undefined,
    players: () => entries.map((entry) => ({ ...entry, pinned_: entry.player === pin.player })),
    pip_element: () => pip.element,
    exit_pip: async () => void (pip.element = null),
    fullscreen_element: () => full.element,
    toggle_fullscreen: async (target) => void (full.element = full.element ? null : target),
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
  assert.deepEqual(scan_frame(view), { count: 4, playing: 2, audible: 2, playing_audio: 1, audible_audio: 1, video_area: 2000, playing_video_area: 100, audible_video_area: 100, pip_open: false, fullscreen_open: false, pinned: false, has_video: true });
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

test("an audible target changes the element with sound and leaves a muted one that also plays", async () => {
  const [muted, heard, silent] = [player({ paused: false, muted: true }), player({ paused: false }), player({ paused: false, volume: 0 })];
  const view = frame([
    { player: muted, area: 900 },
    { player: heard, area: 10 },
    { player: silent, area: 10 },
  ]);
  assert.equal(scan_frame(view).audible, 1);
  const result = await apply_in_frame(view, apply({ target: "audible", action: "play_pause" }));
  assert.deepEqual([muted.calls, heard.calls, silent.calls], [[], ["pause"], []]);
  assert.equal(result.acted, 1);
});

test("a muted preview that plays beside a paused main video takes the playing target, so the main video is not touched", async () => {
  const [preview, main] = [player({ paused: false, muted: true }), player()];
  const view = frame([
    { player: preview, area: 100 },
    { player: main, area: 5000 },
  ]);
  assert.deepEqual(scan_frame(view), { count: 2, playing: 1, audible: 0, playing_audio: 0, audible_audio: 0, video_area: 5000, playing_video_area: 100, audible_video_area: 0, pip_open: false, fullscreen_open: false, pinned: false, has_video: true });
});

test("speed, volume and seek with no value write nothing, since even an equal currentTime seeks", async () => {
  const writes: string[] = [];
  const video = player({ volume: 0.333, currentTime: 12 });
  const watched = new Proxy(video, { set: (target, key, value) => (writes.push(String(key)), Reflect.set(target, key, value)) });
  const view = frame([{ player: watched, area: 5 }]);
  for (const action of ["speed", "volume", "seek"] as const) {
    const result = await apply_in_frame(view, apply({ action, value: undefined }));
    assert.equal(result.acted, 1);
  }
  assert.deepEqual(writes, []);
  assert.equal(video.volume, 0.333);
});

test("a play() that has not settled within the grace counts as started", async () => {
  const pending = player({ play: function (this: Player) { this.paused = false; return new Promise<void>(() => {}); } });
  const result = await apply_in_frame(frame([{ player: pending, area: 5 }]), apply({ action: "play_pause" }));
  assert.equal(result.acted, 1);
  assert.equal(result.state?.paused, false);
});

test("ap beside a muted preview pauses then resumes the main video in two presses", async () => {
  const main = player({ paused: false });
  const preview = player({ paused: false, muted: true });
  const entries = [
    { player: main, area: 5000 },
    { player: preview, area: 100 },
  ];
  const view = frame(entries);
  const press = async () => {
    const scan = scan_frame(view);
    const [plan] = choose_frames([{ ...scan, frame_id: 0 }], "play_pause");
    return apply_in_frame(view, apply({ action: "play_pause", target: plan!.target }));
  };
  assert.equal((await press()).state?.paused, true);
  assert.deepEqual([main.paused, preview.paused], [true, true]);
  assert.equal((await press()).state?.paused, false);
  assert.deepEqual([main.calls, preview.calls], [["pause", "play"], ["pause"]]);
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
  assert.deepEqual([video.volume, video.currentTime], [0.38, 100]);
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

test("picture-in-picture reads as on when the document names the shadow host, not the video", async () => {
  const host = { localName: "x-player" };
  const pip = { element: null as unknown };
  const video = player({ requestPictureInPicture: async () => void (pip.element = host) });
  const opened = await apply_in_frame(frame([{ player: video, area: 50 }], pip), apply({ action: "pip" }));
  assert.equal(opened.state?.pip, true);
});

test("the visible area clips the box to the viewport and counts a hidden element as 0", () => {
  const element = (box: { left: number; top: number; right: number; bottom: number }, visible = true) => ({ getBoundingClientRect: () => box, checkVisibility: () => visible }) as unknown as Element;
  assert.equal(visible_area(element({ left: 0, top: 0, right: 100, bottom: 50 }), 800, 600), 5000);
  assert.equal(visible_area(element({ left: -50, top: 580, right: 50, bottom: 640 }), 800, 600), 50 * 20);
  assert.equal(visible_area(element({ left: 0, top: 700, right: 100, bottom: 800 }), 800, 600), 0);
  assert.equal(visible_area(element({ left: 0, top: 0, right: 100, bottom: 50 }, false), 800, 600), 0);
});

test("a second injection into the same frame adds no second listener, and the listener answers a scan", async () => {
  const listeners: unknown[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = {};
  globals.document = { querySelectorAll: () => [], pictureInPictureElement: null };
  globals.innerWidth = 800;
  globals.innerHeight = 600;
  globals.browser = { runtime: { onMessage: { addListener: (listener: unknown) => listeners.push(listener) } } };
  try {
    // A query makes a fresh module instance, as a second executeScript runs the file again.
    const entry = new URL("../../src/content/media/main.ts", import.meta.url).href;
    await import(`${entry}?first`);
    await import(`${entry}?second`);
    assert.equal(listeners.length, 1);
    const scan = await (listeners[0] as (message: unknown) => Promise<{ count: number }>)({ type: "media_scan" });
    assert.equal(scan.count, 0);
    const answer = (listeners[0] as (message: unknown) => unknown)({ type: "run_in_content" });
    assert.equal(answer, undefined);
  } finally {
    delete globals.window;
    delete globals.document;
    delete globals.innerWidth;
    delete globals.innerHeight;
    delete globals.browser;
  }
});

test("seek end and percent go to the media end and to the count as a percent, and a live stream stays", () => {
  const seek = { ...SEEK_RULE, max: 200 };
  assert.equal(next_level(5, "end", 1, seek), 200);
  assert.equal(next_level(5, "percent", 50, seek), 100);
  assert.equal(next_level(5, "percent", 250, seek), 200);
  assert.equal(next_level(5, "end", 1, SEEK_RULE), 5);
  assert.equal(next_level(5, "percent", 50, SEEK_RULE), 5);
  assert.equal(next_level(40, "percent", 30, VOLUME_RULE), 30);
});

test("mute and loop toggle on the chosen element, and info changes nothing", async () => {
  const video = player({ paused: false });
  const view = frame([{ player: video, area: 10 }]);
  const muted = await apply_in_frame(view, apply({ target: "playing", action: "mute" }));
  assert.equal(video.muted, true);
  assert.equal(muted.state?.muted, true);
  await apply_in_frame(view, apply({ target: "playing", action: "mute" }));
  assert.equal(video.muted, false);
  const looped = await apply_in_frame(view, apply({ action: "loop" }));
  assert.equal(video.loop, true);
  assert.equal(looped.state?.loop, true);
  const info = await apply_in_frame(view, apply({ action: "info" }));
  assert.deepEqual([info.acted, video.loop, video.muted, video.currentTime], [1, true, false, 0]);
});

test("fullscreen takes the largest video once, never audio, and the next press leaves it", async () => {
  const small = player();
  const big = player();
  const sound = player({ localName: "audio" });
  const full = { element: null as unknown };
  const view = frame([{ player: small, area: 10 }, { player: big, area: 90 }, { player: sound, area: 0 }], { element: null }, full);
  const first = await apply_in_frame(view, apply({ action: "fullscreen" }));
  assert.equal(full.element, big);
  assert.deepEqual([first.acted, first.state?.fullscreen], [1, true]);
  const second = await apply_in_frame(view, apply({ action: "fullscreen" }));
  assert.equal(full.element, null);
  assert.equal(second.state?.fullscreen, false);
  assert.equal((await apply_in_frame(frame([{ player: sound, area: 0 }]), apply({ action: "fullscreen" }))).acted, 0);
});

test("a pinned target acts on the pinned video only, and a pin that left the page acts on nothing", async () => {
  const big = player({ localName: "video" });
  const small = player({ localName: "video" });
  const pin: { player?: Player } = { player: small };
  const view = frame([{ player: big, area: 9000 }, { player: small, area: 10 }], { element: null }, { element: null }, pin);
  const request = { type: "media_apply", target: "pinned", action: "mute", value: undefined, times: 1 } as const;
  const result = await apply_in_frame(view, request);
  assert.equal(result.acted, 1);
  assert.equal(small.muted, true);
  assert.equal(big.muted, false);
  delete pin.player;
  assert.equal((await apply_in_frame(view, request)).acted, 0);
  assert.equal(scan_frame(view).pinned, false);
});

test("play_pause on the pinned video toggles it even when another video plays", async () => {
  const other = player({ localName: "video", paused: false });
  const pinned = player({ localName: "video", paused: true });
  const view = frame([{ player: other, area: 9000 }, { player: pinned, area: 10 }], { element: null }, { element: null }, { player: pinned });
  await apply_in_frame(view, { type: "media_apply", target: "pinned", action: "play_pause", value: undefined, times: 1 });
  assert.equal(pinned.paused, false);
  assert.equal(other.paused, false);
});

const track = (kind: string, mode = "disabled", extra: Record<string, unknown> = {}) => ({ kind, mode, ...extra });

test("captions on shows the default subtitle track, else the first, and ignores other kinds", async () => {
  const tracks = [track("chapters"), track("subtitles"), track("captions")];
  // The default flag sits on the <track> element, whose `track` is the TextTrack.
  const querySelector = () => ({ track: tracks[2] });
  const result = await apply_in_frame(frame([{ player: player({ textTracks: tracks, querySelector }), area: 1 }]), apply({ action: "captions" }));
  assert.deepEqual(tracks.map(({ mode }) => mode), ["disabled", "disabled", "showing"]);
  assert.equal(result.state?.captions, "on");
  const plain = [track("subtitles"), track("subtitles")];
  await apply_in_frame(frame([{ player: player({ textTracks: plain }), area: 1 }]), apply({ action: "captions" }));
  assert.deepEqual(plain.map(({ mode }) => mode), ["showing", "disabled"]);
});

test("captions off disables every showing track, and a hidden track reads as off", async () => {
  const tracks = [track("subtitles", "showing"), track("captions", "showing")];
  const result = await apply_in_frame(frame([{ player: player({ textTracks: tracks }), area: 1 }]), apply({ action: "captions" }));
  assert.deepEqual(tracks.map(({ mode }) => mode), ["disabled", "disabled"]);
  assert.equal(result.state?.captions, "off");
  const hidden = await apply_in_frame(frame([{ player: player({ textTracks: [track("subtitles", "hidden")] }), area: 1 }]), apply({ action: "info" }));
  assert.equal(hidden.state?.captions, "off");
});

test("a video with no subtitle track reports captions none and changes nothing", async () => {
  const result = await apply_in_frame(frame([{ player: player({ textTracks: [track("metadata")] }), area: 1 }]), apply({ action: "captions" }));
  assert.equal(result.state?.captions, "none");
  assert.equal((await apply_in_frame(frame([{ player: player(), area: 1 }]), apply({ action: "captions" }))).state?.captions, "none");
});

test("frame steps pause a playing video, move a thirtieth per count and stay within the media", async () => {
  const video = player({ paused: false, currentTime: 10 });
  await apply_in_frame(frame([{ player: video, area: 1 }]), apply({ action: "frame", value: "up", times: 3 }));
  assert.equal(video.paused, true);
  assert.ok(Math.abs(video.currentTime - 10.1) < 1e-9);
  await apply_in_frame(frame([{ player: video, area: 1 }]), apply({ action: "frame", value: "down", times: 6 }));
  assert.ok(Math.abs(video.currentTime - 9.9) < 1e-9);
  const start = player({ currentTime: 0.01 });
  await apply_in_frame(frame([{ player: start, area: 1 }]), apply({ action: "frame", value: "down" }));
  assert.equal(start.currentTime, 0);
  const end = player({ currentTime: 99.99, duration: 100 });
  await apply_in_frame(frame([{ player: end, area: 1 }]), apply({ action: "frame", value: "up", times: 5 }));
  assert.equal(end.currentTime, 100);
});

test("the media command takes frame up and down and refuses other frame values", async () => {
  const { check_args } = await import("../../src/shared/registry/check_args.ts");
  await import("../../src/background/command_modules.ts");
  const { registry } = await import("../../src/shared/registry/builtin.ts");
  const media = registry.get("media.act")!;
  assert.equal(check_args(media, { action: "frame", value: "up", times: 3 }).ok, true);
  assert.equal(check_args(media, { action: "frame", value: "down" }).ok, true);
  for (const value of ["next", "2", "+1"]) assert.equal(check_args(media, { action: "frame", value }).ok, false, value);
  assert.equal(check_args(media, { action: "captions" }).ok, true);
  assert.equal(check_args(media, { action: "captions", value: "up" }).ok, false);
});

test("captions read none only when no acted-on player has a track", async () => {
  const bare = player({ paused: false });
  const withtrack = player({ paused: false, textTracks: [track("subtitles", "showing")] });
  const result = await apply_in_frame(frame([{ player: bare, area: 1 }, { player: withtrack, area: 1 }]), apply({ action: "captions", target: "playing" }));
  assert.equal(result.state?.captions, "off");
});

test("a frame step leaves audio alone and acts on nothing without a video", async () => {
  const audio = player({ localName: "audio", currentTime: 5, paused: false });
  const video = player({ currentTime: 5, paused: false });
  const result = await apply_in_frame(frame([{ player: audio, area: 0 }, { player: video, area: 1 }]), apply({ action: "frame", value: "up", target: "playing" }));
  assert.equal(audio.currentTime, 5);
  assert.deepEqual(audio.calls, []);
  assert.equal(result.acted, 1);
  assert.equal((await apply_in_frame(frame([{ player: audio, area: 0 }]), apply({ action: "frame", value: "up" }))).acted, 0);
});

test("a default track that is not the first is the one captions show", async () => {
  const tracks = [track("subtitles"), track("subtitles")];
  await apply_in_frame(frame([{ player: player({ textTracks: tracks, querySelector: () => ({ track: tracks[1] }) }), area: 1 }]), apply({ action: "captions" }));
  assert.deepEqual(tracks.map(({ mode }) => mode), ["disabled", "showing"]);
});

test("a frame step with audio playing and a paused video steps the video", async () => {
  const audio = player({ localName: "audio", paused: false });
  const video = player({ currentTime: 5 });
  const result = await apply_in_frame(frame([{ player: audio, area: 0 }, { player: video, area: 1 }]), apply({ action: "frame", value: "up", target: "largest" }));
  assert.equal(result.acted, 1);
  assert.ok(video.currentTime > 5);
});
