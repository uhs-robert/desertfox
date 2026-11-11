// The `quality` bundle seen from the background: one request to one site player of a tab, and the completion rows of `media quality `.

import type { QualityAnswer, QualityReport, QualityRequest } from "../shared/quality.ts";
import type { RegisterItem } from "../shared/messages.ts";

// The reports that frames push when the bundle runs in them. A request listens for its tab while it waits, so a report that arrives with no request waiting is dropped.
export function create_quality_reports() {
  const listeners = new Map<number, Set<(frame_id: number, report: QualityReport) => void>>();
  return {
    listen(tab_id: number, on_report: (frame_id: number, report: QualityReport) => void): () => void {
      const set = listeners.get(tab_id) ?? new Set();
      set.add(on_report);
      listeners.set(tab_id, set);
      return () => {
        set.delete(on_report);
        if (set.size === 0 && listeners.get(tab_id) === set) listeners.delete(tab_id);
      };
    },
    receive(tab_id: number | undefined, frame_id: number | undefined, report: QualityReport): void {
      if (tab_id === undefined || frame_id === undefined || report?.type !== "quality_report") return;
      for (const on_report of listeners.get(tab_id) ?? []) on_report(frame_id, report);
    },
  };
}

export type QualityReports = ReturnType<typeof create_quality_reports>;

export type QualityDeps = {
  reports: QualityReports;
  // Runs the bundle in every frame and resolves with how many ran it. Rejects when any frame refuses, while the others still run it.
  inject_all: (tab_id: number) => Promise<number>;
  send: (tab_id: number, frame_id: number, request: QualityRequest) => Promise<unknown>;
  // The whole request, from injection to answer. A request that is still waiting then sends nothing, so a refusal already shown never changes a player later.
  timeout_ms: number;
  // How long to wait for the frames after an injection rejected, since the count of frames that ran it is then unknown.
  partial_wait_ms: number;
};

// One player acts, so a page with several embeds never changes or skips more than one. A player that lists its levels beats one that does not (an embed that has not played), then the top frame, then the lowest frame id.
export function choose_player(frames: readonly { frame_id: number; report: QualityReport }[]): number | undefined {
  const players = frames.filter(({ report }) => report.player);
  const rank = ({ frame_id, report }: (typeof players)[number]) => (report.ready ? 0 : 2) + (frame_id === 0 ? 0 : 1);
  return [...players].sort((a, b) => rank(a) - rank(b) || a.frame_id - b.frame_id)[0]?.frame_id;
}

// Undefined when no frame has a player, when the page refuses scripts everywhere, or when the time ran out. A frame that refuses the script does not stop the others.
export async function ask_quality(deps: QualityDeps, tab_id: number, request: QualityRequest): Promise<QualityAnswer | undefined> {
  const frames = new Map<number, QualityReport>();
  let expected: number | undefined;
  let expired = false;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  const complete = () => expected !== undefined && frames.size >= expected;
  // The listener comes first: a frame can report before the injection resolves.
  const stop = deps.reports.listen(tab_id, (frame_id, report) => {
    frames.set(frame_id, report);
    if (complete()) finish();
  });
  const timer = setTimeout(() => ((expired = true), finish()), deps.timeout_ms);
  try {
    deps.inject_all(tab_id).then(
      (count) => ((expected = count), complete() && finish()),
      () => void setTimeout(finish, deps.partial_wait_ms),
    );
    await done;
  } finally {
    clearTimeout(timer);
    stop();
  }
  const frame_id = choose_player([...frames].map(([id, report]) => ({ frame_id: id, report })));
  if (expired || frame_id === undefined) return undefined;
  let stop_waiting!: (answer: undefined) => void;
  const late = new Promise<undefined>((resolve) => (stop_waiting = resolve));
  const give_up = setTimeout(() => stop_waiting(undefined), deps.timeout_ms);
  try {
    return (await Promise.race([deps.send(tab_id, frame_id, request).catch(() => undefined), late])) as QualityAnswer | undefined;
  } finally {
    clearTimeout(give_up);
  }
}

export const quality_reports = create_quality_reports();

export const ask_quality_in_tab = (tab_id: number, request: QualityRequest): Promise<QualityAnswer | undefined> =>
  ask_quality(
    {
      reports: quality_reports,
      inject_all: async (id) => (await browser.tabs.executeScript(id, { file: "quality.js", allFrames: true, matchAboutBlank: true, runAt: "document_start" })).length,
      send: (id, frame_id, message) => browser.tabs.sendMessage(id, message, { frameId: frame_id }),
      // Below the 1.5 s the `media` command waits for any frame.
      timeout_ms: 1200,
      partial_wait_ms: 300,
    },
    tab_id,
    request,
  );

const WORDS: readonly RegisterItem[] = [
  { name: "max", description: "The highest level" },
  { name: "min", description: "The lowest level" },
  { name: "auto", description: "Let the site choose" },
  { name: "up", description: "One level higher" },
  { name: "down", description: "One level lower" },
];

// The words always, so a page with no player or a player that is not ready still completes. Each level is named by its height, which is what `media quality` takes, and the site's own label (such as 1080p60) goes in the description. The levels come from the player when the line first asks, best first.
export function quality_rows(answer: QualityAnswer | undefined): RegisterItem[] {
  const by_height = new Map<number, RegisterItem>();
  for (const { label, height, active } of answer?.levels ?? []) by_height.set(height, { name: `${height}p`, description: [label !== `${height}p` ? label : "", active ? "playing now" : ""].filter(Boolean).join(", ") });
  return [...WORDS, ...[...by_height].sort((a, b) => b[0] - a[0]).map(([, row]) => row)];
}
