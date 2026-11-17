import assert from "node:assert/strict";
import { test } from "node:test";
import { create_load_step, LOAD_WAIT_MS, wait_for_new_content } from "../../src/content/next_page/load_outcome.ts";
import type { ContentWatch, LoadStepDeps } from "../../src/content/next_page/load_outcome.ts";
import { effective_settings } from "../../src/shared/config.ts";
import { DEFAULT_NEXT_PATTERNS } from "../../src/shared/default_settings.ts";

function fake_watch(height = 1000) {
  const page = { height, add: () => {}, stopped: false };
  const watch: ContentWatch = {
    start_: (on_added) => {
      page.add = () => on_added([]);
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

function fake_load_step_deps() {
  const { page, watch } = fake_watch();
  const seen = { acts: 0, toasts: 0 };
  const page_events = new EventTarget();
  const deps: LoadStepDeps = { watch_: watch, page_: page_events, act_: () => void seen.acts++, nothing_loaded_: () => void seen.toasts++ };
  return { page, page_events, seen, deps };
}

test("a ]] while a load is pending does not act again, and the next one after it does", async () => {
  const start_load = create_load_step();
  const { page, seen, deps } = fake_load_step_deps();
  assert.equal(start_load(deps), true);
  assert.equal(start_load(deps), false);
  assert.equal(seen.acts, 1);
  page.add();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(start_load(deps), true);
  assert.equal(seen.acts, 2);
});

test("a page hidden during the wait shows no Nothing loaded when its timer ends later, and frees the load step", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const start_load = create_load_step();
  const { page_events, seen, deps } = fake_load_step_deps();
  start_load(deps);
  page_events.dispatchEvent(new Event("pagehide"));
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(LOAD_WAIT_MS);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.toasts, 0);
  assert.equal(start_load(deps), true);
});

test("a wait that ends with nothing added says Nothing loaded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const start_load = create_load_step();
  const { seen, deps } = fake_load_step_deps();
  start_load(deps);
  t.mock.timers.tick(LOAD_WAIT_MS);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.toasts, 1);
});
