import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { create_find_scan, FIND_SCAN_LIMIT_MS, type FindScanDeps, type ScanWorker } from "../../src/background/find_scan.ts";
import type { ScanRequest } from "../../src/background/regex_scan.ts";

function fake_workers() {
  const started: Array<ScanWorker & { posted: ScanRequest[]; terminated: number }> = [];
  const timers = new Map<number, () => void>();
  let next_timer = 1;
  let start_fails = false;
  const deps: FindScanDeps = {
    start_worker: () => {
      if (start_fails) throw new Error("no worker");
      const worker = { posted: [] as ScanRequest[], terminated: 0, onmessage: null, onerror: null, postMessage: (request: ScanRequest) => void worker.posted.push(request), terminate: () => void worker.terminated++ };
      started.push(worker);
      return worker;
    },
    set_timer: (callback) => (timers.set(next_timer, callback), next_timer++),
    clear_timer: (handle) => void timers.delete(handle as number),
    limit_ms: FIND_SCAN_LIMIT_MS,
  };
  const fire_timers = () => [...timers.values()].forEach((fire) => fire());
  return { deps, started, timers, fire_timers, fail_start: () => (start_fails = true) };
}

const request: ScanRequest = { text: "abc", source: "b", flags: "giu" };

test("an answer from the worker ends its timer, stops the worker and passes the arrays on", async () => {
  const fake = fake_workers();
  const scan = create_find_scan(fake.deps);
  const answer = scan.answer(request, "1:0");
  assert.deepEqual(fake.started[0]!.posted, [request]);
  fake.started[0]!.onmessage!({ data: { from: Int32Array.of(1), to: Int32Array.of(2) } });
  assert.deepEqual(await answer, { ok: true, from: Int32Array.of(1), to: Int32Array.of(2) });
  assert.equal(fake.started[0]!.terminated, 1);
  assert.equal(fake.timers.size, 0);
});

test("the time limit stops the worker once and answers timeout, and a late answer changes nothing", async () => {
  const fake = fake_workers();
  const scan = create_find_scan(fake.deps);
  const answer = scan.answer(request, "1:0");
  fake.fire_timers();
  assert.deepEqual(await answer, { ok: false, reason: "timeout" });
  fake.started[0]!.onmessage!({ data: { from: Int32Array.of(1), to: Int32Array.of(2) } });
  assert.equal(fake.started[0]!.terminated, 1);
  // The next scan gets a fresh worker.
  const next = scan.answer(request, "1:0");
  fake.started[1]!.onmessage!({ data: { from: Int32Array.of(1), to: Int32Array.of(2) } });
  assert.equal((await next).ok, true);
});

test("a newer scan from the same frame stops the older worker at once, and other frames keep theirs", async () => {
  const fake = fake_workers();
  const scan = create_find_scan(fake.deps);
  const old = scan.answer(request, "1:0");
  const other_frame = scan.answer(request, "1:3");
  const newer = scan.answer(request, "1:0");
  assert.deepEqual(await old, { ok: false, reason: "superseded" });
  assert.equal(fake.started[0]!.terminated, 1);
  assert.equal(fake.started[1]!.terminated, 0);
  fake.started[2]!.onmessage!({ data: { from: Int32Array.of(), to: Int32Array.of() } });
  assert.equal((await newer).ok, true);
  fake.fire_timers();
  assert.deepEqual(await other_frame, { ok: false, reason: "timeout" });
});

test("a worker that throws, or one that cannot start, answers failed with the message", async () => {
  const fake = fake_workers();
  const scan = create_find_scan(fake.deps);
  const thrown = scan.answer(request, "1:0");
  fake.started[0]!.onerror!({ message: "SyntaxError: bad pattern" });
  assert.deepEqual(await thrown, { ok: false, reason: "failed", message: "SyntaxError: bad pattern" });
  assert.equal(fake.started[0]!.terminated, 1);
  fake.fail_start();
  assert.deepEqual(await scan.answer(request, "1:0"), { ok: false, reason: "failed", message: "no worker" });
  assert.equal(fake.timers.size, 0);
});

test("a scan whose tab closed still ends at the limit, so no worker outlives it", async () => {
  // The page that asked is gone, so nobody reads the answer. The timer still stops the worker.
  const fake = fake_workers();
  const scan = create_find_scan(fake.deps);
  void scan.answer(request, "7:0");
  fake.fire_timers();
  await new Promise((resume) => setImmediate(resume));
  assert.equal(fake.started[0]!.terminated, 1);
});

// The real worker file in a Node worker thread. Node has no `self`, so the thread gets a stand-in that forwards to its port.
const WORKER_ENTRY = new URL("../../src/background/find_worker.ts", import.meta.url).href;
const ADAPTER = `
  const { parentPort } = require("node:worker_threads");
  globalThis.self = {
    postMessage: (data, options) => parentPort.postMessage(data, options?.transfer),
    set onmessage(handler) { parentPort.on("message", (data) => handler({ data })); },
  };
  import(${JSON.stringify(WORKER_ENTRY)});
`;

function node_worker(): ScanWorker {
  const thread = new Worker(ADAPTER, { eval: true });
  const worker: ScanWorker = {
    postMessage: (scan_request) => thread.postMessage(scan_request),
    terminate: () => void thread.terminate(),
    onmessage: null,
    onerror: null,
  };
  thread.on("message", (data) => worker.onmessage?.({ data }));
  thread.on("error", (error) => worker.onerror?.({ message: String(error) }));
  return worker;
}

const real_deps: FindScanDeps = {
  start_worker: node_worker,
  set_timer: (callback, delay_ms) => setTimeout(callback, delay_ms),
  clear_timer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  limit_ms: FIND_SCAN_LIMIT_MS,
};

test("the real worker: a runaway regex is stopped near the limit, and the next search answers", async () => {
  const deps = { ...real_deps };
  const scan = create_find_scan(deps);
  const started = performance.now();
  // No "b" in the text, so `a.*b.*c` tries every split of the run of "a" from every start.
  const slow = await scan.answer({ text: "a".repeat(60_000), source: "a.*b.*c", flags: "giu" }, "1:0");
  const slow_ms = performance.now() - started;
  assert.deepEqual(slow, { ok: false, reason: "timeout" });
  // Loose, so a busy machine does not fail it. Without the limit the scan runs for seconds.
  assert.ok(slow_ms < 1500, `the timeout took ${slow_ms} ms`);
  // The limit counts the start of a Node worker thread, which a busy machine can push past 300 ms, so the fast scan gets room.
  deps.limit_ms = 5000;
  const fast = await scan.answer({ text: "xaxa😀a", source: "a", flags: "giu" }, "1:0");
  assert.deepEqual(fast, { ok: true, from: Int32Array.of(1, 3, 6), to: Int32Array.of(2, 4, 7) });
});

test("the real worker: a pattern that throws in the worker answers failed", async () => {
  const scan = create_find_scan(real_deps);
  const answer = await scan.answer({ text: "abc", source: "(", flags: "giu" }, "1:0");
  assert.equal(answer.ok === false && answer.reason, "failed");
});
