// The background's rank service and the rank Worker together, through the in-process pipeline of `test/support/rank_pipeline.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RankInputs } from "../../src/background/completion_rank.ts";
import type { RankedReply, RankPush } from "../../src/shared/rank_port.ts";
import { rank_pipeline } from "../support/rank_pipeline.ts";
import type { Visit } from "../support/rank_pipeline.ts";

const NOW = Date.now();
const visit = (name: string, age: number): Visit => ({ url: `https://${name}.test/`, title: name, lastVisitTime: NOW - age, visitCount: 1 });

function make(history: Visit[] = [visit("alpha", 1), visit("beta", 2), visit("gamma", 3)], extra: Partial<Parameters<typeof rank_pipeline>[0]> = {}) {
  const inputs_read: string[] = [];
  const pipeline = rank_pipeline({
    history: () => history,
    inputs: async (source, asker): Promise<RankInputs> => {
      inputs_read.push(source);
      return source === "history" ? { source, incognito: asker.incognito, max: 20 } : source === "open" ? { source, incognito: asker.incognito, sources: ["history"], history_max: 10, bookmarks: [] } : { source, incognito: asker.incognito, quickmarks: {}, bookmarks: [], closed: [], tabs: [], tab_used: {}, history_max: 10 };
    },
    ...extra,
  });
  return { pipeline, history, inputs_read };
}

// A line whose pushes the test reads, with a helper that asks one word and waits for its answer.
function open_line(pipeline: ReturnType<typeof rank_pipeline>, sender?: Parameters<ReturnType<typeof rank_pipeline>["line"]>[1]) {
  const pushes: RankPush[] = [];
  const line = pipeline.line(() => {}, sender);
  line.receive_hook((message) => void pushes.push(message));
  const names = async (word: string, source: "open" | "history" | "anything" = "history") => {
    for (let tries = 0; tries < 5; tries++) {
      const read = line.client.read({ source, word, over_fetch: 0 });
      if (read.ready) return read.reply.rows.map((row) => row.name);
      await pipeline.settle();
    }
    return "never landed";
  };
  return { line, pushes, names, replies: () => pushes.filter((push): push is RankedReply => push.type === "ranked") };
}

test("a line ranks the Worker's history and gets only the top rows", async () => {
  const history = Array.from({ length: 300 }, (_, index) => visit(`page${index}`, index));
  const { pipeline } = make(history);
  pipeline.service.start();
  await pipeline.settle();
  const { names, replies } = open_line(pipeline);
  assert.equal((await names("page")).length, 100);
  assert.deepEqual((await names("page7")).slice(0, 2), ["page7", "page70"]);
  assert.equal(replies().every((reply) => !reply.partial), true);
});

test("a port from a frame that is not the opener is closed, and its requests read nothing", async () => {
  const { pipeline, inputs_read } = make([visit("alpha", 1)], { is_opener: async (_tab, frame) => frame === 0 });
  pipeline.service.start();
  await pipeline.settle();
  const stranger = open_line(pipeline, { tab: { id: 1, windowId: 1, incognito: false }, frameId: 7, url: "moz-extension://x/cmdline.html" });
  assert.deepEqual(await stranger.names("alpha"), []);
  assert.equal(stranger.line.disconnected_by_background(), true);
  assert.deepEqual(stranger.replies(), []);
  assert.deepEqual(inputs_read, []);
  // The opener frame of the same tab still ranks.
  assert.deepEqual(await open_line(pipeline).names("alpha"), ["alpha"]);
});

test("a request with a bad shape is ignored", async () => {
  const { pipeline, inputs_read } = make();
  pipeline.service.start();
  const { line, replies } = open_line(pipeline);
  line.client.read({ source: "history", word: "a", over_fetch: 0 });
  await pipeline.settle();
  const before = replies().length;
  for (const bad of [{ type: "rank", seq: 9, source: "tabs", word: "a", limit: 100, over_fetch: 0 }, { type: "rank", seq: 9, source: "open", word: "a", limit: 101, over_fetch: 0 }, { type: "rank", seq: -1, source: "open", word: "a", limit: 1, over_fetch: 0 }, { type: "rank", seq: 9, source: "open", word: 3, limit: 1, over_fetch: 0 }])
    line.post(bad);
  await pipeline.settle();
  assert.equal(replies().length, before);
  assert.deepEqual(inputs_read, ["history"]);
});

test("the line closing with a reply in flight frees the line in the Worker, and the reply lands nowhere", async () => {
  const { pipeline } = make();
  pipeline.service.start();
  await pipeline.settle();
  const { line, replies } = open_line(pipeline);
  line.client.read({ source: "history", word: "a", over_fetch: 0 });
  line.close();
  await pipeline.settle();
  assert.deepEqual(replies(), []);
  const worker = pipeline.workers[0]!;
  assert.deepEqual(worker.received.filter((message) => message.type === "close").length, 1);
  // A request the page script sends after the close reaches nothing either.
  line.post({ type: "rank", seq: 5, source: "history", word: "a", limit: 100, over_fetch: 0 });
  await pipeline.settle();
  assert.equal(worker.received.filter((message) => message.type === "rank").length <= 1, true);
});

