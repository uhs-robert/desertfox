import assert from "node:assert/strict";
import { test } from "node:test";
import { wait_for_new_content } from "../../src/content/next_page/load_outcome.ts";
import type { ContentWatch } from "../../src/content/next_page/load_outcome.ts";
import { effective_settings } from "../../src/shared/config.ts";
import { DEFAULT_NEXT_PATTERNS } from "../../src/shared/default_settings.ts";

function fake_watch(height = 1000) {
  const page = { height, add: () => {}, stopped: false };
  const watch: ContentWatch = {
    start_: (on_added) => {
      page.add = on_added;
      return () => (page.stopped = true);
    },
    page_height_: () => page.height,
  };
  return { page, watch };
}

test("an added element of the page counts as loaded at once and stops the watch", async () => {
  const { page, watch } = fake_watch();
  const loaded = wait_for_new_content(watch, 10_000);
  page.add();
  assert.equal(await loaded, true);
  assert.equal(page.stopped, true);
});

test("with nothing added, a taller page at the end of the wait still counts as loaded", async () => {
  const { page, watch } = fake_watch();
  const loaded = wait_for_new_content(watch, 5);
  page.height = 2000;
  assert.equal(await loaded, true);
});

test("with nothing added and the same height, nothing loaded", async () => {
  const { page, watch } = fake_watch();
  assert.equal(await wait_for_new_content(watch, 5), false);
  assert.equal(page.stopped, true);
});

test("a next_patterns list from before the load step loses 'more' and keeps the rest", () => {
  assert.deepEqual(effective_settings({ next_patterns: ["next", "More ", "weiter"] }).next_patterns, ["next", "weiter"]);
  assert.deepEqual(effective_settings({}).next_patterns, [...DEFAULT_NEXT_PATTERNS]);
  assert.ok(!DEFAULT_NEXT_PATTERNS.includes("more"));
});
