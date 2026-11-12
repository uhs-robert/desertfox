// One set of hint labels across every frame of a tab, for `hint --frames=all_frames`. The keyboard frame starts a session, every frame that runs the hints bundle reports how many candidates it found, and the background hands out one prefix-free label set. The keyboard frame keeps the typing rules and sends its typed prefix and its pick here, and this passes them on to the frames that own the labels.
// The session lives in `storage.session`, so a restarted background still routes typed keys and picks. Only the wait for reports is in memory: a restart ends it, and the keyboard frame's start request fails with it.
// Nothing on the wait awaits a browser call: Firefox can leave an injection or a message to a navigating frame unanswered, and only the deadline ends the wait then.

import { clean_letters, make_labels } from "../content/hints/labels.ts";
import type { HintFramesCollect, HintFramesEnd, HintFramesLabels, HintFramesPick, HintFramesStart, HintFramesStartAnswer, HintFramesTyped, Outcome } from "../shared/messages.ts";
import { HINT_FRAMES_STORAGE_PREFIX } from "./storage_keys.ts";

// Slow ad frames answer late, and a frame that has not reported by then gets no labels. The labels already drawn are never redrawn for it.
export const HINT_FRAMES_WAIT_MS = 300;

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export type HintFramesMessage = HintFramesCollect | HintFramesLabels | HintFramesTyped | HintFramesPick | HintFramesEnd;

export type HintFramesDeps = {
  storage: SessionStorage;
  // Runs the hints bundle in every frame of the tab that takes scripts, and resolves with how many ran it. Rejects when one frame refuses, while the others still run it. May never settle.
  inject_all: (tab_id: number) => Promise<number>;
  // To one frame, or with no frame to every frame of the tab.
  send: (tab_id: number, message: HintFramesMessage, frame_id?: number) => Promise<unknown>;
  new_session_id: () => string;
  set_timer: (callback: () => void, delay_ms: number) => unknown;
  clear_timer: (handle: unknown) => void;
  wait_ms: number;
};

// Frame ids are object keys here, because the session goes through storage.
// `reports` fills while the session collects. `labels` replaces it once the labels are out, and from then on the session takes no report.
export type HintFramesSession = {
  session_id: string;
  keyboard_frame: number;
  reports?: Record<string, number>;
  labels?: Record<string, string[]>;
};

// The in-memory side of a wait: how many frames ran the bundle, the call that ends the wait, and the candidate texts of the frames that reported. The texts stay out of storage.session: they can be hundreds of KB, and a restart ends the wait anyway.
type Wait = { expected?: number; wake: () => void; texts: Record<string, string[]> };

const key_of = (tab_id: number): string => HINT_FRAMES_STORAGE_PREFIX + tab_id;

const whole_count = (count: unknown): count is number => Number.isInteger(count) && (count as number) >= 0;

// One text per candidate: a report that sends none, or too few, leaves "" for the rest.
const texts_for = (count: number, texts: unknown): string[] => Array.from({ length: count }, (_, index) => (Array.isArray(texts) && typeof texts[index] === "string" ? texts[index] : ""));

const is_outcome = (answer: unknown): answer is Outcome => typeof (answer as Outcome | undefined)?.ok === "boolean";

const FRAME_GONE: Outcome = { ok: false, message: "The frame of that hint is gone" };
const NO_SESSION: Outcome = { ok: false, message: "The hints of the other frames have ended" };

// The top frame first, then the others by id, so the shortest labels go to the top page. Each frame's labels follow its own order, best first.
export function assign_labels(reports: Record<string, number>, letters: readonly string[]): Record<string, string[]> {
  const frames = Object.entries(reports).filter(([, count]) => count > 0).sort(([a], [b]) => Number(a) - Number(b));
  const all = make_labels(frames.reduce((sum, [, count]) => sum + count, 0), letters);
  let next = 0;
  return Object.fromEntries(frames.map(([frame_id, count]) => [frame_id, all.slice(next, (next += count))]));
}

