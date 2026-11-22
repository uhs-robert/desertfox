// The page's end of the rank port (`shared/rank_port.ts`): it asks the background for the ranked rows of a word and keeps the last few answers.
// One request is in flight at a time and the newest query waits behind it, so keys typed during a rank collapse into one rank. Pure: the page passes in the sending and the redraw.

import { RANKED_ROWS } from "../rank_port.ts";
import type { RankedReply, RankPush, RankRequest, RankSource } from "../rank_port.ts";

export type RankQuery = { source: RankSource; word: string; over_fetch: number };

// Not ready: the query is on its way or waits behind the one that is.
export type RankRead = { ready: true; reply: RankedReply } | { ready: false };

export type RankedClientDeps = {
  send: (request: RankRequest) => void;
  // An answer landed, or the old ones went stale: the list ranks again.
  on_ready: () => void;
};

// `follow_accepted` ranks the text before an accepted tab row again, so the answer for it must still be here.
const KEPT_ANSWERS = 4;

const EMPTY: RankedReply = { type: "ranked", seq: 0, rows: [], partial: false };

// The background answers every request, even one that fails. This catches an answer lost anyway, such as from a Worker that hangs: the query then lists nothing, and the keys that wait for its rows run.
const ANSWER_LIMIT_MS = 5000;

const key_of = (query: RankQuery) => `${query.source} ${query.over_fetch} ${query.word}`;

export function create_ranked_client(deps: RankedClientDeps) {
  let seq = 0;
  let in_flight: { seq: number; key: string } | undefined;
  let next: RankQuery | undefined;
  const answers = new Map<string, RankedReply>();
  // The query of the last answer that failed or never came. It reads as empty until the next request goes out, so the redraw does not ask a failing Worker again in a loop, and a later visit to the word asks again.
  let failed_key: string | undefined;
  // The port is gone or the line closed: every read is an empty answer.
  let ended = false;

  const send = (query: RankQuery) => {
    in_flight = { seq: ++seq, key: key_of(query) };
    failed_key = undefined;
    deps.send({ type: "rank", seq, source: query.source, word: query.word, limit: RANKED_ROWS, over_fetch: query.over_fetch });
    // Lands only while this request is the one in flight, by its sequence number.
    setTimeout(receive, ANSWER_LIMIT_MS, { ...EMPTY, seq, failed: true });
  };

  const receive = (message: RankPush) => {
    if (ended) return;
    if (message.type === "stale") {
      // The answers came from the newest 1000 pages while the history loaded. One in flight was ranked after the push, so it lands.
      answers.clear();
      failed_key = undefined;
      return deps.on_ready();
    }
    if (message.seq !== in_flight?.seq) return;
    const { key } = in_flight;
    in_flight = undefined;
    if (!message.skipped && !message.failed) {
      answers.set(key, message);
      if (answers.size > KEPT_ANSWERS) answers.delete(answers.keys().next().value!);
    }
    const waiting = next;
    next = undefined;
    if (waiting && !answers.has(key_of(waiting))) send(waiting);
    if (message.failed) failed_key = key;
    deps.on_ready();
  };

  return {
    read: (query: RankQuery): RankRead => {
      const key = key_of(query);
      if (ended || key === failed_key) return { ready: true, reply: EMPTY };
      const known = answers.get(key);
      if (known) {
        answers.delete(key);
        answers.set(key, known);
        return { ready: true, reply: known };
      }
      if (!in_flight) send(query);
      else next = in_flight.key === key ? undefined : query;
      return { ready: false };
    },
    receive,
    // The line closed or the port went away: a late answer lands nowhere.
    end: () => {
      ended = true;
      in_flight = undefined;
      next = undefined;
      answers.clear();
    },
  };
}

export type RankedClient = ReturnType<typeof create_ranked_client>;
