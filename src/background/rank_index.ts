// The rank Worker's state: the history rows (their only copy), the inputs and snapshots of each open line, and the ranking.
// Pure: `rank_worker.ts` wires it to the Worker's messages, and the tests drive it directly. It reads the browser only through questions to the background.

import { create_history_cache, HISTORY_CACHE_MAX } from "./history_cache.ts";
import type { HistoryRow, Visit } from "./history_cache.ts";
import { history_items, reads_history, snapshot_of, usage_by_url } from "./completion_rank.ts";
import type { HistoryNode, RankInputs, Snapshot } from "./completion_rank.ts";
import type { RankedReply, RankRequest, RankSource } from "../shared/rank_port.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { pick_entry } from "../shared/folder_pick.ts";
import type { HistoryItem } from "../shared/messages.ts";
import { warn_and_go } from "../shared/swallow.ts";

// The history events, in the order Firefox fired them.
export type HistoryEvent = { kind: "visited"; visit: Visit } | { kind: "title"; url: string; title: string } | { kind: "removed"; allHistory: boolean; urls: string[] };

// `search` fills the history, `listed` checks an address a visit names, `fallback` reads the newest 1000 pages while the fill runs.
export type Question = { kind: "search"; max: number } | { kind: "listed"; url: string } | { kind: "fallback" };

export type ToWorker =
  | { type: "history"; event: HistoryEvent }
  // The background's answer to a `Question`. `failed` rejects it.
  | { type: "answer"; id: number; value: unknown; failed?: true }
  // A line's inputs for one list. They come before its first `rank`, and again after a Worker restart.
  | { type: "inputs"; line: number; inputs: RankInputs }
  | { type: "rank"; line: number; request: RankRequest }
  | { type: "close"; line: number }
  | { type: "history_rows"; id: number }
  // The boost of each listed address that the history holds.
  | { type: "usage_for"; id: number; urls: string[] }
  // Enter on `history <text>`: the one row the typed text means, or why it means none.
  | { type: "pick_history"; id: number; text: string };

// A refusal crosses as its text, because an error object does not keep its class through the Worker's message.
export type PickedHistory = { row: HistoryItem } | { refusal: string };

export type FromWorker =
  | { type: "ask"; id: number; question: Question }
  | { type: "ranked"; line: number; reply: RankedReply }
  // A line's snapshot came from the fallback rows and the fill has ended: its page should ask again.
  | { type: "stale"; line: number }
  // Undefined while the fill has not ended.
  | { type: "history_rows"; id: number; rows: HistoryRow[] | undefined }
  // The answer to `usage_for` (`[string, number][]`) or `pick_history` (`PickedHistory`). Undefined while the fill has not ended, as for `history_rows`, and when a pick threw something other than a refusal. A `usage_for` that throws ends the Worker instead, and the service answers its caller undefined.
  | { type: "reply"; id: number; value: [string, number][] | PickedHistory | undefined };

type Entry = { partial: boolean; built: Promise<Snapshot> };
type Line = { inputs: Map<RankSource, RankInputs>; snapshots: Map<RankSource, Entry> };

