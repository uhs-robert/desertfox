// The load the `media_quality` rule puts on a page with no video, counted per frame for one hard load (an address change, the load finishing, then the about:blank pass). Before the fix each frame cost 3 injections, 3 reports, 11 `read_media_quality` messages with a keymap read each, and 100 driver probes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { create_media_quality, rule_for_report } from "../src/background/media_quality.ts";
import { create_rule } from "../src/content/quality/rule.ts";

// One tab of `frame_count` frames with no video. Running the bundle in a frame does what `src/content/quality/main.ts` does: the first run of a frame is a navigation, a later one at the same address is not.
async function load_page(frame_count: number, { off = false } = {}) {
  const counts = { injections: 0, reports: 0, keymap_reads: 0, probes: 0, timers_left: 0 };
  const rules = Array.from({ length: frame_count }, () => {
    const timers: (() => void)[] = [];
    const rule = create_rule({
      report: async () => (counts.reports++, rule_for_report({ type: "quality_report", player: false, ready: false, has_video: false }, { is_disabled: async () => false, value_for_frame: async () => (counts.keymap_reads++, "max") })),
      has_media: () => false,
      probe: () => (counts.probes++, undefined),
      sleep: () => new Promise<void>((wake) => timers.push(wake)),
      now: () => 0,
    });
    return { rule, runs: 0, timers };
  });
  const run_in_frames = async () => {
    for (const frame of rules) {
      counts.injections++;
      await frame.rule.start(frame.runs++ === 0);
    }
  };
  const quality = create_media_quality({ is_off: async () => off, inject_all: run_in_frames, inject_about_blank: run_in_frames, wait: async () => undefined, settle_ms: 1000 });
  const web = "https://news.test/";
  await quality.tab_updated(1, { url: web }, web);
  await quality.tab_updated(1, { status: "complete" }, web);
  await new Promise((resolve) => setTimeout(resolve, 0));
  counts.timers_left = rules.reduce((sum, frame) => sum + frame.timers.length, 0);
  return counts;
}

test("a page with no video costs each frame 3 injections and 3 reports, no keymap read, driver probe or rule message, and one waiting timer", async () => {
  for (const frames of [5, 200]) {
    const counts = await load_page(frames);
    assert.deepEqual(counts, { injections: 3 * frames, reports: 3 * frames, keymap_reads: 0, probes: 0, timers_left: frames }, `${frames} frames`);
  }
});

test("a page whose rule is off everywhere injects nothing", async () => {
  assert.deepEqual(await load_page(5, { off: true }), { injections: 0, reports: 0, keymap_reads: 0, probes: 0, timers_left: 0 });
});
