// A ranked client whose background answers from fixed items through the real ranking (`background/completion_rank.ts`), for page tests that need no port.
// An answer lands in a microtask, before a test's `setTimeout(0)` wait ends.
import { ranking_of } from "../../src/background/completion_rank.ts";
import type { SourceItems } from "../../src/background/completion_rank.ts";
import { create_ranked_client } from "../../src/cmdline/completion/ranked_client.ts";
import { RANKED_ROWS } from "../../src/shared/rank_port.ts";
import type { RankedReply, RankRequest, RankSource } from "../../src/shared/rank_port.ts";

type ItemsOf = { [Source in SourceItems["source"]]?: Extract<SourceItems, { source: Source }>["items"] };

export function reply_for(built: SourceItems, word: string, over_fetch = 0, seq = 1): RankedReply {
  const { rows, finder } = ranking_of(built)(word, RANKED_ROWS, over_fetch);
  return { type: "ranked", seq, rows, partial: false, ...(finder ? { finder } : {}) };
}

// `items` is read when each answer goes out, so a test can change it between keys. `manual` keeps the answers until `answer_all`.
export function ranked_items(items: ItemsOf | (() => ItemsOf), { on_ready = () => {}, manual = false } = {}) {
  const requests: RankRequest[] = [];
  const held: (() => void)[] = [];
  const client = create_ranked_client({
    send: (request) => {
      requests.push(request);
      const answer = () => {
        const current = typeof items === "function" ? items() : items;
        const source: RankSource = request.source;
        const found = current[source];
        const reply = found ? reply_for({ source, items: found } as SourceItems, request.word, request.over_fetch, request.seq) : { type: "ranked" as const, seq: request.seq, rows: [], partial: false };
        client.receive(reply);
      };
      if (manual) held.push(answer);
      else queueMicrotask(answer);
    },
    on_ready: () => on_ready(),
  });
  return Object.assign(client, { requests, answer_all: () => held.splice(0).forEach((answer) => answer()) });
}