export function create_rank_index(post: (message: FromWorker) => void, max = HISTORY_CACHE_MAX) {
  let next_question = 0;
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const ask = <Answer>(question: Question): Promise<Answer> =>
    new Promise<Answer>((resolve, reject) => {
      const id = ++next_question;
      waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
      post({ type: "ask", id, question });
    });

  const history = create_history_cache({ search: (count) => ask({ kind: "search", max: count }), listed: (url) => ask({ kind: "listed", url }), max });
  const lines = new Map<number, Line>();

  // Built once per line and list. The rows are copied out of the history at once, so later events never change a snapshot under a rank.
  const snapshot = (line: Line, source: RankSource): Entry | undefined => {
    const known = line.snapshots.get(source);
    if (known) return known;
    const inputs = line.inputs.get(source);
    if (!inputs) return undefined;
    const rows = reads_history(inputs) ? history.read() : [];
    const entry: Entry = rows
      ? { partial: false, built: Promise.resolve(snapshot_of(inputs, rows, false)) }
      : { partial: true, built: ask<HistoryNode[]>({ kind: "fallback" }).then((fallback) => snapshot_of(inputs, fallback, true), () => snapshot_of(inputs, [], true)) };
    line.snapshots.set(source, entry);
    return entry;
  };

  const rank = async (line_id: number, request: RankRequest) => {
    for (;;) {
      const line = lines.get(line_id);
      if (!line) return;
      const entry = snapshot(line, request.source);
      // The background sends the inputs first. Without them the answer is empty, so the line does not wait.
      if (!entry) return post({ type: "ranked", line: line_id, reply: { type: "ranked", seq: request.seq, rows: [], partial: false } });
      const built = await entry.built;
      if (lines.get(line_id) !== line) return;
      // The fill ended while the fallback snapshot was built, and the stale push already went out: rank the full one.
      if (line.snapshots.get(request.source) !== entry) continue;
      const { rows, finder } = built.rank(request.word, request.limit, request.over_fetch);
      return post({ type: "ranked", line: line_id, reply: { type: "ranked", seq: request.seq, rows, partial: entry.partial, ...(finder ? { finder } : {}) } });
    }
  };

  // The service lets a line have one request in the Worker at a time, so a request that throws must still answer, or the line waits on it for good.
  const rank_and_answer = async (line_id: number, request: RankRequest) => {
    try {
      await rank(line_id, request);
    } catch (error) {
      warn_and_go("rank_index.rank")(error);
      post({ type: "ranked", line: line_id, reply: { type: "ranked", seq: request.seq, rows: [], partial: false, failed: true } });
    }
  };

  void history.when_ready().then(() => {
    for (const [line_id, line] of lines) {
      const partial = [...line.snapshots].filter(([, entry]) => entry.partial);
      for (const [source] of partial) line.snapshots.delete(source);
      if (partial.length > 0) post({ type: "stale", line: line_id });
    }
  });

  void history.start();

  const usage_for = (id: number, urls: readonly string[]) => {
    const rows = history.read();
    const wanted = new Set(urls);
    post({ type: "reply", id, value: rows && [...usage_by_url(history_items(rows.filter((row) => wanted.has(row.url))))] });
  };

  const pick = (id: number, text: string) => {
    const rows = history.read();
    let value: PickedHistory | undefined;
    try {
      if (rows) value = { row: pick_entry(history_items(rows), text, "history entry") };
    } catch (error) {
      // Any other error answers undefined, so the background picks over the browser's rows. The warning is the only trace of a bug that happens in the Worker alone.
      if (error instanceof RuntimeRefusal) value = { refusal: error.message };
      else warn_and_go("rank_index.pick")(error);
    }
    post({ type: "reply", id, value });
  };

  return {
    receive: (message: ToWorker) => {
      if (message.type === "history") {
        const { event } = message;
        if (event.kind === "visited") history.visited(event.visit);
        else if (event.kind === "title") history.title_changed(event);
        else history.visit_removed(event);
      } else if (message.type === "answer") {
        const question = waiting.get(message.id);
        waiting.delete(message.id);
        if (message.failed) question?.reject(new Error("the background could not answer"));
        else question?.resolve(message.value);
      } else if (message.type === "inputs") {
        const line = lines.get(message.line) ?? { inputs: new Map(), snapshots: new Map() };
        lines.set(message.line, line);
        line.inputs.set(message.inputs.source, message.inputs);
        line.snapshots.delete(message.inputs.source);
      } else if (message.type === "rank") void rank_and_answer(message.line, message.request);
      else if (message.type === "close") lines.delete(message.line);
      else if (message.type === "usage_for") usage_for(message.id, message.urls);
      else if (message.type === "pick_history") pick(message.id, message.text);
      else post({ type: "history_rows", id: message.id, rows: history.read() as HistoryRow[] | undefined });
    },
  };
}
