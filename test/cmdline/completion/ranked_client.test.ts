import assert from "node:assert/strict";
import { test } from "node:test";
import { create_ranked_client } from "../../../src/cmdline/completion/ranked_client.ts";
import type { RankedReply, RankRequest } from "../../../src/shared/rank_port.ts";

function make() {
  const sent: RankRequest[] = [];
  let ready = 0;
  const client = create_ranked_client({ send: (request) => void sent.push(request), on_ready: () => void ready++ });
  const reply = (request: RankRequest, name = request.word, extra: Partial<RankedReply> = {}): RankedReply => ({ type: "ranked", seq: request.seq, rows: [{ name, url: `https://${name}.test/`, score: 1, positions: [] }], partial: false, ...extra });
  const read = (word: string, source: "open" | "history" | "anything" = "open", over_fetch = 0) => client.read({ source, word, over_fetch });
  return { client, sent, reply, read, ready: () => ready };
}

const names_of = (read: ReturnType<ReturnType<typeof make>["read"]>) => (read.ready ? read.reply.rows.map((row) => row.name) : "pending");

test("five words typed during a rank send only the first and the last", () => {
  const { client, sent, reply, read } = make();
  for (const word of ["g", "gi", "git", "gith", "githu"]) assert.equal(read(word).ready, false);
  assert.deepEqual(sent.map((request) => request.word), ["g"]);
  client.receive(reply(sent[0]!));
  assert.deepEqual(sent.map((request) => request.word), ["g", "githu"]);
  assert.deepEqual(sent.map((request) => request.seq), [1, 2]);
  client.receive(reply(sent[1]!));
  assert.deepEqual(names_of(read("githu")), ["githu"]);
  assert.equal(sent.length, 2);
});

test("a reply with an old or unknown sequence number lands nowhere", () => {
  const { client, sent, reply, read, ready } = make();
  read("a");
  client.receive(reply(sent[0]!));
  read("ab");
  // A late duplicate of the first answer, and a reply the line never asked for.
  client.receive(reply(sent[0]!, "stale"));
  client.receive({ type: "ranked", seq: 99, rows: [], partial: false });
  assert.equal(read("ab").ready, false);
  assert.equal(ready(), 1);
  client.receive(reply(sent[1]!));
  assert.deepEqual(names_of(read("ab")), ["ab"]);
});

test("a reply that arrives after the line closed lands nowhere, and reads then list nothing and send nothing", () => {
  const { client, sent, reply, read, ready } = make();
  read("a");
  client.end();
  client.receive(reply(sent[0]!));
  assert.equal(ready(), 0);
  assert.deepEqual(read("a"), { ready: true, reply: { type: "ranked", seq: 0, rows: [], partial: false } });
  assert.equal(sent.length, 1);
});

test("a kept answer is read again without a request, and only the last four are kept", () => {
  const { client, sent, reply, read } = make();
  for (const word of ["a", "b", "c", "d", "e"]) {
    read(word);
    client.receive(reply(sent.at(-1)!));
  }
  assert.equal(sent.length, 5);
  assert.deepEqual(names_of(read("b")), ["b"]);
  assert.equal(sent.length, 5);
  // `a` was the oldest, so it went.
  assert.equal(read("a").ready, false);
  assert.equal(sent.length, 6);
});

test("the list, the word and the finder's over-fetch each name a different answer", () => {
  const { client, sent, reply, read } = make();
  read("a", "open");
  client.receive(reply(sent[0]!));
  assert.equal(read("a", "history").ready, false);
  client.receive(reply(sent[1]!));
  assert.equal(read("a", "anything", 2).ready, false);
  assert.deepEqual(sent.map((request) => [request.source, request.over_fetch, request.limit]), [["open", 0, 100], ["history", 0, 100], ["anything", 2, 100]]);
});

test("going back to the word in flight drops the one waiting behind it", () => {
  const { client, sent, reply, read } = make();
  read("a");
  read("ab");
  read("a");
  client.receive(reply(sent[0]!));
  assert.equal(sent.length, 1);
});

test("stale drops the kept answers and asks the list to rank again, and the answer in flight still lands", () => {
  const { client, sent, reply, read, ready } = make();
  read("a");
  client.receive(reply(sent[0]!, "partial", { partial: true }));
  read("ab");
  client.receive({ type: "stale" });
  assert.equal(ready(), 2);
  client.receive(reply(sent[1]!));
  assert.deepEqual(names_of(read("ab")), ["ab"]);
  assert.equal(read("a").ready, false);
  assert.equal(sent.at(-1)!.word, "a");
});

test("a skipped reply keeps nothing and sends the word waiting behind it", () => {
  const { client, sent, read, ready } = make();
  read("a");
  read("ab");
  client.receive({ type: "ranked", seq: sent[0]!.seq, rows: [], partial: false, skipped: true });
  assert.equal(ready(), 1);
  assert.deepEqual(sent.map((request) => request.word), ["a", "ab"]);
  assert.equal(read("a").ready, false);
});

test("an answer that never comes counts as an empty one after 5 s, so the list stops loading and the next word goes out", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { client, sent, reply, read, ready } = make();
  read("a");
  read("ab");
  t.mock.timers.tick(4999);
  assert.equal(ready(), 0);
  t.mock.timers.tick(1);
  assert.equal(ready(), 1);
  assert.deepEqual(names_of(read("a")), []);
  assert.deepEqual(sent.map((request) => request.word), ["a", "ab"]);
  // An answer that lands in time stops its own clock.
  client.receive(reply(sent[1]!));
  t.mock.timers.tick(5000);
  assert.equal(ready(), 2);
  assert.deepEqual(names_of(read("ab")), ["ab"]);
});
