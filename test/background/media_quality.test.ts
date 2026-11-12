import assert from "node:assert/strict";
import { test } from "node:test";
import { create_media_quality, is_trigger, rule_for_report } from "../../src/background/media_quality.ts";
import type { QualityReport } from "../../src/shared/quality.ts";

const web = "https://video.test/watch";

function make({ off = false as boolean | (() => boolean), inject = async (_tab_id: number): Promise<unknown> => [1], wait = async (_ms: number): Promise<void> => undefined } = {}) {
  const injected: number[] = [];
  const about_blank: number[] = [];
  const quality = create_media_quality({
    is_off: async () => (typeof off === "function" ? off() : off),
    inject_all: (tab_id) => (injected.push(tab_id), inject(tab_id)),
    inject_about_blank: async (tab_id) => void about_blank.push(tab_id),
    wait,
    settle_ms: 1000,
  });
  return { quality, injected, about_blank };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a changed address and a finished load inject the bundle, and no other update does", () => {
  assert.equal(is_trigger({ url: web }), true);
  assert.equal(is_trigger({ url: web, status: "complete" }), true);
  assert.equal(is_trigger({ status: "complete" }), true);
  assert.equal(is_trigger({ status: "loading" }), false);
  assert.equal(is_trigger({}), false);
});

test("a navigation and a finished load each inject the bundle once, and send no message to the frames", async () => {
  const { quality, injected } = make();
  await quality.tab_updated(3, { url: web }, web);
  assert.deepEqual(injected, [3]);
  await quality.tab_updated(3, { status: "complete" }, web);
  assert.deepEqual(injected, [3, 3]);
});

test("pages that are not http or https, and an extension that is off or has the rule off everywhere, inject nothing", async () => {
  const { quality, injected, about_blank } = make();
  await quality.tab_updated(1, { url: "about:blank" }, "about:blank");
  await quality.tab_updated(1, { url: "moz-extension://x/help.html" }, "moz-extension://x/help.html");
  await quality.tab_updated(1, { url: web }, undefined);
  const off = make({ off: true });
  await off.quality.tab_updated(1, { url: web }, web);
  await off.quality.tab_updated(1, { status: "complete" }, web);
  await flush();
  assert.deepEqual([injected, about_blank, off.injected, off.about_blank], [[], [], [], []]);
});

test("a frame that refuses the script does not stop the about:blank pass", async () => {
  const { quality, about_blank } = make({ inject: async () => Promise.reject(new Error("frame refused")) });
  await quality.tab_updated(2, { url: web }, web);
  await flush();
  assert.deepEqual(about_blank, [2]);
});

test("a tab that closed while the bundle was injected throws nothing", async () => {
  const closing = create_media_quality({ is_off: async () => false, inject_all: async () => Promise.reject(new Error("no such tab")), inject_about_blank: async () => Promise.reject(new Error("no such tab")), wait: async () => undefined, settle_ms: 0 });
  await closing.tab_updated(2, { url: web }, web);
  await flush();
});

test("repeated triggers of one tab leave one pass, and a superseded injection starts none", async () => {
  const release: (() => void)[] = [];
  const { quality, injected, about_blank } = make({ inject: () => new Promise<unknown>((resolve) => release.push(() => resolve([1]))) });
  const first = quality.tab_updated(5, { url: web }, web);
  // The page's load finishes while the first is still waiting on its off check.
  const second = quality.tab_updated(5, { status: "complete" }, web);
  await flush();
  release[0]?.();
  release[1]?.();
  await Promise.all([first, second]);
  await flush();
  assert.deepEqual(injected, [5]);
  assert.deepEqual(about_blank, [5]);
});

test("two tabs do not supersede each other", async () => {
  const { quality, injected } = make();
  await Promise.all([quality.tab_updated(1, { url: web }, web), quality.tab_updated(2, { url: web }, web)]);
  assert.deepEqual(injected.sort(), [1, 2]);
});

test("a navigation to a non-web page supersedes the pending turn, so no pass reaches the new document", async () => {
  const release: (() => void)[] = [];
  const { quality, injected, about_blank } = make({ inject: () => new Promise<unknown>((resolve) => release.push(() => resolve([1]))) });
  const pending = quality.tab_updated(7, { url: web }, web);
  await flush();
  await quality.tab_updated(7, { url: "file:///tmp/page.html" }, "file:///tmp/page.html");
  release[0]?.();
  await pending;
  await flush();
  assert.deepEqual(about_blank, []);
  // A non-web navigation that lands before the injection starts blocks it too.
  const early = make();
  const first = early.quality.tab_updated(8, { url: web }, web);
  await early.quality.tab_updated(8, { url: "about:blank" }, "about:blank");
  await first;
  assert.deepEqual([early.injected, early.about_blank], [[], []]);
  assert.deepEqual(injected, [7]);
});

test("the about:blank pass runs after the wait, and injects into a tab whose frames already reported", async () => {
  const { quality, injected, about_blank } = make();
  await quality.tab_updated(3, { url: web }, web);
  await flush();
  assert.deepEqual([injected, about_blank], [[3], [3]]);
});

test("a pass that waited through a newer trigger or a non-web page is dropped", async () => {
  const release: (() => void)[] = [];
  const { quality, about_blank } = make({ wait: () => new Promise<void>((resolve) => release.push(resolve)) });
  await quality.tab_updated(4, { url: web }, web);
  await quality.tab_updated(4, { status: "complete" }, web);
  release[0]?.();
  await flush();
  assert.deepEqual(about_blank, [], "the older trigger's pass ran");
  release[1]?.();
  await flush();
  assert.deepEqual(about_blank, [4]);
  await quality.tab_updated(5, { url: web }, web);
  await quality.tab_updated(5, { url: "about:blank" }, "about:blank");
  release[2]?.();
  await flush();
  assert.deepEqual(about_blank, [4]);
});

const report = (has_video: boolean): QualityReport => ({ type: "quality_report", player: false, ready: false, has_video });

test("the reply to a report carries the resolved rule for a frame with a video, and nothing for one without", async () => {
  let reads = 0;
  const reads_of = (disabled: boolean) => ({ is_disabled: async () => disabled, value_for_frame: async () => (reads++, "720") });
  assert.equal(await rule_for_report(report(true), reads_of(false)), "720");
  assert.equal(await rule_for_report(report(true), reads_of(true)), "off");
  assert.equal(reads, 1);
  assert.equal(await rule_for_report(report(false), reads_of(false)), undefined);
  assert.equal(reads, 1, "a frame with no video reads nothing");
});

test("a settings change that turns the rule from off to on injects the open web tabs, once", async () => {
  let off = true;
  const { quality, injected } = make({ off: () => off });
  const tabs = async () => [{ id: 1, url: web }, { id: 2, url: "about:blank" }, { id: 3, url: "https://other.test/" }, { id: undefined, url: web }];
  await quality.settings_changed(tabs);
  assert.deepEqual(injected, [], "the first read only records the state");
  await quality.settings_changed(tabs);
  assert.deepEqual(injected, [], "still off");
  off = false;
  await quality.settings_changed(tabs);
  assert.deepEqual(injected, [1, 3]);
  await quality.settings_changed(tabs);
  assert.deepEqual(injected, [1, 3], "on to on injects nothing");
  off = true;
  await quality.settings_changed(tabs);
  off = false;
  await quality.settings_changed(tabs);
  assert.deepEqual(injected, [1, 3, 1, 3], "extension off then on again");
});
