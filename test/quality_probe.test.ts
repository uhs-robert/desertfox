import assert from "node:assert/strict";
import { test } from "node:test";
import { create_probe, PROBE_LOOK_MS, PROBE_SPAN_MS } from "../src/content/quality/probe.ts";

// A document the test controls. `sleep` parks the look-again loop until `tick`, which moves the clock on by one look.
function make({ video = false } = {}) {
  const state = { video, address: "https://site.test/a", now: 0 };
  const reports: boolean[] = [];
  const watchers: (() => void)[] = [];
  const sleepers: (() => void)[] = [];
  let searches = 0;
  const probe = create_probe({
    has_video: () => (searches++, state.video),
    address: () => state.address,
    report: (found) => void reports.push(found),
    watch: (on_media) => void watchers.push(on_media),
    sleep: () => new Promise<void>((resolve) => sleepers.push(resolve)),
    now: () => state.now,
  });
  const tick = async () => {
    state.now += PROBE_LOOK_MS;
    for (const wake of sleepers.splice(0)) wake();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { probe, state, reports, watchers, sleepers, tick, searches: () => searches };
}

test("a document with a video reports once however often the injection runs, and arms one watch", () => {
  const page = make({ video: true });
  for (let run = 0; run < 3; run++) page.probe.run();
  assert.deepEqual(page.reports, [true]);
  assert.equal(page.watchers.length, 1);
  assert.equal(page.sleepers.length, 0);
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

test("a media event reports a late player without a search, and a second event adds nothing", async () => {
  const page = make();
  page.probe.run();
  const searches = page.searches();
  page.watchers[0]!();
  page.watchers[0]!();
  assert.deepEqual(page.reports, [true]);
  assert.equal(page.searches(), searches);
  await page.tick();
  assert.deepEqual(page.reports, [true]);
  assert.equal(page.sleepers.length, 0);
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

test("a navigation inside the document after a report reports again, whether or not the new page has a video", () => {
  const page = make({ video: true });
  page.probe.run();
  page.probe.run();
  page.state.address = "https://site.test/b";
  page.state.video = false;
  page.probe.run();
  page.probe.run();
  assert.deepEqual(page.reports, [true, false]);
  assert.equal(page.watchers.length, 1);
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
