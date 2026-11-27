// Hints over Firefox's own UI, the extension's half. The browser module collects the targets of a window and sends their ids and boxes (`browser_module/desertfox-chrome-hints.js`). This file makes the labels, narrows them as the module reports each typed key, and names the target to pick.
// The session lives in `storage.session`, so a restarted background still narrows and picks. Every message carries the session number, so a message of an older session finds nothing.

import { CHROME_HINT_MAX_PARTS, CHROME_HINT_PART_BYTES, json_bytes } from "../shared/browser_module_protocol.ts";
import type { ModuleArgs } from "../shared/browser_module_protocol.ts";
import { CHROME_HINTS_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import { make_labels, narrow } from "../shared/hints/labels.ts";
import { keep_chain } from "../shared/swallow.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

// [id, left, top, width, height] in CSS pixels of the window.
export type TargetRow = [number, number, number, number, number];
export type LabelRow = [number, string];

export type ChromeHintSession = {
  session: number;
  // The browser window the session runs in, or none for one the user started in a dialog or in one of Firefox's other windows, which the extension cannot name.
  window_id?: number;
  // Each part of the targets as it came, until the labels are made from all of them.
  parts?: number;
  targets: Record<string, TargetRow[]>;
  labels?: LabelRow[];
  typed: string;
  // The last key handled and the last draw sent.
  seq: number;
  gen: number;
};

export type ChromeHintDeps = {
  storage: SessionStorage;
  // A push to the module, which gets no reply.
  push: (kind: string, args: ModuleArgs) => Promise<unknown>;
  // A request to the module and its reply.
  call: (kind: string, args: ModuleArgs) => Promise<{ ok: true } | { ok: false; error: string }>;
  letters: () => Promise<readonly string[]>;
  // JSON text of the theme's colors for the labels, or "".
  colors: () => Promise<string>;
  // Tells the user in that window, or the last focused one, why a pick or a start did nothing.
  notify: (window_id: number | undefined, message: string) => Promise<void>;
  new_session: () => number;
};

// Room beside a part's rows for the rest of the message.
const ROWS_BYTES = CHROME_HINT_PART_BYTES - 512;
const MAX_ROWS = 400;

// The module's refusal of a start token the user cancelled (Escape, a click, another window) or let expire. The user ended it, so no toast says why.
const STALE_START = "The hint key is stale";

const is_whole = (value: unknown): value is number => Number.isSafeInteger(value);
const is_part_of = (part: unknown, parts: unknown): boolean => is_whole(parts) && parts >= 1 && parts <= CHROME_HINT_MAX_PARTS && is_whole(part) && part >= 0 && part < parts;

// The module's targets are foreign input: rows of five whole numbers, the id above zero. A part with any other row is dropped whole.
export function target_rows(text: string): TargetRow[] | undefined {
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) return undefined;
  const fits = rows.every((row) => Array.isArray(row) && row.length === 5 && row.every(is_whole) && (row[0] as number) > 0);
  return fits ? (rows as TargetRow[]) : undefined;
}

// Reading order: by row, then left to right. Boxes whose tops are within a few pixels share a row.
const ROW_PX = 8;
export const reading_order = (rows: readonly TargetRow[]): TargetRow[] => [...rows].sort((a, b) => Math.floor(a[2] / ROW_PX) - Math.floor(b[2] / ROW_PX) || a[1] - b[1]);

// Label rows in parts that each fit a draw message. A part travels as text inside the message, so its size is that of the text as JSON, with each quote escaped.
export function label_parts(rows: readonly LabelRow[]): LabelRow[][] {
  const parts: LabelRow[][] = [[]];
  for (const row of rows) {
    const last = parts.at(-1)!;
    if (last.length > 0 && (json_bytes(JSON.stringify([...last, row])) ?? Infinity) > ROWS_BYTES) parts.push([row]);
    else last.push(row);
  }
  return parts;
}

export type KeyStep = { typed: string } | { pick: number } | undefined;

// What a typed key does, by the same rules as hints on a page: a letter that continues no label is dropped, Backspace takes one letter back, and the last letter of a label picks it. Undefined: nothing changes.
export function key_step(labels: readonly LabelRow[], typed: string, key: string): KeyStep {
  if (key === "Backspace") return typed === "" ? undefined : { typed: typed.slice(0, -1) };
  if ([...key].length !== 1 || /\s/.test(key)) return undefined;
  const next = typed + key.toLowerCase();
  const { still_possible_, complete } = narrow(labels.map(([, label]) => label), next);
  if (still_possible_.length === 0) return undefined;
  return complete === undefined ? { typed: next } : { pick: labels[complete]![0] };
}

