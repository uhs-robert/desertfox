// The mode each tab is in, kept in storage so a restarted background still knows it.
// A tab's mode is the mode of the child frame whose document holds the keyboard focus, else the top frame's. Ignore mode in the top frame beats both.
// A page can type into a child frame (Google Docs types into a hidden one), so the badge and the shortcut gate follow the frame that gets the keys.

import type { CommandDef, Mode } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import { TAB_MODE_STORAGE_PREFIX } from "./storage_keys.ts";
import { keep_chain, refused_as } from "../shared/swallow.ts";

type ModeStorage = Pick<typeof browser.storage.local, "get" | "set" | "remove">;

const TOP_FRAME = 0;

// Only two frames matter: the top frame, which draws the badge, and the child frame that holds the focus, if any.
// `awaiting_commit` is set from the start of a load until its new page replaces the old one. See `forget_on_navigation`.
// `parked` is the cross-origin child frame that took the focus on load and was handed back to the top page. `focused_once` holds every child frame that has had its first focus, parked or not: a frame is parked at that first focus only, so a frame that takes the focus back after a park, or a user's Tab into it, enters frame mode. A frame keeps its id through its own navigations, so a reloaded frame stays in `focused_once` until the top page navigates and the record goes.
// `entering` marks a focus the extension is about to move into a frame (`;f`, a hint pick), so that frame's first focus is the user's own and is not parked. `frame_id` names the frame when the frame itself asked, and is absent when the top page asked, because it cannot read the id of a frame of another site. Only a first focus spends the mark.
export type TabModeRecord = { top_mode?: Mode; focused_child?: { frame_id: number; mode: Mode }; awaiting_commit?: true; parked?: number; parked_blurred?: true; focused_once?: number[]; entering?: { ms: number; frame_id?: number } };

// `ModeChanged` in src/shared/messages.ts, with the frame that sent it. `cross_origin` is the background's own reading of the frame's address against the tab's.
export type ModeReport = { frame_id: number; mode: Mode; focus: boolean; activated?: boolean; in_field?: boolean; cross_origin?: boolean; now?: number };

// How long after a hint pick the next frame focus counts as the pick's.
export const ENTRY_WINDOW_MS = 3000;

// A frame of another site that took the focus with no click or key of its own and not on a field, as a sign-in popup does on load. A Tab into the frame looks the same to the frame, so it is parked too, once.
const parks = (record: TabModeRecord, report: ModeReport): boolean =>
  report.frame_id !== TOP_FRAME && report.focus && report.cross_origin === true && report.activated === false && report.in_field === false && !record.focused_once?.includes(report.frame_id) && !entry_covers(record, report);

// A report with no clock reading never counts a mark as fresh.
const entry_covers = ({ entering }: TabModeRecord, { frame_id, now }: ModeReport): boolean =>
  entering !== undefined && now !== undefined && now - entering.ms < ENTRY_WINDOW_MS && (entering.frame_id === undefined || entering.frame_id === frame_id);

// Hands the focus from a parked frame to the top page. The frame is asked first and answers whether it is still free: a click or key in it since the park was decided means the user is in it, and the top page must not blur it. A frame that is gone or does not answer is left alone too. The top page then blurs only its iframe element, so a field the page focused meanwhile keeps the focus.
// Both steps can still lose a race to a click in the last few milliseconds. That click then ends in frame mode, as before the park.
export async function hand_back_parked_frame(ask_frame: () => Promise<boolean>, tell_top: () => Promise<unknown>): Promise<void> {
  if (await refused_as(ask_frame(), false)) await tell_top();
}

// Only http and https addresses have an origin worth comparing: an about:blank or srcdoc frame shares its parent's.
export function is_cross_origin(frame_url: string | undefined, tab_url: string | undefined): boolean {
  try {
    const [frame, tab] = [new URL(frame_url ?? ""), new URL(tab_url ?? "")];
    return /^https?:$/.test(frame.protocol) && /^https?:$/.test(tab.protocol) && frame.origin !== tab.origin;
  } catch {
    return false;
  }
}

