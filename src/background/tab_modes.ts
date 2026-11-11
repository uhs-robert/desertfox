// The mode each tab is in, kept in storage so a restarted background still knows it.
// A tab's mode is the mode of the child frame whose document holds the keyboard focus, else the top frame's.
// A page can type into a child frame (Google Docs types into a hidden one), so the badge and the shortcut gate follow the frame that gets the keys.

import type { CommandDef, Mode } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import { TAB_MODE_STORAGE_PREFIX } from "./storage_keys.ts";

type ModeStorage = Pick<typeof browser.storage.local, "get" | "set" | "remove">;

const TOP_FRAME = 0;

// Only two frames matter: the top frame, which draws the badge, and the child frame that holds the focus, if any.
// `awaiting_commit` is set from the start of a load until its new page replaces the old one. See `forget_on_navigation`.
export type TabModeRecord = { top_mode?: Mode; focused_child?: { frame_id: number; mode: Mode }; awaiting_commit?: true };

// `ModeChanged` in src/shared/messages.ts, with the frame that sent it.
export type ModeReport = { frame_id: number; mode: Mode; focus: boolean };

const key_of = (tab_id: number): string => TAB_MODE_STORAGE_PREFIX + tab_id;
// Under the tab-mode prefix, so a restart clears it with the modes.
const manual_insert_key_of = (tab_id: number): string => `${TAB_MODE_STORAGE_PREFIX}insert_${tab_id}`;

// Whether `i` holds the tab in insert mode. The background owns this tab-wide state, and a frame that loads later joins it.
export async function read_insert_hold(storage: ModeStorage, tab_id: number): Promise<boolean> {
  return (await storage.get(manual_insert_key_of(tab_id)))[manual_insert_key_of(tab_id)] === true;
}

export const write_insert_hold = (storage: ModeStorage, tab_id: number): Promise<void> => storage.set({ [manual_insert_key_of(tab_id)]: true });

export const clear_insert_hold = (storage: ModeStorage, tab_id: number): Promise<void> => storage.remove(manual_insert_key_of(tab_id));

export function apply_mode_report(record: TabModeRecord, { frame_id, mode, focus }: ModeReport): TabModeRecord {
  const next = { ...record };
  if (frame_id === TOP_FRAME) {
    next.top_mode = mode;
    // The top frame without the focus says nothing about the child frames: one of them may hold it, or the window may be in the background.
    if (focus) delete next.focused_child;
  } else if (focus) next.focused_child = { frame_id, mode };
  else if (next.focused_child?.frame_id === frame_id) delete next.focused_child;
  return next;
}

// A tab that never reported a mode is in normal mode, for example an about: page where no content script runs.
export const mode_of_record = (record: TabModeRecord): Mode => record.focused_child?.mode ?? record.top_mode ?? "normal";

export function create_tab_modes(storage: ModeStorage) {
  // One read-then-write at a time, so two frames reporting together do not drop each other's change.
  let chain: Promise<unknown> = Promise.resolve();
  const in_turn = <T>(step: () => Promise<T>): Promise<T> => {
    const run = chain.then(step);
    chain = run.catch(() => undefined);
    return run;
  };
  const read = async (tab_id: number): Promise<TabModeRecord> => ((await storage.get(key_of(tab_id)))[key_of(tab_id)] as TabModeRecord | undefined) ?? {};
  const forget = (tab_id: number) => in_turn(() => storage.remove([key_of(tab_id), manual_insert_key_of(tab_id)]));

  return {
    // Answers the mode the top frame draws in place of its own: the focused child frame's, or undefined when no child frame holds focus.
    report: (tab_id: number, report: ModeReport): Promise<Mode | undefined> =>
      in_turn(async () => {
        const record = apply_mode_report(await read(tab_id), report);
        await storage.set({ [key_of(tab_id)]: record });
        return record.focused_child?.mode;
      }),
    recall: (tab_id: number): Promise<Mode> => in_turn(async () => mode_of_record(await read(tab_id))),
    forget,
    // A new page starts in normal mode and its content script reports again, so the old page's mode must not outlive it, also where the new page runs no content script.
    // Firefox sends `status: "loading"` with no `url` when a load starts, and a `url` each time the address changes. The old page can still report between the two, so the first address change after a start, which is the new page taking over, forgets again.
    // A later address change is the page's own (`history.replaceState` while it loads, as Google Docs does), and comes after its start report, so it forgets nothing.
    forget_on_navigation: (tab_id: number, change: { status?: string | undefined; url?: string | undefined }): Promise<void> =>
      in_turn(async () => {
        const load_started = change.status === "loading" && change.url === undefined;
        const new_page_took_over = change.url !== undefined && (await read(tab_id)).awaiting_commit;
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
