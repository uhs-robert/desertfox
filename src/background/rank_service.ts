// The background's side of the ranked lists (`open`, `history`, the finder). It starts the rank Worker (`rank_worker.ts`), which holds the only copy of the history rows,
// forwards the history events to it in the order they fire, answers its questions with browser calls, and relays each line's port (`shared/rank_port.ts`) to it.
// The Worker restarts when it fails, and fills its history again. A line's request in flight then goes to the new Worker.

import type { Asker } from "./complete_items.ts";
import { no_inputs } from "./completion_rank.ts";
import type { HistoryNode, RankInputs } from "./completion_rank.ts";
import type { HistoryRow, Visit } from "./history_cache.ts";
import type { FromWorker, HistoryEvent, Question, ToWorker } from "./rank_index.ts";
import { RANK_PORT_NAME, RANKED_ROWS } from "../shared/rank_port.ts";
import type { RankPush, RankRequest, RankSource } from "../shared/rank_port.ts";
import { refused_as, warn_and_go } from "../shared/swallow.ts";

export type RankWorker = {
  postMessage: (message: ToWorker) => void;
  terminate: () => void;
  onmessage: ((event: { data: FromWorker }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type RankPort = {
  name: string;
  sender?: { tab?: { id?: number | undefined; windowId?: number | undefined; incognito?: boolean | undefined } | undefined; frameId?: number | undefined; url?: string | undefined } | undefined;
  postMessage: (message: RankPush) => void;
  disconnect: () => void;
  onMessage: { addListener: (listener: (message: unknown) => void) => void };
  onDisconnect: { addListener: (listener: () => void) => void };
};

export type RankServiceDeps = {
  start_worker: () => RankWorker;
  search: (max: number) => Promise<Visit[]>;
  listed: (url: string) => Promise<boolean>;
  fallback: () => Promise<HistoryNode[]>;
  inputs: (source: RankSource, asker: Asker) => Promise<RankInputs>;
  // Whether the frame of the tab redeemed a line's ticket. Only that frame's page may rank, because a web page can frame the line's page.
  is_opener: (tab_id: number, frame_id: number) => Promise<boolean>;
  // Whether the port comes from the line's own page, not a content script or another extension page.
  is_line_page: (port: RankPort) => boolean;
  set_timer: (callback: () => void, delay_ms: number) => unknown;
  clear_timer: (handle: unknown) => void;
};

// A Worker that fails before it says `ready` restarts after this wait, doubled each time, so a Worker that cannot start does not spin.
const RESTART_FIRST_MS = 250;
const RESTART_MAX_MS = 30_000;
// A handler that reads the history falls back to the plain search when the Worker does not answer in time.
const HISTORY_ROWS_WAIT_MS = 2000;
const MAX_WORD_LENGTH = 1000;
const MAX_OVER_FETCH = 10_000;

const SOURCES: readonly unknown[] = ["open", "history", "anything"] satisfies RankSource[];

const is_count = (value: unknown, max: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;

const is_rank_request = (message: unknown): message is RankRequest => {
  const request = message as Partial<RankRequest> | undefined;
  return request?.type === "rank" && is_count(request.seq, Number.MAX_SAFE_INTEGER) && SOURCES.includes(request.source) && typeof request.word === "string" && request.word.length <= MAX_WORD_LENGTH && is_count(request.limit, RANKED_ROWS) && is_count(request.over_fetch, MAX_OVER_FETCH);
};

type Line = {
  id: number;
  port: RankPort;
  asker: Asker | undefined;
  admitted: Promise<boolean>;
  // Read once per line and list, and kept, so a new Worker gets the same inputs.
  inputs: Map<RankSource, Promise<RankInputs>>;
  // The lists whose inputs the current Worker has.
  posted: Set<RankSource>;
  // One request runs in the Worker at a time. A newer one waits in `queued`, which keeps only the newest.
  in_flight?: RankRequest | undefined;
  queued?: RankRequest | undefined;
  closed: boolean;
};

export function create_rank_service(deps: RankServiceDeps) {
  let worker: RankWorker | undefined;
  let worker_ready = false;
  let failures = 0;
  let restart_timer: unknown;
  let next_rows_id = 0;
  const rows_waiting = new Map<number, (rows: HistoryRow[] | undefined) => void>();
  let next_line = 0;
  const lines = new Map<number, Line>();

  const post = (message: ToWorker) => worker?.postMessage(message);

  const relay = async (line: Line, request: RankRequest) => {
    line.in_flight = request;
    let inputs = line.inputs.get(request.source);
    if (!inputs) line.inputs.set(request.source, (inputs = deps.inputs(request.source, line.asker!).catch(warn_and_go("rank_service.inputs", no_inputs(request.source, line.asker!.incognito)))));
    const read = await inputs;
    // A restart while the inputs were read relays this request again itself.
    if (line.closed || line.in_flight !== request || !worker) return;
    if (!line.posted.has(request.source)) {
      post({ type: "inputs", line: line.id, inputs: read });
      line.posted.add(request.source);
    }
    post({ type: "rank", line: line.id, request });
  };

  const answer_question = async (id: number, question: Question) => {
    const asked = worker;
    let reply: ToWorker;
    try {
      const value = question.kind === "search" ? await deps.search(question.max) : question.kind === "listed" ? await refused_as(deps.listed(question.url), false) : await refused_as(deps.fallback(), []);
      reply = { type: "answer", id, value };
    } catch {
      reply = { type: "answer", id, value: undefined, failed: true };
    }
    // A Worker that failed meanwhile asks again from its own fill.
    if (worker === asked) post(reply);
  };

  const from_worker = (message: FromWorker) => {
    if (message.type === "ready") {
      worker_ready = true;
      failures = 0;
    } else if (message.type === "ask") void answer_question(message.id, message.question);
    else if (message.type === "history_rows") {
      rows_waiting.get(message.id)?.(message.rows);
      rows_waiting.delete(message.id);
    } else {
      const line = lines.get(message.line);
      if (!line) return;
      if (message.type === "stale") return line.port.postMessage({ type: "stale" });
      if (line.in_flight?.seq !== message.reply.seq) return;
      line.in_flight = undefined;
      line.port.postMessage(message.reply);
      const next = line.queued;
      line.queued = undefined;
      if (next) void relay(line, next);
    }
  };

  const start = () => {
    restart_timer = undefined;
    worker_ready = false;
    let started: RankWorker;
    try {
      started = deps.start_worker();
    } catch {
      return lost();
    }
    worker = started;
    started.onmessage = ({ data }) => {
      if (worker === started) from_worker(data);
    };
    started.onerror = () => {
      if (worker === started) lost();
    };
    for (const line of lines.values()) {
      line.posted.clear();
      if (line.in_flight) void relay(line, line.in_flight);
    }
  };

  // Any error ends the Worker: its rows may be half updated. Events that fire before the next one starts are in the browser's history, which its fill reads.
  const lost = () => {
    worker?.terminate();
    worker = undefined;
    for (const resolve of rows_waiting.values()) resolve(undefined);
    rows_waiting.clear();
    const delay = worker_ready ? 0 : Math.min(RESTART_MAX_MS, RESTART_FIRST_MS * 2 ** failures);
    failures = worker_ready ? 0 : failures + 1;
    worker_ready = false;
    restart_timer = deps.set_timer(start, delay);
  };

  const history_event = (event: HistoryEvent) => post({ type: "history", event });

  const close = (line: Line) => {
    if (line.closed) return;
    line.closed = true;
    lines.delete(line.id);
    post({ type: "close", line: line.id });
  };

  const on_request = async (line: Line, message: unknown) => {
    if (!is_rank_request(message) || !(await line.admitted) || line.closed) return;
    if (!line.in_flight) return void relay(line, message);
    if (line.queued) line.port.postMessage({ type: "ranked", seq: line.queued.seq, rows: [], partial: false, skipped: true });
    line.queued = message;
  };

  return {
    // Starts the Worker, which fills its history at once. A second call does nothing.
    start: () => {
      if (!worker && restart_timer === undefined) start();
    },
    // Firefox's history events, copied out of the browser's objects. The Worker applies them in this order.
    visited: (visit: { url?: string | undefined; title?: string | undefined; lastVisitTime?: number | undefined; visitCount?: number | undefined }) =>
      history_event({ kind: "visited", visit: { url: visit.url, title: visit.title, lastVisitTime: visit.lastVisitTime, visitCount: visit.visitCount } }),
    title_changed: ({ url, title }: { url: string; title: string }) => history_event({ kind: "title", url, title }),
    visit_removed: ({ allHistory, urls }: { allHistory: boolean; urls: readonly string[] }) => history_event({ kind: "removed", allHistory, urls: [...urls] }),
    // A copy of the Worker's rows, newest first, or undefined while its fill runs or when it does not answer.
    history_rows: (): Promise<HistoryRow[] | undefined> => {
      if (!worker) return Promise.resolve(undefined);
      const id = ++next_rows_id;
      return new Promise((resolve) => {
        const timer = deps.set_timer(() => {
          rows_waiting.delete(id);
          resolve(undefined);
        }, HISTORY_ROWS_WAIT_MS);
        rows_waiting.set(id, (rows) => {
          deps.clear_timer(timer);
          resolve(rows);
        });
        post({ type: "history_rows", id });
      });
    },
    // A line's port. The opener check runs once, at connect: the marker clears when the tab navigates, which also ends the frame and its port.
    connect: (port: RankPort) => {
      if (port.name !== RANK_PORT_NAME) return;
      const tab = port.sender?.tab;
      const frame_id = port.sender?.frameId;
      const asker = tab?.id !== undefined && tab.windowId !== undefined && frame_id !== undefined && deps.is_line_page(port) ? { tab_id: tab.id, frame_id, window_id: tab.windowId, incognito: tab.incognito === true } : undefined;
      const admitted = asker ? refused_as(deps.is_opener(asker.tab_id, asker.frame_id), false) : Promise.resolve(false);
      const line: Line = { id: ++next_line, port, asker, admitted, inputs: new Map(), posted: new Set(), closed: false };
      lines.set(line.id, line);
      port.onDisconnect.addListener(() => close(line));
      port.onMessage.addListener((message) => void on_request(line, message));
      void admitted.then((opener) => {
        if (opener || line.closed) return;
        close(line);
        try {
          port.disconnect();
        } catch {
          // Already gone.
        }
      });
    },
  };
}

export type RankService = ReturnType<typeof create_rank_service>;

// The one service of the background, set by `main.ts`. Other bundles that import `complete_items.ts` never start it.
let running: RankService | undefined;

export function start_rank_service(deps: RankServiceDeps): RankService {
  running = create_rank_service(deps);
  running.start();
  return running;
}

export const rank_history_rows = async (): Promise<HistoryRow[] | undefined> => running?.history_rows();

export function browser_rank_service_deps(from_services: Pick<RankServiceDeps, "inputs" | "is_opener" | "fallback" | "listed">): RankServiceDeps {
  const worker_url = browser.runtime.getURL("rank_worker.js");
  const line_page_url = browser.runtime.getURL("cmdline.html");
  return {
    ...from_services,
    start_worker: () => new Worker(worker_url) as unknown as RankWorker,
    search: async (max) => (await browser.history.search({ text: "", startTime: 0, maxResults: max })).map(({ url, title, lastVisitTime, visitCount }) => ({ url, title, lastVisitTime, visitCount })),
    is_line_page: (port) => port.sender?.url?.replace(/[?#].*$/, "") === line_page_url,
    set_timer: (callback, delay_ms) => setTimeout(callback, delay_ms),
    clear_timer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}
