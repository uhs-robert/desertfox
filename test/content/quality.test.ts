import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_quality } from "../../src/content/quality/apply.ts";
import { choose_level } from "../../src/content/quality/choose_level.ts";
import { hls_driver } from "../../src/content/quality/hls.ts";
import { youtube_driver } from "../../src/content/quality/youtube.ts";
import type { QualityRequest } from "../../src/shared/quality.ts";

const levels = [{ height: 360 }, { height: 480 }, { height: 720 }, { height: 1080 }, { height: 2160 }];
const pick = (value: string, current?: number, times = 1) => choose_level(levels, value, current, times)?.height;

test("max and min take the ends, and auto is not a level", () => {
  assert.equal(pick("max"), 2160);
  assert.equal(pick("min"), 360);
  assert.equal(choose_level([], "max", undefined, 1), undefined);
});

test("a height takes the highest level at or below it, else the lowest, with or without p", () => {
  assert.equal(pick("1080"), 1080);
  assert.equal(pick("1080p"), 1080);
  assert.equal(pick("900"), 720);
  assert.equal(pick("5000"), 2160);
  assert.equal(pick("100"), 360);
});

test("up and down move by the count from the current level and stop at the ends", () => {
  assert.equal(pick("down", 3), 720);
  assert.equal(pick("down", 3, 2), 480);
  assert.equal(pick("down", 1, 5), 360);
  assert.equal(pick("up", 3), 2160);
  assert.equal(pick("up", 4), 2160);
  assert.equal(pick("up", 0, 2), 720);
  // No playing level reads as the top.
  assert.equal(pick("down"), 1080);
  assert.equal(pick("up"), 2160);
});

// A page object as the page's own script would define it. `calls` records each call the driver makes.
function youtube_page(player: Record<string, unknown> | null) {
  return { document: { getElementById: (id: string) => (id === "movie_player" ? player : null) } };
}
function movie_player(playing: string, calls: unknown[][] = []) {
  return {
    getAvailableQualityLevels: () => ["hd1080", "hd720", "large"],
    getAvailableQualityData: () => [
      { quality: "hd1080", qualityLabel: "1080p Premium", isPlayable: true },
      { quality: "hd1080", qualityLabel: "1080p", isPlayable: true },
      { quality: "hd720", qualityLabel: "720p", isPlayable: true },
      { quality: "large", qualityLabel: "480p", isPlayable: true },
      { quality: "medium", qualityLabel: "360p", isPlayable: false },
    ],
    getPlaybackQuality: () => playing,
    setPlaybackQualityRange: (...args: unknown[]) => calls.push(["range", ...args]),
    setPlaybackQuality: (...args: unknown[]) => calls.push(["single", ...args]),
    nextVideo: () => calls.push(["next"]),
    previousVideo: () => calls.push(["previous"]),
  };
}
const request = (op: QualityRequest["op"], value?: string, times = 1): QualityRequest => ({ type: "quality_apply", op, value, times });

test("YouTube lists the playable levels ascending with the plain label and the playing one active", () => {
  const driver = youtube_driver(youtube_page(movie_player("hd720")))!;
  assert.deepEqual(driver.levels().map(({ label, height, active }) => [label, height, active]), [["480p", 480, false], ["720p", 720, true], ["1080p", 1080, false]]);
});

test("YouTube sets a level as a one-level range, and auto as the full span", () => {
  const calls: unknown[][] = [];
  const driver = youtube_driver(youtube_page(movie_player("hd720", calls)))!;
  assert.deepEqual(apply_quality(driver, request("set", "max")).chosen, "1080p");
  assert.deepEqual(apply_quality(driver, request("set", "480")).chosen, "480p");
  assert.deepEqual(apply_quality(driver, request("set", "down")).chosen, "480p");
  apply_quality(driver, request("set", "auto"));
  assert.deepEqual(calls, [["range", "hd1080", "hd1080"], ["range", "large", "large"], ["range", "large", "large"], ["range", "large", "hd1080"]]);
});

test("YouTube falls back to the single-level call when the range call is missing", () => {
  const calls: unknown[][] = [];
  const player = { ...movie_player("hd720", calls), setPlaybackQualityRange: undefined };
  apply_quality(youtube_driver(youtube_page(player))!, request("set", "min"));
  assert.deepEqual(calls, [["single", "large"]]);
});

test("a YouTube player that answers unknown has no levels yet, and a set picks nothing", () => {
  const calls: unknown[][] = [];
  const driver = youtube_driver(youtube_page(movie_player("unknown", calls)))!;
  assert.deepEqual(driver.levels(), []);
  assert.deepEqual(apply_quality(driver, request("set", "max")), { levels: [] });
  assert.deepEqual(calls, []);
});

