// The load the `media_quality` rule puts on a page, counted per frame for one hard load (an address change, the load finishing, then the about:blank pass). The probe goes into every frame each time, and the `quality` bundle only into a frame whose probe found a video, once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { create_media_quality, rule_for_report } from "../src/background/media_quality.ts";
import { create_probe } from "../src/content/quality/probe.ts";
import { create_rule } from "../src/content/quality/rule.ts";

type Page = { videos: readonly boolean[]; off?: boolean };

// One tab. Frame 0 is the top. Running the probe in a frame does what `src/content/quality/probe_main.ts` does, and loading the bundle does what `main.ts` does: the first run of a frame is a navigation, a later one at the same address is not.
async function load_page({ videos, off = false }: Page) {
  const counts = { probe_runs: 0, bundle_loads: 0, reports: 0, keymap_reads: 0, timers_left: 0 };
  const web = "https://news.test/";
  const loaded: boolean[] = videos.map(() => false);
  const timers: (() => void)[] = [];
  // The background is built below, and a frame's probe reports to it.
  const frames: { probe: ReturnType<typeof create_probe>; rule: ReturnType<typeof create_rule>; bundle_runs: number }[] = [];
  const quality = create_media_quality({
    is_off: async () => off,
    inject_all: async () => void frames.forEach((frame) => (counts.probe_runs++, frame.probe.run())),
    inject_about_blank: async () => void frames.forEach((frame) => (counts.probe_runs++, frame.probe.run())),
    frame_address: async () => web,
    inject_frame: async (_tab_id, frame_id) => {
      counts.bundle_loads++;
      loaded[frame_id] = true;
      const frame = frames[frame_id]!;
      await frame.rule.start(frame.bundle_runs++ === 0);
    },
    wait: async () => undefined,
    settle_ms: 1000,
  });
  videos.forEach((video, frame_id) => {
    const rule = create_rule({
      report: async () => (counts.reports++, rule_for_report({ type: "quality_report", player: false, ready: false, has_video: video }, { is_disabled: async () => false, value_for_frame: async () => (counts.keymap_reads++, "max") })),
      has_media: () => video,
      probe: () => undefined,
      sleep: () => new Promise<void>((wake) => timers.push(wake)),
      now: () => 0,
    });
    const probe = create_probe({
      has_video: () => video,
      address: () => web,
      report: () => quality.probe_reported(1, frame_id, web),
      watch: () => undefined,
      sleep: () => new Promise<void>((wake) => timers.push(wake)),
      now: () => 0,
    });
    frames.push({ probe, rule, bundle_runs: 0 });
  });
  await quality.tab_updated(1, { url: web }, web);
  await quality.tab_updated(1, { status: "complete" }, web);
  await new Promise((resolve) => setTimeout(resolve, 0));
  counts.timers_left = timers.length;
  return { counts, loaded };
}

test("a page with no video runs the probe 3 times per frame, loads no bundle, sends no report and reads no keymap", async () => {
  for (const frames of [5, 200]) {
    const { counts } = await load_page({ videos: Array<boolean>(frames).fill(false) });
    assert.deepEqual(counts, { probe_runs: 3 * frames, bundle_loads: 0, reports: 0, keymap_reads: 0, timers_left: frames }, `${frames} frames`);
  }
});

test("only the frames with a video load the bundle, once each, and each reports once", async () => {
  const { counts, loaded } = await load_page({ videos: [false, true, false, true, false] });
  assert.deepEqual(loaded, [false, true, false, true, false]);
  assert.equal(counts.bundle_loads, 2);
  assert.equal(counts.reports, 2);
  assert.equal(counts.keymap_reads, 2);
});

test("a page whose rule is off everywhere runs nothing", async () => {
  const { counts } = await load_page({ videos: [true, false], off: true });
  assert.deepEqual(counts, { probe_runs: 0, bundle_loads: 0, reports: 0, keymap_reads: 0, timers_left: 0 });
});