const key_of = (tab_id: number): string => TAB_MODE_STORAGE_PREFIX + tab_id;
// Under the tab-mode prefix, so a restart clears it with the modes.
const manual_insert_key_of = (tab_id: number): string => `${TAB_MODE_STORAGE_PREFIX}insert_${tab_id}`;

// Whether `i` holds the tab in insert mode. The background owns this tab-wide state, and a frame that loads later joins it.
export async function read_insert_hold(storage: ModeStorage, tab_id: number): Promise<boolean> {
  return (await storage.get(manual_insert_key_of(tab_id)))[manual_insert_key_of(tab_id)] === true;
}

export const write_insert_hold = (storage: ModeStorage, tab_id: number): Promise<void> => storage.set({ [manual_insert_key_of(tab_id)]: true });

export const clear_insert_hold = (storage: ModeStorage, tab_id: number): Promise<void> => storage.remove(manual_insert_key_of(tab_id));

export function apply_mode_report(record: TabModeRecord, report: ModeReport): TabModeRecord {
  const { frame_id, mode, focus } = report;
  const next = { ...record };
  const parked_now = parks(record, report);
  if (frame_id !== TOP_FRAME && focus) {
    // Only a frame's first focus spends the mark: a later report of a frame already focused says nothing about the entry.
    if (!record.focused_once?.includes(frame_id) && entry_covers(record, report)) delete next.entering;
    next.focused_once = [...new Set([...(record.focused_once ?? []), frame_id])];
    // A focus of the parked frame ends the park when the user is in it (a click or key) or the frame was blurred since the park: a hint moved the focus in, or Firefox handed it back. A report of the same focus that comes before the blur (a mode change) ends nothing.
    if (record.parked === frame_id && (report.activated === true || record.parked_blurred)) {
      delete next.parked;
      delete next.parked_blurred;
    }
  } else if (frame_id !== TOP_FRAME && record.parked === frame_id) next.parked_blurred = true;
  if (parked_now) {
    next.parked = frame_id;
    delete next.parked_blurred;
    return next;
  }
  if (frame_id === TOP_FRAME) {
    next.top_mode = mode;
    // The top frame without the focus says nothing about the child frames: one of them may hold it, or the window may be in the background.
    if (focus) delete next.focused_child;
  } else if (focus) next.focused_child = { frame_id, mode };
  else if (next.focused_child?.frame_id === frame_id) delete next.focused_child;
  return next;
}

// A tab that never reported a mode is in normal mode, for example an about: page where no content script runs.
// Ignore mode in the top frame beats the focused child frame: a field in a frame must not hide that the user turned the page's keys off, from the badge or from the shortcut gate.
// The top frame draws its own mode then, so it gets no child mode.
const shown_child_mode = (record: TabModeRecord): Mode | undefined => (record.top_mode === "ignore" ? undefined : record.focused_child?.mode);

export const mode_of_record = (record: TabModeRecord): Mode => shown_child_mode(record) ?? record.top_mode ?? "normal";