test("a line opened during the fill gets the fallback rows marked partial, then stale, then the whole history", async () => {
  const history = [...Array.from({ length: 1000 }, (_, index) => visit(`new${index}`, index)), visit("old", 5000)];
  const { pipeline } = make(history);
  pipeline.hold_searches();
  pipeline.service.start();
  const { names, pushes } = open_line(pipeline);
  // The fallback holds the newest 1000 only.
  assert.deepEqual(await names("old"), []);
  assert.equal((pushes[0] as RankedReply).partial, true);
  pipeline.release_searches();
  await pipeline.settle();
  assert.deepEqual(pushes.map((push) => push.type), ["ranked", "stale"]);
  assert.deepEqual(await names("old"), ["old"]);
  assert.equal((pushes.at(-1) as RankedReply).partial, false);
});

test("a rank waiting on the fallback when the fill ends answers from the whole history, after the stale push", async () => {
  const history = [...Array.from({ length: 1000 }, (_, index) => visit(`new${index}`, index)), visit("old", 5000)];
  const { pipeline } = make(history);
  pipeline.hold_searches();
  pipeline.service.start();
  const { line, pushes, names } = open_line(pipeline);
  line.client.read({ source: "history", word: "old", over_fetch: 0 });
  // The request reaches the Worker, which asks the background for the fallback, and the fill ends before that answer arrives.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  pipeline.release_searches();
  await pipeline.settle();
  const replies = pushes.filter((push): push is RankedReply => push.type === "ranked");
  assert.equal(replies.every((reply) => !reply.partial || pushes.indexOf(reply) < pushes.findIndex((push) => push.type === "stale")), true);
  assert.deepEqual(await names("old"), ["old"]);
});

test("history events during the fill and between ranks apply in the order they fired", async () => {
  const history = [visit("alpha", 10), visit("beta", 20)];
  const { pipeline } = make(history);
  pipeline.hold_searches();
  pipeline.service.start();
  await pipeline.settle();
  // During the fill: a new page, a title change and a removal, all held until the fill ends.
  history.unshift(visit("delta", 1));
  pipeline.service.visited(visit("delta", 1));
  pipeline.service.title_changed({ url: "https://alpha.test/", title: "alpha renamed" });
  pipeline.service.visit_removed({ allHistory: false, urls: ["https://beta.test/"] });
  history.splice(history.findIndex((row) => row.url === "https://beta.test/"), 1);
  pipeline.release_searches();
  await pipeline.settle();
  const first = open_line(pipeline);
  assert.deepEqual(await first.names(""), ["delta", "alpha renamed"]);
  // A visit then its removal, sent back to back while a rank of another line runs: the removal wins because it came last.
  const second = open_line(pipeline);
  second.line.client.read({ source: "history", word: "", over_fetch: 0 });
  history.unshift(visit("epsilon", 0));
  pipeline.service.visited(visit("epsilon", 0));
  pipeline.service.visit_removed({ allHistory: false, urls: ["https://epsilon.test/"] });
  history.shift();
  await pipeline.settle();
  assert.deepEqual(await open_line(pipeline).names(""), ["delta", "alpha renamed"]);
  // A line's snapshot does not change under it: the first line still ranks what it read.
  assert.deepEqual(await first.names("e"), ["delta", "alpha renamed"]);
});

test("a newer request while one runs waits, and a third replaces it with a skipped reply", async () => {
  const { pipeline } = make();
  pipeline.service.start();
  await pipeline.settle();
  const { line, pushes } = open_line(pipeline);
  for (const [seq, word] of [[1, "a"], [2, "al"], [3, "alp"]] as const) line.post({ type: "rank", seq, source: "history", word, limit: 100, over_fetch: 0 });
  await pipeline.settle();
  const replies = pushes.filter((push): push is RankedReply => push.type === "ranked");
  assert.deepEqual(replies.map((reply) => [reply.seq, reply.skipped === true]), [[2, true], [1, false], [3, false]]);
});

