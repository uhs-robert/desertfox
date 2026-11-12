import assert from "node:assert/strict";
import { test } from "node:test";
import { create_media_quality, trigger_of } from "../../src/background/media_quality.ts";
import type { QualityRuleStart } from "../../src/shared/quality.ts";

const web = "https://video.test/watch";

function make({ disabled = false, inject = async (_tab_id: number): Promise<unknown> => [1], wait = async (_ms: number): Promise<void> => undefined } = {}) {
  const sent: [number, QualityRuleStart][] = [];
  const injected: number[] = [];
  const about_blank: number[] = [];
  const quality = create_media_quality({
    is_disabled: async () => disabled,
    inject_all: (tab_id) => (injected.push(tab_id), inject(tab_id)),
    start: async (tab_id, message) => void sent.push([tab_id, message]),
    inject_about_blank: async (tab_id) => void about_blank.push(tab_id),
    wait,
    settle_ms: 1000,
  });
  return { quality, sent, injected, about_blank };
}

test("a changed address is a navigation, a finished load is a load, and other updates start nothing", () => {
  assert.equal(trigger_of({ url: web }), "navigated");
  assert.equal(trigger_of({ url: web, status: "complete" }), "navigated");
  assert.equal(trigger_of({ status: "complete" }), "loaded");
  assert.equal(trigger_of({ status: "loading" }), undefined);
  assert.equal(trigger_of({}), undefined);
});

test("a navigation injects the bundle and starts the rule, with the navigated flag", async () => {
  const { quality, sent, injected } = make();
  await quality.tab_updated(3, { url: web }, web);
  assert.deepEqual(injected, [3]);
  assert.deepEqual(sent, [[3, { type: "quality_rule", navigated: true }]]);
  await quality.tab_updated(3, { status: "complete" }, web);
  assert.deepEqual(sent[1], [3, { type: "quality_rule", navigated: false }]);
});

test("pages that are not http or https, and a switched-off extension, start nothing", async () => {
  const { quality, sent, injected } = make();
  await quality.tab_updated(1, { url: "about:blank" }, "about:blank");
  await quality.tab_updated(1, { url: "moz-extension://x/help.html" }, "moz-extension://x/help.html");
  await quality.tab_updated(1, { url: web }, undefined);
  const off = make({ disabled: true });
  await off.quality.tab_updated(1, { url: web }, web);
  assert.deepEqual([injected, sent, off.injected, off.sent], [[], [], [], []]);
});

test("a frame that refuses the script does not stop the others from getting the start", async () => {
  const { quality, sent } = make({ inject: async () => Promise.reject(new Error("frame refused")) });
  await quality.tab_updated(2, { url: web }, web);
  assert.equal(sent.length, 1);
});

test("a tab that closed while the bundle was injected sends nothing and throws nothing", async () => {
  const closing = create_media_quality({ is_disabled: async () => false, inject_all: async () => [1], inject_about_blank: async () => [1], wait: async () => undefined, settle_ms: 0, start: async () => Promise.reject(new Error("no such tab")) });
  await closing.tab_updated(2, { url: web }, web);
});

test("repeated navigations of one tab send one start, which carries the navigated flag of the earlier ones", async () => {
  const release: (() => void)[] = [];
  const { quality, sent } = make({ inject: () => new Promise<unknown>((resolve) => release.push(() => resolve([1]))) });
  const first = quality.tab_updated(5, { url: web }, web);
  // The page's load finishes while the first injection is still running.
  const second = quality.tab_updated(5, { status: "complete" }, web);
  await new Promise((resolve) => setTimeout(resolve, 0));
  release[1]?.();
  release[0]?.();
  await Promise.all([first, second]);
  assert.deepEqual(sent, [[5, { type: "quality_rule", navigated: true }]]);
});

test("two tabs do not supersede each other", async () => {
  const { quality, sent } = make();
  await Promise.all([quality.tab_updated(1, { url: web }, web), quality.tab_updated(2, { url: web }, web)]);
  assert.deepEqual(sent.map(([tab_id]) => tab_id).sort(), [1, 2]);
});

test("a navigation to a non-web page supersedes the pending turn, so nothing reaches the new document", async () => {
  const release: (() => void)[] = [];
  const { quality, sent, injected } = make({ inject: () => new Promise<unknown>((resolve) => release.push(() => resolve([1]))) });
  const pending = quality.tab_updated(7, { url: web }, web);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await quality.tab_updated(7, { url: "file:///tmp/page.html" }, "file:///tmp/page.html");
  release[0]?.();
  await pending;
  assert.deepEqual(sent, []);
  // A non-web navigation that lands before the injection starts blocks it too.
  const early = make();
  const first = early.quality.tab_updated(8, { url: web }, web);
  await early.quality.tab_updated(8, { url: "about:blank" }, "about:blank");
  await first;
  assert.deepEqual([early.injected, early.sent], [[], []]);
  assert.deepEqual(injected, [7]);
});

test("the about:blank pass runs after the wait and starts the rule without the navigated flag", async () => {
  const { quality, sent, about_blank } = make();
  await quality.tab_updated(3, { url: web }, web);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(about_blank, [3]);
  assert.deepEqual(sent, [[3, { type: "quality_rule", navigated: true }], [3, { type: "quality_rule", navigated: false }]]);
});

test("a pass that waited through a newer trigger or a non-web page is dropped", async () => {
  const release: (() => void)[] = [];
  const { quality, sent, about_blank } = make({ wait: () => new Promise<void>((resolve) => release.push(resolve)) });
  await quality.tab_updated(4, { url: web }, web);
  await quality.tab_updated(4, { status: "complete" }, web);
  release[0]?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(about_blank, [], "the older trigger's pass ran");
  release[1]?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(about_blank, [4]);
  assert.equal(sent.length, 3);
  await quality.tab_updated(5, { url: web }, web);
  await quality.tab_updated(5, { url: "about:blank" }, "about:blank");
  release[2]?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(about_blank, [4]);
});
