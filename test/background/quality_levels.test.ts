import assert from "node:assert/strict";
import { mock, test } from "node:test";
import "../../src/background/command_modules.ts";
import { ask_quality, choose_player, create_quality_reports, quality_rows, type QualityDeps } from "../../src/background/quality_levels.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { check_args } from "../../src/shared/registry/index.ts";
import type { QualityAnswer, QualityReport, QualityRequest } from "../../src/shared/quality.ts";

test("the fixed words complete with no player, and the levels follow best first named by height", () => {
  const words = ["max", "min", "auto", "up", "down"];
  assert.deepEqual(quality_rows(undefined).map((row) => row.name), words);
  assert.deepEqual(quality_rows({ levels: [] }).map((row) => row.name), words);
  const rows = quality_rows({ levels: [{ label: "720p", height: 720, active: false }, { label: "1080p60", height: 1080, active: true }] });
  assert.deepEqual(rows.slice(5), [{ name: "1080p", description: "1080p60, playing now" }, { name: "720p", description: "" }]);
});

test("every completion value passes the quality schema, whatever label the site gives", () => {
  const media = registry.get("media.act")!;
  const labels = ["1080p60", "2160p60 HDR", "1080p Premium", "720p"];
  const rows = quality_rows({ levels: labels.map((label, index) => ({ label, height: [1080, 2160, 1080, 720][index]!, active: false })) });
  for (const row of rows) assert.equal(check_args(media, { action: "quality", value: row.name, ...(["up", "down"].includes(row.name) ? { times: 1 } : {}) }).ok, true, row.name);
});

const report = (player: boolean, ready: boolean): QualityReport => ({ type: "quality_report", player, ready, has_video: player });

test("one player is chosen: a ready one first, then the top frame, then the lowest frame id", () => {
  assert.equal(choose_player([]), undefined);
  assert.equal(choose_player([{ frame_id: 0, report: report(false, false) }, { frame_id: 3, report: report(false, false) }]), undefined);
  assert.equal(choose_player([{ frame_id: 4, report: report(true, true) }, { frame_id: 2, report: report(true, true) }]), 2);
  assert.equal(choose_player([{ frame_id: 0, report: report(true, false) }, { frame_id: 5, report: report(true, true) }]), 5);
  assert.equal(choose_player([{ frame_id: 6, report: report(true, false) }, { frame_id: 0, report: report(true, false) }]), 0);
});

const list: QualityRequest = { type: "quality_apply", op: "list", value: undefined, times: 1 };
const skip: QualityRequest = { type: "quality_apply", op: "skip", value: "next", times: 1 };

// `frames` are the reports each frame pushes after the injection. `inject` can reject or stall.
function fake(frames: Record<number, QualityReport>, { inject = async (count: number) => count, answer = (): QualityAnswer => ({ levels: [] }), timeout_ms = 5000 } = {}) {
  const reports = create_quality_reports();
  const sent: { frame_id: number; request: QualityRequest }[] = [];
  const deps: QualityDeps = {
    reports,
    inject_all: async (tab_id) => {
      for (const [frame_id, frame_report] of Object.entries(frames)) setTimeout(() => reports.receive(tab_id, Number(frame_id), frame_report), 0);
      return inject(Object.keys(frames).length);
    },
    send: async (_tab_id, frame_id, request) => (sent.push({ frame_id, request }), answer()),
    timeout_ms,
    partial_wait_ms: 10,
  };
  return { deps, sent };
}

test("a skip or a set reaches the one frame with the ready player, not the unplayed embed beside it", async () => {
  const tab = fake({ 0: report(true, false), 7: report(true, true) }, { answer: () => ({ levels: [], skipped: true }) });
  assert.deepEqual(await ask_quality(tab.deps, 1, skip), { levels: [], skipped: true });
  assert.deepEqual(tab.sent.map(({ frame_id }) => frame_id), [7]);
});

test("a page where no frame has a player sends nothing and answers nothing", async () => {
  const tab = fake({ 0: report(false, false), 2: report(false, false) });
  assert.equal(await ask_quality(tab.deps, 1, skip), undefined);
  assert.deepEqual(tab.sent, []);
});

test("a frame that refuses the script does not stop the frames that ran it", async () => {
  const tab = fake({ 3: report(true, true) }, { inject: () => Promise.reject(new Error("Missing host permission")), answer: () => ({ levels: [{ label: "720p", height: 720, active: true }] }) });
  assert.deepEqual((await ask_quality(tab.deps, 1, list))?.levels.length, 1);
  assert.deepEqual(tab.sent.map(({ frame_id }) => frame_id), [3]);
});

test("a request that timed out sends nothing when the injection finishes late", async () => {
  const tab = fake({ 0: report(true, true) }, { inject: (count) => new Promise((resolve) => setTimeout(() => resolve(count), 120)), timeout_ms: 30 });
  assert.equal(await ask_quality(tab.deps, 1, skip), undefined);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(tab.sent, []);
});

test("a frame that never answers cannot hold the list for ever", async () => {
  const tab = fake({ 0: report(true, true) }, { timeout_ms: 40 });
  tab.deps.send = () => new Promise(() => {});
  assert.equal(await ask_quality(tab.deps, 1, list), undefined);
});

test("the whole request keeps one deadline, however the injection and the answer share it", async (context) => {
  // Fake clock: a correct 100 ms deadline settles by tick 100, a deadline restarted after the 50 ms injection only at 150.
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const tab = fake({ 0: report(true, true) }, { inject: (count) => new Promise((resolve) => setTimeout(() => resolve(count), 50)), timeout_ms: 100 });
  tab.deps.send = () => new Promise(() => {});
  let settled = false;
  const asked = ask_quality(tab.deps, 1, list).then((answer) => ((settled = true), answer));
  for (let elapsed = 0; elapsed < 100; elapsed += 10) {
    context.mock.timers.tick(10);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(settled, "still waiting at 100 ms");
  assert.equal(await asked, undefined);
});