export function create_tab_modes(storage: ModeStorage) {
  // One read-then-write at a time, so two frames reporting together do not drop each other's change.
  let chain: Promise<unknown> = Promise.resolve();
  const in_turn = <T>(step: () => Promise<T>): Promise<T> => {
    const run = chain.then(step);
    chain = keep_chain(run);
    return run;
  };
  const read = async (tab_id: number): Promise<TabModeRecord> => ((await storage.get(key_of(tab_id)))[key_of(tab_id)] as TabModeRecord | undefined) ?? {};
  const forget = (tab_id: number) => in_turn(() => storage.remove([key_of(tab_id), manual_insert_key_of(tab_id)]));

  return {
    // `child_mode` is the mode the top frame draws in place of its own: the focused child frame's, or undefined when no child frame holds the focus or the top frame is in ignore mode.
    // `tell_top` says whether the top frame needs to hear it: the mode changed, or the top frame itself reported. A top frame that just started knows nothing yet, and one shown again from the back-forward cache still draws the child mode it had when it was hidden.
    // A report that changes nothing writes nothing: every frame reports again on each focus and each pageshow.
    // `park` says this report parked its frame: the caller hands the focus to the top page. A park reaches the top frame too, which labels the parked frame's targets.
    report: (tab_id: number, report: ModeReport): Promise<{ child_mode: Mode | undefined; tell_top: boolean; park: boolean; parked: boolean }> =>
      in_turn(async () => {
        const before = await read(tab_id);
        report = { ...report, now: Date.now() };
        const record = apply_mode_report(before, report);
        const child_mode = shown_child_mode(record);
        if (JSON.stringify(record) !== JSON.stringify(before)) await storage.set({ [key_of(tab_id)]: record });
        const parked_changed = record.parked !== before.parked;
        return { child_mode, tell_top: child_mode !== shown_child_mode(before) || report.frame_id === TOP_FRAME || parked_changed, park: parks(before, report), parked: record.parked !== undefined };
      }),
    // The extension is about to focus a frame, so the frame's first focus is the user's own. `frame_id` is the frame that asked, or undefined for the top page.
    expect_entry: (tab_id: number, frame_id?: number): Promise<void> =>
      in_turn(async () => {
        const record = await read(tab_id);
        await storage.set({ [key_of(tab_id)]: { ...record, entering: { ms: Date.now(), ...(frame_id !== undefined && { frame_id }) } } });
      }),
    parked_frame: (tab_id: number): Promise<number | undefined> => in_turn(async () => (await read(tab_id)).parked),
    // The parked frame is gone or refused a script. Resolves with the mode the top page shows for a child, or undefined when the record no longer named the frame and the top page needs no word.
    unpark: (tab_id: number, frame_id: number): Promise<{ child_mode: Mode | undefined } | undefined> =>
      in_turn(async () => {
        const { parked, parked_blurred, ...rest } = await read(tab_id);
        if (parked !== frame_id) return undefined;
        await storage.set({ [key_of(tab_id)]: rest });
        return { child_mode: shown_child_mode(rest) };
      }),
    recall: (tab_id: number): Promise<Mode> => in_turn(async () => mode_of_record(await read(tab_id))),
    forget,
    // A new page starts in normal mode and its content script reports again, so the old page's mode must not outlive it, also where the new page runs no content script.
    // Firefox sends `status: "loading"` with no `url` when a load starts, and a `url` each time the address changes. The old page can still report between the two, so the first address change after a start, which is the new page taking over, forgets again.
    // A later address change is the page's own (`history.replaceState` while it loads, as Google Docs does), and comes after its start report, so it forgets nothing.
    // A load can end with no new page (a download, a 204 answer, a stopped load). `status: "complete"` then ends the wait, so a later address change of the page that stayed forgets nothing either.
    forget_on_navigation: (tab_id: number, change: { status?: string | undefined; url?: string | undefined }): Promise<void> =>
      in_turn(async () => {
        const load_started = change.status === "loading" && change.url === undefined;
        const { awaiting_commit, ...modes } = load_started ? {} : await read(tab_id);
        const new_page_took_over = change.url !== undefined && awaiting_commit;
        const load_ended_on_old_page = change.status === "complete" && awaiting_commit && !new_page_took_over;
        if (load_ended_on_old_page) return storage.set({ [key_of(tab_id)]: modes });
        if (!load_started && !new_page_took_over) return;
        await storage.remove(manual_insert_key_of(tab_id));
        if (load_started) await storage.set({ [key_of(tab_id)]: { awaiting_commit: true } satisfies TabModeRecord });
        else await storage.remove(key_of(tab_id));
      }),
    // Tab ids are reused after a browser restart, so a new background run starts from nothing.
    forget_all: () =>
      in_turn(async () => {
        const keys = Object.keys(await storage.get(null)).filter((key) => key.startsWith(TAB_MODE_STORAGE_PREFIX));
        if (keys.length > 0) await storage.remove(keys);
      }),
  };
}

// While DesertFox is off no shortcut runs (the toggle is not a slot). In ignore mode a shortcut runs only if its commands can run there, which is how a binding leaves ignore mode.
export function shortcut_allowed(mode: Mode, invocations: BoundInvocation[], get_command: (id: string) => Pick<CommandDef, "modes"> | undefined, disabled: boolean): boolean {
  if (disabled) return false;
  if (mode !== "ignore") return true;
  return invocations.every((invocation) => get_command(invocation.id)?.modes?.includes("ignore"));
}
