import assert from "node:assert/strict";
import { test } from "node:test";
import { create_probe, PROBE_LOOK_MS, PROBE_SPAN_MS } from "../src/content/quality/probe.ts";
import { has_player_handle } from "../src/content/quality/find_video.ts";

// A document the test controls. `sleep` parks the look-again loop until `tick`, which moves the clock on by one look. `accept` is the background's answer to a report.
function make({ video = false } = {}) {
  const state = { video, address: "https://site.test/a", now: 0, accept: true, hold: false };
  const held: (() => void)[] = [];
  const reports: boolean[] = [];
  const watchers: ((from_video: boolean) => void)[] = [];
  const sleepers: (() => void)[] = [];
  let searches = 0;
  const probe = create_probe({
    has_video: () => (searches++, state.video),
    address: () => state.address,
    report: (found) => {
      reports.push(found);
      const answer = state.accept;
      return state.hold ? new Promise<boolean>((resolve) => held.push(() => resolve(answer))) : Promise.resolve(answer);
    },
    watch: (on_media) => void watchers.push(on_media),
    sleep: () => new Promise<void>((resolve) => sleepers.push(resolve)),
    now: () => state.now,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const tick = async () => {
    state.now += PROBE_LOOK_MS;
    for (const wake of sleepers.splice(0)) wake();
    await settle();
  };
  return { held, probe, state, reports, watchers, sleepers, tick, settle, searches: () => searches };
}

test("a document with a video reports once however often the injection runs, and arms one watch", async () => {
  const page = make({ video: true });
  for (let run = 0; run < 3; run++) {
    page.probe.run();
    await page.settle();
  }
  assert.deepEqual(page.reports, [true]);
  assert.equal(page.watchers.length, 1);
  assert.equal(page.sleepers.length, 0);
});

test("three injections that arrive before the first answer send one report", async () => {
  const page = make({ video: true });
  for (let run = 0; run < 3; run++) page.probe.run();
  await page.settle();
  assert.deepEqual(page.reports, [true]);
});

test("a document with no video reports nothing, runs one look-again loop for the three injections, and leaves no timer after the span", async () => {
  const page = make();
  for (let run = 0; run < 3; run++) page.probe.run();
  assert.equal(page.sleepers.length, 1);
  for (let elapsed = 0; elapsed < PROBE_SPAN_MS; elapsed += PROBE_LOOK_MS) await page.tick();
  assert.deepEqual(page.reports, []);
  assert.equal(page.sleepers.length, 0);
  assert.equal(page.watchers.length, 1);
});

test("a video that appears later is found by the look-again, and the loop stops", async () => {
  const page = make();
  page.probe.run();
  page.state.video = true;
  await page.tick();
  assert.deepEqual(page.reports, [true]);
  assert.equal(page.sleepers.length, 0);
});

test("a media event from a video reports a late player without a search, and a second event adds nothing", async () => {
  const page = make();
  page.probe.run();
  const searches = page.searches();
  page.watchers[0]!(true);
  await page.settle();
  page.watchers[0]!(true);
  await page.settle();
  assert.deepEqual(page.reports, [true]);
  assert.equal(page.searches(), searches);
});

test("a media event from an audio element reports nothing", async () => {
  const page = make();
  page.probe.run();
  page.watchers[0]!(false);
  await page.settle();
  assert.deepEqual(page.reports, []);
});

test("a report the background refused (the rule is off) is sent again at the same address once the rule is on", async () => {
  const page = make();
  page.state.accept = false;
  page.probe.run();
  page.state.video = true;
  await page.tick();
  assert.deepEqual(page.reports, [true]);
  // The rule turns on and the settings change injects the probe again.
  page.state.accept = true;
  page.probe.run();
  await page.settle();
  assert.deepEqual(page.reports, [true, true]);
  page.probe.run();
  await page.settle();
  assert.deepEqual(page.reports, [true, true]);
});

test("a refused report leaves the media event able to report again", async () => {
  const page = make();
  page.probe.run();
  page.state.accept = false;
  page.watchers[0]!(true);
  await page.settle();
  page.state.accept = true;
  page.watchers[0]!(true);
  await page.settle();
  assert.deepEqual(page.reports, [true, true]);
});

test("a later injection in a document that found no video looks again for the whole span", async () => {
  const page = make();
  page.probe.run();
  for (let elapsed = 0; elapsed < PROBE_SPAN_MS - PROBE_LOOK_MS; elapsed += PROBE_LOOK_MS) await page.tick();
  page.probe.run();
  page.state.video = true;
  for (let elapsed = 0; elapsed < PROBE_SPAN_MS; elapsed += PROBE_LOOK_MS) await page.tick();
  assert.deepEqual(page.reports, [true]);
});

test("a navigation inside the document after a report reports again, whether or not the new page has a video", async () => {
  const page = make({ video: true });
  page.probe.run();
  await page.settle();
  page.probe.run();
  page.state.address = "https://site.test/b";
  page.state.video = false;
  page.probe.run();
  await page.settle();
  page.probe.run();
  await page.settle();
  assert.deepEqual(page.reports, [true, false]);
  assert.equal(page.watchers.length, 1);
});

test("a video that comes after a no-video report on the new page is still found", async () => {
  const page = make({ video: true });
  page.probe.run();
  await page.settle();
  page.state.address = "https://site.test/b";
  page.state.video = false;
  page.probe.run();
  await page.settle();
  assert.equal(page.sleepers.length, 1);
  page.state.video = true;
  await page.tick();
  assert.deepEqual(page.reports, [true, false, true]);
});

test("a navigation inside a document that never reported starts no second loop and still reports a video it finds", async () => {
  const page = make();
  page.probe.run();
  page.state.address = "https://site.test/b";
  page.probe.run();
  assert.equal(page.sleepers.length, 1);
  page.state.video = true;
  await page.tick();
  assert.deepEqual(page.reports, [true]);
});

test("a frame with a YouTube or an hls.js handle counts, a bare frame does not", () => {
  const bare = { document: { getElementById: () => null } };
  const youtube = { document: { getElementById: () => ({ getAvailableQualityLevels: () => [] }) } };
  const hls = { document: { getElementById: () => null }, html5player: { hlsobj: { levels: [] } } };
  assert.deepEqual([bare, youtube, hls].map(has_player_handle), [false, true, true]);
  assert.equal(has_player_handle({ document: { getElementById: () => ({}) }, html5player: {} }), false);
});

test("a navigation that comes while a report is out is reported when that report settles", async () => {
  const page = make({ video: true });
  page.state.hold = true;
  page.probe.run();
  page.state.address = "https://site.test/b";
  page.probe.run();
  assert.deepEqual(page.reports, [true]);
  page.held.shift()!();
  await page.settle();
  assert.deepEqual(page.reports, [true, true]);
  page.held.shift()!();
  await page.settle();
  page.probe.run();
  await page.settle();
  assert.deepEqual(page.reports, [true, true]);
});

test("a second injection at the new address while the first report is still out adds no third report", async () => {
  const page = make({ video: true });
  page.state.hold = true;
  page.probe.run();
  page.state.address = "https://site.test/b";
  page.probe.run();
  page.probe.run();
  page.held.shift()!();
  await page.settle();
  assert.deepEqual(page.reports, [true, true]);
  page.state.hold = false;
  page.held.shift()!();
  await page.settle();
  assert.deepEqual(page.reports, [true, true]);
});

test("a return to an address that had a video reports again after a no-video page in between", async () => {
  const page = make({ video: true });
  page.probe.run();
  await page.settle();
  page.state.address = "https://site.test/b";
  page.state.video = false;
  page.probe.run();
  await page.settle();
  page.state.address = "https://site.test/a";
  page.state.video = true;
  page.probe.run();
  await page.settle();
  assert.deepEqual(page.reports, [true, false, true]);
});

test("a no-video page reached while the first report is out reports false when that report settles, and a return to the first address reports again", async () => {
  const page = make({ video: true });
  page.state.hold = true;
  page.probe.run();
  page.state.address = "https://site.test/b";
  page.state.video = false;
  page.probe.run();
  page.held.shift()!();
  await page.settle();
  assert.deepEqual(page.reports, [true, false]);
  page.held.shift()!();
  await page.settle();
  page.state.hold = false;
  page.state.address = "https://site.test/a";
  page.state.video = true;
  page.probe.run();
  await page.settle();
  assert.deepEqual(page.reports, [true, false, true]);
});