export function create_hint_frames(deps: HintFramesDeps) {
  // One read-then-write at a time, so two reports together do not drop each other's frame.
  let chain: Promise<unknown> = Promise.resolve();
  const in_turn = <T>(step: () => Promise<T>): Promise<T> => {
    const run = chain.then(step);
    chain = run.catch(() => undefined);
    return run;
  };
  const waits = new Map<string, Wait>();

  const read = async (tab_id: number): Promise<HintFramesSession | undefined> => (await deps.storage.get(key_of(tab_id)))[key_of(tab_id)] as HintFramesSession | undefined;
  const write = (tab_id: number, session: HintFramesSession) => deps.storage.set({ [key_of(tab_id)]: session });
  const end_wait = (session: HintFramesSession | undefined) => session && waits.get(session.session_id)?.wake();
  const wake_when_all_reported = (session: HintFramesSession) => {
    const wait = waits.get(session.session_id);
    if (wait?.expected !== undefined && Object.keys(session.reports ?? {}).length >= wait.expected) wait.wake();
  };
  // The session the frame may act on: the tab's current one, with its labels out, and only for the frame that started it.
  const labeled_for = async (tab_id: number, frame_id: number, session_id: string): Promise<HintFramesSession | undefined> => {
    const session = await in_turn(() => read(tab_id));
    return session?.session_id === session_id && session.labels && session.keyboard_frame === frame_id ? session : undefined;
  };
  // A frame that navigated keeps its id, so the session id in every message lets its new page ignore what was meant for the old one.
  const send_quietly = (tab_id: number, message: HintFramesMessage, frame_id?: number) => deps.send(tab_id, message, frame_id).catch(() => undefined);

  // The keyboard frame's own count is in already, so only the other frames race the deadline.
  async function collect(tab_id: number, session_id: string, args: Record<string, unknown>, own: Wait["texts"]): Promise<Wait["texts"]> {
    let wake!: () => void;
    const woken = new Promise<void>((resolve) => (wake = resolve));
    const wait: Wait = { wake, texts: own };
    waits.set(session_id, wait);
    const timer = deps.set_timer(wake, deps.wait_ms);
    // The bundle must run before the ask, or a frame that loads it now misses the ask. A frame that refuses scripts rejects the count, and the deadline ends the wait.
    void deps.inject_all(tab_id).then(
      (expected) => {
        wait.expected = expected;
        return ask_frames(tab_id, session_id, args);
      },
      () => ask_frames(tab_id, session_id, args),
    );
    try {
      await woken;
    } finally {
      deps.clear_timer(timer);
      waits.delete(session_id);
    }
    return wait.texts;
  }

  // A newer run can start while this one's injection runs. Its frames keep the latest ask only, so an ask for a session that has ended must not go out after the newer one. An injection that answers after the deadline asks nobody, because the labels are out.
  async function ask_frames(tab_id: number, session_id: string, args: Record<string, unknown>): Promise<void> {
    const session = await in_turn(() => read(tab_id));
    if (!waits.has(session_id) || session?.session_id !== session_id) return;
    void send_quietly(tab_id, { type: "hint_frames_collect", session_id, args });
    wake_when_all_reported(session);
  }

  return {
    // A new run in the tab ends the one before, in every frame.
    start: async (tab_id: number, frame_id: number, request: Pick<HintFramesStart, "letters" | "args" | "count" | "texts">): Promise<HintFramesStartAnswer> => {
      const session_id = deps.new_session_id();
      const replaced = await in_turn(async () => {
        const old = await read(tab_id);
        await write(tab_id, { session_id, keyboard_frame: frame_id, reports: whole_count(request.count) ? { [frame_id]: request.count } : {} });
        end_wait(old);
        return old;
      });
      if (replaced) void send_quietly(tab_id, { type: "hint_frames_end", session_id: replaced.session_id });
      const texts = await collect(tab_id, session_id, request.args, whole_count(request.count) ? { [frame_id]: texts_for(request.count, request.texts) } : {});
      const labeled = await in_turn(async () => {
        const session = await read(tab_id);
        if (session?.session_id !== session_id) return undefined;
        const { reports, ...rest } = session;
        const next = { ...rest, labels: assign_labels(reports ?? {}, clean_letters(request.letters)) };
        await write(tab_id, next);
        return next;
      });
      if (!labeled?.labels) return { ok: false, reason: "ended" };
      const shares = Object.entries(labeled.labels).filter(([owner]) => Number(owner) !== frame_id);
      for (const [owner, labels] of shares) void send_quietly(tab_id, { type: "hint_frames_labels", session_id, labels }, Number(owner));
      const aligned = Object.entries(labeled.labels).flatMap(([owner, labels]) => texts_for(labels.length, texts[owner]));
      return { ok: true, session_id, labels: Object.values(labeled.labels).flat(), own_labels: labeled.labels[frame_id] ?? [], texts: aligned };
    },

    // A frame's count. Only the first report of a frame counts, and only while this background waits for the session. A restarted background has no wait, so a report cannot fill a session nobody labels.
    report: (tab_id: number, frame_id: number, session_id: string, count: unknown, texts?: unknown): Promise<void> =>
      in_turn(async () => {
        const wait = waits.get(session_id);
        if (!whole_count(count) || !wait) return;
        const session = await read(tab_id);
        if (session?.session_id !== session_id || !session.reports || String(frame_id) in session.reports) return;
        const next = { ...session, reports: { ...session.reports, [frame_id]: count } };
        await write(tab_id, next);
        wait.texts[frame_id] = texts_for(count, texts);
        wake_when_all_reported(next);
      }),

    typed: async (tab_id: number, frame_id: number, session_id: string, typed: string, text_mode?: Pick<HintFramesTyped, "matches" | "active"> | undefined): Promise<void> => {
      const session = await labeled_for(tab_id, frame_id, session_id);
      if (!session?.labels) return;
      const others = Object.keys(session.labels).map(Number).filter((owner) => owner !== frame_id);
      for (const owner of others) void send_quietly(tab_id, { type: "hint_frames_typed", session_id, typed, ...text_mode }, owner);
    },

    // The owner's answer is the pick's. It can wait on the user (a prompt), so it runs outside the turn.
    pick: async (tab_id: number, frame_id: number, session_id: string, label: string): Promise<Outcome> => {
      const session = await labeled_for(tab_id, frame_id, session_id);
      if (!session?.labels) return NO_SESSION;
      const owner = Object.entries(session.labels).find(([, labels]) => labels.includes(label))?.[0];
      if (owner === undefined) return { ok: false, message: `No hint has the label ${label}` };
      const answer = await deps.send(tab_id, { type: "hint_frames_pick", session_id, label }, Number(owner)).catch(() => undefined);
      return is_outcome(answer) ? answer : FRAME_GONE;
    },

    // To every frame, so a frame that reported late drops its candidates too.
    end: async (tab_id: number, frame_id: number, session_id: string): Promise<void> => {
      const ended = await in_turn(async () => {
        const session = await read(tab_id);
        if (session?.session_id !== session_id || session.keyboard_frame !== frame_id) return false;
        await deps.storage.remove(key_of(tab_id));
        end_wait(session);
        return true;
      });
      if (ended) void send_quietly(tab_id, { type: "hint_frames_end", session_id });
    },

    // A load replaces every frame, so nothing is left to tell. An address change the page makes itself keeps the frames and the session.
    navigated: (tab_id: number, change: { status?: string | undefined; url?: string | undefined }): Promise<void> => (change.status === "loading" && change.url === undefined ? forget(tab_id) : Promise.resolve()),

    forget,
  };

  function forget(tab_id: number): Promise<void> {
    return in_turn(async () => {
      const session = await read(tab_id);
      if (!session) return;
      await deps.storage.remove(key_of(tab_id));
      end_wait(session);
    });
  }
}

export type HintFrames = ReturnType<typeof create_hint_frames>;

export function browser_hint_frames_deps(): HintFramesDeps {
  return {
    storage: browser.storage.session,
    // Document start runs the bundle at once, so a frame that still loads reports instead of holding the labels until it is idle. The bundle registers once per page, so a frame that has it already only counts.
    // This skips the bundle host's load map. In a frame the user never entered, the bundle starts the waiting content script first, so the frame answers too.
    inject_all: async (tab_id) => (await browser.tabs.executeScript(tab_id, { file: "hints.js", allFrames: true, matchAboutBlank: true, runAt: "document_start" })).length,
    send: (tab_id, message, frame_id) => browser.tabs.sendMessage(tab_id, message, frame_id === undefined ? {} : { frameId: frame_id }),
    new_session_id: () => crypto.randomUUID(),
    set_timer: (callback, delay_ms) => setTimeout(callback, delay_ms),
    clear_timer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    wait_ms: HINT_FRAMES_WAIT_MS,
  };
}