export function create_chrome_hints(deps: ChromeHintDeps) {
  let chain: Promise<unknown> = Promise.resolve();
  const in_turn = <T>(step: () => Promise<T>): Promise<T> => {
    const run = chain.then(step);
    chain = keep_chain(run);
    return run;
  };
  const read = async (): Promise<ChromeHintSession | undefined> => (await deps.storage.get(CHROME_HINTS_STORAGE_KEY))[CHROME_HINTS_STORAGE_KEY] as ChromeHintSession | undefined;
  const write = (session: ChromeHintSession) => deps.storage.set({ [CHROME_HINTS_STORAGE_KEY]: session });
  const drop = () => deps.storage.remove(CHROME_HINTS_STORAGE_KEY);
  const current = async (number: unknown): Promise<ChromeHintSession | undefined> => {
    const session = await read();
    return session !== undefined && session.session === number ? session : undefined;
  };

  // One whole draw: the labels that still match what was typed.
  async function send_draw(session: ChromeHintSession): Promise<void> {
    const shown = session.labels!.filter(([, label]) => label.startsWith(session.typed));
    const parts = label_parts(shown);
    for (const [part, rows] of parts.entries()) await deps.push("chrome_hints.draw", { session: session.session, gen: session.gen, part, parts: parts.length, typed: session.typed, labels: JSON.stringify(rows) });
  }

  async function pick(session: ChromeHintSession, id: number): Promise<void> {
    const result = await deps.call("chrome_hints.pick", { session: session.session, id });
    if (!result.ok) await deps.notify(session.window_id, result.error);
  }

  async function begin(fields: { window_id?: number }, collect: (session: number, colors: string) => Promise<{ ok: true } | { ok: false; error: string }>): Promise<{ ok: true } | { ok: false; error: string }> {
    const session: ChromeHintSession = { session: deps.new_session(), ...fields, targets: {}, typed: "", seq: 0, gen: 0 };
    const previous = await in_turn(async () => {
      const replaced = await read();
      await write(session);
      return replaced;
    });
    // The module ends the older session only when the newer one collects. A refused collect would leave it showing, with no stored session to narrow it.
    if (previous) await deps.push("chrome_hints.clear", { session: previous.session });
    const colors = await deps.colors();
    // A newer start can store its session while the colors load. This one then sends nothing and reports no failure, so its collect never replaces the newer session in the module. The check and the send share one turn, so no start comes between them.
    const replaced_by_newer = async () => {
      const stored = await read();
      return stored !== undefined && stored.session !== session.session;
    };
    const sent = await in_turn(async () => ((await replaced_by_newer()) ? undefined : { reply: collect(session.session, colors) }));
    if (!sent) return { ok: true };
    const result = await sent.reply;
    if (!result.ok) {
      // A collect whose reply was lost can still have started a session in chrome, which would hold the keys until Escape.
      await deps.push("chrome_hints.clear", { session: session.session });
      await in_turn(async () => (await current(session.session)) && (await drop()));
    }
    return result;
  }

  const handlers = {
    // Once every part is in, the labels go out. A part that never comes leaves the session without labels, and the module ends it.
    "chrome_hints.targets": (args: ModuleArgs): Promise<void> =>
      in_turn(async () => {
        const session = await current(args.session);
        const rows = typeof args.targets === "string" ? target_rows(args.targets) : undefined;
        if (!session || session.labels || !rows || !is_part_of(args.part, args.parts)) return;
        if (session.parts !== undefined && session.parts !== args.parts) return;
        session.parts = args.parts as number;
        session.targets[String(args.part)] = rows;
        const all = Array.from({ length: session.parts }, (_, part) => session.targets[String(part)]);
        if (all.some((part) => part === undefined)) return void (await write(session));
        const ordered = reading_order(all.flat() as TargetRow[]);
        const labels = make_labels(ordered.length, await deps.letters());
        session.labels = ordered.map(([id], index) => [id, labels[index]!]);
        session.targets = {};
        session.gen = 1;
        await write(session);
        await send_draw(session);
      }),
    "chrome_hints.key": (args: ModuleArgs): Promise<void> =>
      in_turn(async () => {
        const session = await current(args.session);
        if (!session?.labels || !is_whole(args.seq) || (args.seq as number) <= session.seq || typeof args.key !== "string") return;
        session.seq = args.seq as number;
        const step = key_step(session.labels, session.typed, args.key);
        if (step === undefined) return void (await write(session));
        if ("pick" in step) {
          await drop();
          // Not awaited in the turn: the next session's messages must not wait for this reply.
          void pick(session, step.pick);
          return;
        }
        session.typed = step.typed;
        session.gen++;
        await write(session);
        await send_draw(session);
      }),
    "chrome_hints.end": (args: ModuleArgs): Promise<void> =>
      in_turn(async () => {
        if (await current(args.session)) await drop();
      }),
    // The module heard the user's binding with the focus in chrome. Its token goes back as it came: only the module knows the window it belongs to.
    "chrome_hints.want": async (args: ModuleArgs): Promise<void> => {
      if (!is_whole(args.start)) return;
      const start = args.start;
      const result = await begin({}, (session, colors) => deps.call("chrome_hints.collect_here", { session, start, colors }));
      if (!result.ok && result.error !== STALE_START) await deps.notify(undefined, result.error);
    },
  };

  return {
    handlers,
    // Starts a session in the window. A second start ends the first.
    start: (window_id: number) => begin({ window_id }, (session, colors) => deps.call("chrome_hints.collect", { session, window_id, colors })),
  };
}

export type ChromeHints = ReturnType<typeof create_chrome_hints>;
