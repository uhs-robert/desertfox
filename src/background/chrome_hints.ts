// Hints over Firefox's own UI, the extension's half. The browser module collects the targets of a window, or of one of Firefox's own pages, and sends their ids, boxes and texts (`browser_module/desertfox-chrome-hints.js`, and `desertfox-devtools.js` for DevTools). This file makes the labels, runs each typed key through the page's hint picker (`src/shared/hints/pick.ts`), and names the target to pick.
// The session lives in `storage.session`, so a restarted background still narrows and picks. Every message carries the session number, so a message of an older session finds nothing.
// The picker is a closure, so the session keeps the keys that changed what shows and replays them into a fresh picker at each key, rather than a copy of the picker's state.

import { CHROME_HINT_MAX_PARTS, CHROME_HINT_PART_BYTES, CHROME_HINT_TEXT_CHARS, MAX_CHROME_HINT_TEXT_PARTS, json_bytes } from "../shared/browser_module_protocol.ts";
import type { ModuleArgs } from "../shared/browser_module_protocol.ts";
import type { PageHintChoice } from "../shared/browser_module_scope.ts";
import { CHROME_HINTS_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import { make_labels } from "../shared/hints/labels.ts";
import { create_picker } from "../shared/hints/pick.ts";
import { keep_chain } from "../shared/swallow.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

// [id, left, top, width, height] in CSS pixels of the window.
export type TargetRow = [number, number, number, number, number];
export type LabelRow = [number, string];
export type TextRow = [number, string];

export type ChromeHintSession = {
  session: number;
  // The browser window the session runs in, or none for one the user started in a dialog, in one of Firefox's other windows or in DevTools, which the extension cannot name.
  window_id?: number;
  // `devtools`: the module's DevTools file holds the session, so draw, pick and clear go on its own kinds. Absent for a session of chrome hints.
  surface?: "devtools";
  // Each part of the targets as it came, until the labels are made from all of them.
  parts?: number;
  targets: Record<string, TargetRow[]>;
  labels?: LabelRow[];
  // Each part of the texts as it came, then all of them once every part is in. A session whose texts never came keeps to labels.
  text_parts?: number;
  texts_in?: Record<string, TextRow[]>;
  texts?: TextRow[];
  // The keys that changed what shows, in order.
  tokens: string[];
  // The `hint_key_line` setting at the first draw.
  key_line?: true;
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
  // The action of the hint key the module matched on one of Firefox's own pages, from the stored keymap.
  page_action: (keys: string) => Promise<PageHintChoice>;
  // The `hint_key_line` setting.
  key_line: () => Promise<boolean>;
};

// Room beside a part's rows for the rest of the message.
const ROWS_BYTES = CHROME_HINT_PART_BYTES - 512;
const MAX_ROWS = 400;

// The module's refusal of a start token the user cancelled (Escape, a click, another window) or let expire. The user ended it, so no toast says why.
const STALE_START = "The hint key is stale";

const kind_of = (session: ChromeHintSession, verb: "draw" | "pick" | "clear"): string => `${session.surface === "devtools" ? "devtools_hints" : "chrome_hints"}.${verb}`;

const is_whole = (value: unknown): value is number => Number.isSafeInteger(value);
const is_part_of = (part: unknown, parts: unknown): boolean => is_whole(parts) && parts >= 1 && parts <= CHROME_HINT_MAX_PARTS && is_whole(part) && part >= 0 && part < parts;

const parsed_rows = (text: string): unknown[] | undefined => {
  try {
    const rows: unknown = JSON.parse(text);
    return Array.isArray(rows) && rows.length <= MAX_ROWS ? rows : undefined;
  } catch {
    return undefined;
  }
};

// The module's targets are foreign input: rows of five whole numbers, the id above zero. A part with any other row is dropped whole.
export function target_rows(text: string): TargetRow[] | undefined {
  const rows = parsed_rows(text);
  return rows?.every((row) => Array.isArray(row) && row.length === 5 && row.every(is_whole) && (row[0] as number) > 0) ? (rows as TargetRow[]) : undefined;
}

// The module's texts are foreign input too: rows of an id and a short text with no control or format character. A part with any other row is dropped whole.
const is_hint_text = (text: unknown): text is string => typeof text === "string" && text !== "" && [...text].length <= CHROME_HINT_TEXT_CHARS && !/[\p{Cc}\p{Cf}]/u.test(text);
export function text_rows(text: string): TextRow[] | undefined {
  const rows = parsed_rows(text);
  return rows?.every((row) => Array.isArray(row) && row.length === 2 && is_whole(row[0]) && row[0] > 0 && is_hint_text(row[1])) ? (rows as TextRow[]) : undefined;
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

// What the module shows: the labels that still match, and in text mode the typed text and the id Enter picks.
export type HintView = { typed: string; ids: number[]; query?: string; active?: number };
export type KeyStep = { view: HintView; tokens: string[] } | { pick: number } | undefined;

// The keys the picker takes besides one character. Tab and Space turn labels and rapid on a page, which a session leaves to the module or to a later change, so only text mode reads them here.
const PICKER_TOKENS = new Set(["<Tab>", "<S-Tab>", "<Enter>", "<Space>", "<Backspace>"]);
const OLDER_MODULE_KEYS: Record<string, string> = { Backspace: "<Backspace>", Enter: "<Enter>", Tab: "<Tab>", " ": "<Space>" };
const MAX_TOKENS = 64;
const is_char_token = (token: string): boolean => [...token].length === 1 && !/[\s\p{Cc}\p{Cf}]/u.test(token);

// The key token of a `chrome_hints.key`: its `token`, or for an older module that sends only the event's key, the token of that key. Undefined for a key the picker never takes.
export function token_of_key(args: ModuleArgs): string | undefined {
  const token = typeof args.token === "string" ? args.token : typeof args.key === "string" ? (OLDER_MODULE_KEYS[args.key] ?? args.key) : undefined;
  return token !== undefined && (is_char_token(token) || PICKER_TOKENS.has(token)) ? token : undefined;
}

// What a typed key does, by the rules of hints on a page: the earlier `tokens` replay into a fresh picker, then `token` goes in. `texts` holds the text of each label's target, by the label's index.
// Undefined: nothing changes, so the key is not kept. `/` with no text to type against is such a key, as is any key once the session kept MAX_TOKENS besides the Tabs at the end.
export function key_step(labels: readonly LabelRow[], texts: readonly (string | undefined)[], tokens: readonly string[], token: string): KeyStep {
  if (tokens.length - turns_at_end(tokens) >= MAX_TOKENS) return undefined;
  const picker = create_picker(labels.map(([, label]) => label), () => texts);
  const id_of = (index: number): number => labels[index]![0];
  let before: HintView = { typed: "", ids: labels.map(([id]) => id) };
  const view_after = (kept: string): HintView | number | undefined => {
    const outcome = picker.on_token_(kept);
    if (outcome.kind !== "handled") return undefined;
    if (outcome.picked !== undefined) return id_of(outcome.picked);
    const ids = outcome.still_possible_.map(id_of);
    return outcome.text === undefined ? { typed: outcome.typed, ids } : { typed: "", ids, query: outcome.text, ...(outcome.active !== undefined && { active: id_of(outcome.active) }) };
  };
  for (const kept of tokens) {
    const view = view_after(kept);
    if (typeof view === "object") before = view;
  }
  if (token === "/" && !picker.in_text_mode_() && !texts.some((text) => text !== undefined)) return undefined;
  const after = view_after(token);
  if (typeof after === "number") return { pick: after };
  if (after === undefined || JSON.stringify(after) === JSON.stringify(before)) return undefined;
  return { view: after, tokens: kept_after(tokens, token, after.ids.length) };
}

const is_turn = (token: string): boolean => token === "<Tab>" || token === "<S-Tab>";
const turns_at_end = (tokens: readonly string[]): number => tokens.length - (tokens.findLastIndex((token) => !is_turn(token)) + 1);

// Tab and Shift-Tab only move the active match round the `matches`, and the next key kept after them sets it back to the best one. So the history keeps the Tabs only at its end, as the shortest run to the same match.
function kept_after(tokens: readonly string[], token: string, matches: number): string[] {
  const before_turns = tokens.slice(0, tokens.length - turns_at_end(tokens));
  if (!is_turn(token)) return [...before_turns, token];
  const forward = [...tokens.slice(before_turns.length), token].reduce((sum, turn) => sum + (turn === "<Tab>" ? 1 : -1), 0);
  const net = ((forward % matches) + matches) % matches;
  return [...before_turns, ...(net <= matches / 2 ? Array<string>(net).fill("<Tab>") : Array<string>(matches - net).fill("<S-Tab>"))];
}

// The texts by label, once every part came. A target with no text is undefined, which text mode skips.
const texts_by_label = (session: ChromeHintSession): (string | undefined)[] => {
  const by_id = new Map(session.texts ?? []);
  return session.labels!.map(([id]) => by_id.get(id));
};

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

  // One whole draw: the labels that still match what was typed. A DevTools session has no text mode and no key line yet, so its draw carries neither.
  async function send_draw(session: ChromeHintSession, view: HintView): Promise<void> {
    const by_id = new Map(session.labels!);
    const parts = label_parts(view.ids.map((id) => [id, by_id.get(id)!]));
    const text_fields = session.surface === "devtools" ? {} : { ...(view.query !== undefined && { query: view.query }), ...(view.active !== undefined && { active: view.active }), ...(session.key_line && { key_line: 1 }) };
    for (const [part, rows] of parts.entries()) await deps.push(kind_of(session, "draw"), { session: session.session, gen: session.gen, part, parts: parts.length, typed: view.typed, labels: JSON.stringify(rows), ...text_fields });
  }

  async function pick(session: ChromeHintSession, id: number): Promise<void> {
    const result = await deps.call(kind_of(session, "pick"), { session: session.session, id });
    if (!result.ok) await deps.notify(session.window_id, result.error);
  }

  // Counts every start, so a start that waits before `begin` can tell that a newer one came meanwhile.
  let starts = 0;

  async function begin(fields: { window_id?: number; surface?: "devtools" }, collect: (session: number, colors: string) => Promise<{ ok: true } | { ok: false; error: string }>): Promise<{ ok: true } | { ok: false; error: string }> {
    starts++;
    const session: ChromeHintSession = { session: deps.new_session(), ...fields, targets: {}, tokens: [], seq: 0, gen: 0 };
    const previous = await in_turn(async () => {
      const replaced = await read();
      await write(session);
      return replaced;
    });
    // The module ends the older session only when the newer one collects. A refused collect would leave it showing, with no stored session to narrow it.
    if (previous) await deps.push(kind_of(previous, "clear"), { session: previous.session });
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
      await deps.push(kind_of(session, "clear"), { session: session.session });
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
        if (await deps.key_line()) session.key_line = true;
        await write(session);
        await send_draw(session, { typed: "", ids: session.labels.map(([id]) => id) });
      }),
    // Once every part is in, text mode can rank the targets. A part read twice only sets the same rows again.
    "chrome_hints.texts": (args: ModuleArgs): Promise<void> =>
      in_turn(async () => {
        const session = await current(args.session);
        const rows = typeof args.texts === "string" ? text_rows(args.texts) : undefined;
        if (!session || session.texts || !rows || !is_part_of(args.part, args.parts) || (args.parts as number) > MAX_CHROME_HINT_TEXT_PARTS) return;
        if (session.text_parts !== undefined && session.text_parts !== args.parts) return;
        session.text_parts = args.parts as number;
        const texts_in = { ...session.texts_in, [String(args.part)]: rows };
        const all = Array.from({ length: session.text_parts }, (_, part) => texts_in[String(part)]);
        if (all.some((part) => part === undefined)) session.texts_in = texts_in;
        else {
          session.texts = all.flat() as TextRow[];
          delete session.texts_in;
        }
        await write(session);
      }),
    "chrome_hints.key": (args: ModuleArgs): Promise<void> =>
      in_turn(async () => {
        const session = await current(args.session);
        if (!session?.labels || !is_whole(args.seq) || (args.seq as number) <= session.seq) return;
        session.seq = args.seq as number;
        const token = token_of_key(args);
        // A session stored by a build before hint mode keys has no `tokens`.
        const step = token === undefined ? undefined : key_step(session.labels, texts_by_label(session), session.tokens ?? [], token);
        if (step === undefined) return void (await write(session));
        if ("pick" in step) {
          await drop();
          // Not awaited in the turn: the next session's messages must not wait for this reply.
          void pick(session, step.pick);
          return;
        }
        session.tokens = step.tokens;
        session.gen++;
        await write(session);
        await send_draw(session, step.view);
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
    // The module heard a hint key on one of Firefox's own pages. As with `want`, its token goes back as it came, with the action of the key's binding.
    // A refusal throws, so the reply tells the module to end its start at once and give the keys back.
    "page_hints.want": async (args: ModuleArgs): Promise<void> => {
      if (!is_whole(args.start) || typeof args.keys !== "string") return;
      const start = args.start;
      const asked_at = ++starts;
      const chosen = await deps.page_action(args.keys);
      // A newer start began while the action loaded, and this one would replace its session. The throw ends this start in the module.
      if (starts !== asked_at) throw new Error(STALE_START);
      if (!chosen.ok) {
        await deps.notify(undefined, chosen.problem);
        throw new Error(chosen.problem);
      }
      const result = await begin({}, (session, colors) => deps.call("page_hints.collect", { session, start, action: chosen.action, colors }));
      if (!result.ok && result.error !== STALE_START) await deps.notify(undefined, result.error);
    },
    // The module heard the hint key in DevTools. As with `want`, its token goes back as it came.
    "devtools_hints.ask": async (args: ModuleArgs): Promise<void> => {
      if (!is_whole(args.ask)) return;
      const ask = args.ask;
      const result = await begin({ surface: "devtools" }, (session, colors) => deps.call("devtools_hints.collect", { session, ask, colors }));
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
