// The mode each tab last reported, kept in storage so a restarted background still knows it.

import type { CommandDef, Mode } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import { TAB_MODE_STORAGE_PREFIX } from "./storage_keys.ts";

type ModeStorage = Pick<typeof browser.storage.local, "get" | "set" | "remove">;

const TOP_FRAME = 0;

const key_of = (tab_id: number): string => TAB_MODE_STORAGE_PREFIX + tab_id;
// Under the tab-mode prefix, so a restart clears it with the modes.
const manual_insert_key_of = (tab_id: number): string => `${TAB_MODE_STORAGE_PREFIX}insert_${tab_id}`;

// Whether `i` holds the tab in insert mode. The background owns this tab-wide state, and a frame that loads later joins it.
export async function read_insert_hold(storage: ModeStorage, tab_id: number): Promise<boolean> {
  return (await storage.get(manual_insert_key_of(tab_id)))[manual_insert_key_of(tab_id)] === true;
}

export const write_insert_hold = (storage: ModeStorage, tab_id: number): Promise<void> => storage.set({ [manual_insert_key_of(tab_id)]: true });

export const clear_insert_hold = (storage: ModeStorage, tab_id: number): Promise<void> => storage.remove(manual_insert_key_of(tab_id));

export async function remember_tab_mode(storage: ModeStorage, tab_id: number, mode: Mode): Promise<void> {
  await storage.set({ [key_of(tab_id)]: mode });
}

// Only the top frame sets the tab's mode: a field focused in an iframe must not hide ignore mode.
export async function remember_reported_mode(storage: ModeStorage, tab_id: number, frame_id: number | undefined, mode: Mode): Promise<boolean> {
  if (frame_id !== TOP_FRAME) return false;
  await remember_tab_mode(storage, tab_id, mode);
  return true;
}

// A new page starts in normal mode and its content script reports again, so the old page's mode must not outlive it.
export async function forget_mode_on_navigation(storage: ModeStorage, tab_id: number, change: { status?: string | undefined }): Promise<void> {
  if (change.status === "loading") await forget_tab_mode(storage, tab_id);
}

// Tab ids are reused after a browser restart, so a new background run starts from nothing.
export async function forget_all_tab_modes(storage: ModeStorage): Promise<void> {
  const stored = await storage.get(null);
  const keys = Object.keys(stored).filter((key) => key.startsWith(TAB_MODE_STORAGE_PREFIX));
  if (keys.length > 0) await storage.remove(keys);
}

export async function forget_tab_mode(storage: ModeStorage, tab_id: number): Promise<void> {
  await storage.remove([key_of(tab_id), manual_insert_key_of(tab_id)]);
}

// A tab that never reported a mode is in normal mode, for example an about: page where no content script runs.
export async function recall_tab_mode(storage: ModeStorage, tab_id: number): Promise<Mode> {
  const stored = await storage.get(key_of(tab_id));
  return (stored[key_of(tab_id)] as Mode | undefined) ?? "normal";
}

// While DesertFox is off no shortcut runs (the toggle is not a slot). In ignore mode a shortcut runs only if its commands can run there, which is how a binding leaves ignore mode.
export function shortcut_allowed(mode: Mode, invocations: BoundInvocation[], get_command: (id: string) => Pick<CommandDef, "modes"> | undefined, disabled: boolean): boolean {
  if (disabled) return false;
  if (mode !== "ignore") return true;
  return invocations.every((invocation) => get_command(invocation.id)?.modes?.includes("ignore"));
}
