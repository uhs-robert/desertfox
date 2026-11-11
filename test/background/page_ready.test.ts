import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_READY_TIMEOUT_MS, watch_page_ready } from "../../src/background/page_ready.ts";
import type { PageReadyDeps } from "../../src/background/page_ready.ts";

type Change = { status?: string; url?: string };

function make(options: { tab?: { status?: string } | undefined; script?: boolean } = {}) {
  const updated = new Set<(id: number, change: Change) => void>();
  const removed = new Set<(id: number) => void>();
  const timers = new Map<number, () => void>();
  let next_timer = 0;
  const state = { tab: "tab" in options ? options.tab : { status: "complete" }, script: options.script ?? true, timer_ms: [] as number[] };
  const deps: PageReadyDeps = {
    get_tab: async () => state.tab,
    on_updated: { addListener: (listener) => void updated.add(listener), removeListener: (listener) => void updated.delete(listener) },
    on_removed: { addListener: (listener) => void removed.add(listener), removeListener: (listener) => void removed.delete(listener) },
    has_content_script: async () => state.script,
    set_timer: (callback, ms) => (state.timer_ms.push(ms), timers.set(++next_timer, callback), next_timer),
    clear_timer: (timer) => void timers.delete(timer as number),
  };
  return {
    deps,
    state,
    update: (change: Change, id = 7) => [...updated].forEach((listener) => listener(id, change)),
    remove: (id = 7) => [...removed].forEach((listener) => listener(id)),
    fire_timer: () => [...timers.values()].forEach((callback) => callback()),
    open: () => updated.size + removed.size + timers.size,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a tab that already loaded is ready when its script answers", async () => {
  const fakes = make();
  const watch = watch_page_ready(fakes.deps, 7);
  assert.equal(await watch.done(), "ready");
  assert.equal(fakes.open(), 0);
  assert.deepEqual(fakes.state.timer_ms, [PAGE_READY_TIMEOUT_MS]);
});

test("after a navigation the wait needs loading and then complete, and ignores the old complete", async () => {
  const fakes = make();
  const watch = watch_page_ready(fakes.deps, 7);
  let result: string | undefined;
  void watch.done(500, { requires_navigation: true }).then((value) => (result = value));
  await settle();
  assert.equal(result, undefined);
  assert.equal(watch.navigated(), false);
  fakes.update({ status: "complete" });
  await settle();
  assert.equal(result, undefined);
  fakes.update({ status: "loading", url: "https://a.test/" });
  assert.equal(watch.navigated(), true);
  await settle();
  assert.equal(result, undefined);
  fakes.update({ status: "complete" });
  await settle();
  assert.equal(result, "ready");
  assert.equal(fakes.open(), 0);
});

test("a tab that is still loading becomes ready when it completes, and an event of another tab is ignored", async () => {
  const fakes = make({ tab: { status: "loading" } });
  const watch = watch_page_ready(fakes.deps, 7);
  let result: string | undefined;
  void watch.done().then((value) => (result = value));
  await settle();
  fakes.update({ status: "complete" }, 8);
  await settle();
  assert.equal(result, undefined);
  fakes.update({ status: "complete" });
  await settle();
  assert.equal(result, "ready");
});

test("a page that never completes times out", async () => {
  const fakes = make({ tab: { status: "loading" } });
  const watch = watch_page_ready(fakes.deps, 7);
  const result = watch.done(25);
  await settle();
  fakes.fire_timer();
  assert.equal(await result, "timeout");
  assert.deepEqual(fakes.state.timer_ms, [25]);
  assert.equal(fakes.open(), 0);
});

test("a tab closed while it loads is gone", async () => {
  const fakes = make({ tab: { status: "loading" } });
  const watch = watch_page_ready(fakes.deps, 7);
  const result = watch.done();
  await settle();
  fakes.remove();
  assert.equal(await result, "gone");
  assert.equal(fakes.open(), 0);
});

test("a tab removed before the wait starts, and a tab that does not exist, are gone", async () => {
  const early = make({ tab: { status: "loading" } });
  const watch = watch_page_ready(early.deps, 7);
  early.remove();
  assert.equal(await watch.done(), "gone");
  assert.equal(early.open(), 0);
  const missing = make({ tab: undefined });
  assert.equal(await watch_page_ready(missing.deps, 7).done(), "gone");
  assert.equal(missing.open(), 0);
});

test("a page with no content script is no_script as soon as it completes", async () => {
  const fakes = make({ script: false });
  assert.equal(await watch_page_ready(fakes.deps, 7).done(), "no_script");
  assert.equal(fakes.open(), 0);
});

test("stop unsubscribes and settles a pending wait as gone", async () => {
  const fakes = make({ tab: { status: "loading" } });
  const watch = watch_page_ready(fakes.deps, 7);
  const result = watch.done();
  await settle();
  watch.stop();
  assert.equal(await result, "gone");
  assert.equal(fakes.open(), 0);
  const idle = make();
  watch_page_ready(idle.deps, 7).stop();
  assert.equal(idle.open(), 0);
});