test("a Worker that crashes with a request in flight restarts, fills again and answers the request", async () => {
  const { pipeline } = make();
  pipeline.service.start();
  await pipeline.settle();
  const { line, names } = open_line(pipeline);
  assert.deepEqual(await names("alpha"), ["alpha"]);
  pipeline.hold_searches();
  line.client.read({ source: "history", word: "beta", over_fetch: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  // It ran long enough to count as started, so the new one starts at once.
  pipeline.pass_time(5000);
  pipeline.workers[0]!.crash();
  pipeline.release_searches();
  await pipeline.settle();
  assert.equal(pipeline.workers.length, 2);
  assert.deepEqual(pipeline.timer_delays, [0]);
  assert.equal(pipeline.workers[0]!.terminated, true);
  assert.deepEqual(await names("beta"), ["beta"]);
  // The new Worker got the line's inputs again before the request.
  assert.deepEqual(pipeline.workers[1]!.received.map((message) => message.type).filter((type) => type !== "answer").slice(0, 2), ["inputs", "rank"]);
  // The new Worker holds the history.
  assert.deepEqual((await pipeline.service.history_rows())?.map((row) => row.title), ["alpha", "beta", "gamma"]);
});

test("a Worker that fails to start is tried again after a wait that doubles, and the line's request goes to the first one that starts", async () => {
  let loads = 0;
  const { pipeline } = make(undefined, { worker_loads: () => ++loads > 3, timer_scale: 0.01 });
  pipeline.service.start();
  const { line, names } = open_line(pipeline);
  line.client.read({ source: "history", word: "gamma", over_fetch: 0 });
  // 250, 500 and 1000 ms, scaled down.
  await new Promise((resolve) => setTimeout(resolve, 40));
  await pipeline.settle();
  assert.equal(pipeline.workers.length, 4);
  assert.deepEqual(await names("gamma"), ["gamma"]);
  // No history copy while no Worker runs: the handlers fall back to the browser's search.
  assert.equal(pipeline.workers.slice(0, 3).every((worker) => worker.terminated), true);
});

test("the history rows read undefined while the fill runs, and a copy once it ended", async () => {
  const { pipeline } = make();
  pipeline.hold_searches();
  pipeline.service.start();
  await pipeline.settle();
  assert.equal(await pipeline.service.history_rows(), undefined);
  pipeline.release_searches();
  await pipeline.settle();
  assert.deepEqual((await pipeline.service.history_rows())?.map((row) => row.url), ["https://alpha.test/", "https://beta.test/", "https://gamma.test/"]);
});

test("a throw while a list is built still answers, empty and marked failed, so the line asks again for the next word", async () => {
  const { pipeline } = make(undefined, { inputs: async (_source, asker) => ({ source: "open", incognito: asker.incognito, sources: ["history"], history_max: 10, bookmarks: null as never }) });
  pipeline.service.start();
  await pipeline.settle();
  const { names, replies } = open_line(pipeline);
  assert.deepEqual(await names("alpha", "open"), []);
  assert.deepEqual(await names("beta", "open"), []);
  assert.deepEqual(replies().map((reply) => reply.failed), [true, true]);
});

test("a word longer than the service ranks gets an empty answer, so the line does not wait on it", async () => {
  const { pipeline } = make();
  pipeline.service.start();
  await pipeline.settle();
  const { names } = open_line(pipeline);
  assert.deepEqual(await names("a".repeat(1001)), []);
  assert.deepEqual(await names("alpha"), ["alpha"]);
});

test("a Worker that keeps crashing soon after it starts restarts after a wait that doubles", async () => {
  let starts = 0;
  const { pipeline } = make(undefined, { crashes_after_start: () => ++starts <= 4, timer_scale: 0.01 });
  pipeline.service.start();
  const { names } = open_line(pipeline);
  await new Promise((resolve) => setTimeout(resolve, 60));
  await pipeline.settle();
  assert.deepEqual(pipeline.timer_delays, [250, 500, 1000, 2000]);
  assert.deepEqual(await names("gamma"), ["gamma"]);
});

test("a restart while a line's inputs are read sends its request to the new Worker once", async () => {
  let release_inputs = () => {};
  const held_inputs = new Promise<void>((resolve) => (release_inputs = resolve));
  const { pipeline } = make(undefined, {
    inputs: async (source, asker) => {
      await held_inputs;
      return { source: "history", incognito: asker.incognito, max: 20 } as RankInputs;
    },
  });
  pipeline.service.start();
  await pipeline.settle();
  const { line, names } = open_line(pipeline);
  line.client.read({ source: "history", word: "beta", over_fetch: 0 });
  await pipeline.settle();
  pipeline.pass_time(5000);
  pipeline.workers[0]!.crash();
  await pipeline.settle();
  release_inputs();
  assert.deepEqual(await names("beta"), ["beta"]);
  assert.equal(pipeline.workers[1]!.received.filter((message) => message.type === "rank").length, 1);
});

test("a Worker restart tells each line that ranked to ask again, so a partial answer does not stay", async () => {
  const history = [...Array.from({ length: 1000 }, (_, index) => visit(`new${index}`, index)), visit("old", 5000)];
  const { pipeline } = make(history);
  pipeline.hold_searches();
  pipeline.service.start();
  const { names, pushes } = open_line(pipeline);
  assert.deepEqual(await names("old"), []);
  pipeline.pass_time(5000);
  pipeline.workers[0]!.crash();
  await pipeline.settle();
  pipeline.release_searches();
  await pipeline.settle();
  assert.equal(pushes.some((push) => push.type === "stale"), true);
  assert.deepEqual(await names("old"), ["old"]);
});

test("the history rows read undefined when the Worker does not answer within 2 s", async () => {
  const { pipeline } = make(undefined, { worker_ignores: (message) => message.type === "history_rows", timer_scale: 0.01 });
  pipeline.service.start();
  await pipeline.settle();
  const started = Date.now();
  assert.equal(await pipeline.service.history_rows(), undefined);
  assert.equal(Date.now() - started >= 15, true);
  assert.deepEqual(pipeline.timer_delays, [2000]);
});