test("YouTube skips with its own calls, and a page with no player or another element has no driver", () => {
  const calls: unknown[][] = [];
  const driver = youtube_driver(youtube_page(movie_player("hd720", calls)))!;
  assert.deepEqual(apply_quality(driver, request("skip", "next")), { levels: [], skipped: true });
  assert.deepEqual(apply_quality(driver, request("skip", "previous")), { levels: [], skipped: true });
  assert.deepEqual(calls, [["next"], ["previous"]]);
  assert.equal(youtube_driver(youtube_page(null)), undefined);
  assert.equal(youtube_driver(youtube_page({})), undefined);
});

test("the driver reads the page again for each call, so a player the site replaced is found", () => {
  const calls: unknown[][] = [];
  let player = movie_player("hd720", calls);
  const page = { document: { getElementById: () => player } };
  assert.equal(youtube_driver(page)!.levels().length, 3);
  const old = player;
  player = { ...movie_player("hd1080", calls), getAvailableQualityData: () => [{ quality: "hd1080", qualityLabel: "1080p", isPlayable: true }] };
  assert.notEqual(old, player);
  assert.deepEqual(youtube_driver(page)!.levels().map(({ label }) => label), ["1080p"]);
});

function hls_page(levels: unknown, current = 1) {
  const hls = { levels, currentLevel: current, nextLevel: current };
  return { page: { html5player: { hlsobj: hls } }, hls };
}
const hls_levels = [{ height: 240 }, { height: 480 }, { height: 720 }];

test("hls lists the levels by height, sets current and next level, and auto is -1", () => {
  const { page, hls } = hls_page(hls_levels);
  const driver = hls_driver(page)!;
  assert.deepEqual(driver.levels().map(({ label, active }) => [label, active]), [["240p", false], ["480p", true], ["720p", false]]);
  assert.equal(apply_quality(driver, request("set", "max")).chosen, "720p");
  assert.deepEqual([hls.currentLevel, hls.nextLevel], [2, 2]);
  apply_quality(driver, request("set", "auto"));
  assert.deepEqual([hls.currentLevel, hls.nextLevel], [-1, -1]);
});

test("hls offers no skip, and no handle or an empty levels list gives no driver or no levels", () => {
  const { page } = hls_page(hls_levels);
  assert.deepEqual(apply_quality(hls_driver(page)!, request("skip", "next")), { levels: [], skipped: false });
  assert.equal(hls_driver({}), undefined);
  assert.equal(hls_driver({ html5player: {} }), undefined);
  assert.deepEqual(hls_driver(hls_page([]).page)!.levels(), []);
});

test("a list request reads the levels and changes nothing", () => {
  const { page, hls } = hls_page(hls_levels);
  assert.deepEqual(apply_quality(hls_driver(page)!, request("list")).levels.map(({ label }) => label), ["240p", "480p", "720p"]);
  assert.deepEqual([hls.currentLevel, hls.nextLevel], [1, 1]);
});

test("a hostile page cannot hang the bundle or pass a prototype key as a level", () => {
  let reads = 0;
  const huge = { get length() { return (reads++, 1e9); } } as unknown as Record<number, unknown>;
  const page = youtube_page({ ...movie_player("hd720"), getAvailableQualityData: () => huge });
  const started = Date.now();
  assert.deepEqual(youtube_driver(page)!.levels(), []);
  assert.ok(Date.now() - started < 200);
  assert.equal(reads, 1);
  const proto = youtube_page({ ...movie_player("hd720"), getAvailableQualityData: () => [{ quality: "constructor", isPlayable: true }, { quality: "toString" }, { quality: "hd720", qualityLabel: "720p", isPlayable: true }] });
  assert.deepEqual(youtube_driver(proto)!.levels().map(({ label }) => label), ["720p"]);
  const throwing = youtube_page({ ...movie_player("hd720"), getAvailableQualityData: () => [{ quality: { toString: () => { throw new Error("trap"); } } }] });
  assert.throws(() => youtube_driver(throwing)!.levels(), /trap/);
  const bad_heights = hls_page([{ height: -5 }, { height: Infinity }, { height: 480 }]);
  assert.deepEqual(hls_driver(bad_heights.page)!.levels().map(({ label }) => label), ["480p"]);
});

test("auto on a YouTube player with no levels yet does nothing and does not claim a choice", () => {
  const calls: unknown[][] = [];
  const driver = youtube_driver(youtube_page(movie_player("unknown", calls)))!;
  assert.deepEqual(apply_quality(driver, request("set", "auto")), { levels: [] });
  assert.deepEqual(calls, []);
});
