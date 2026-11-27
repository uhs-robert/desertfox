// The background end of DesertFox's own page code on a locked page (about:addons, about:preferences, the PDF viewer, Reader View), where the browser module runs `content.js` and the bundles in a sandbox (`src/content/locked_shim.ts`).
// It answers the page's calls through the message table, stands in for `tabs.sendMessage` to such a tab, and keeps the snapshots of read-only data the page needs whole. Nothing is written or served while the `browser_module_pages` setting is off.
// Every call is foreign input from chrome storage: the base channel (`browser_module.ts`) checks the envelope and the size, this file checks the message and builds the sender itself.

import type { ModuleArgs, PageAnswer, SnapshotPart } from "../shared/browser_module_protocol.ts";
import { BROWSER_MODULE_PROTOCOL_VERSION, locked_route_of, MAX_ERROR_CHARS, MAX_STATE_TABS, SNAPSHOT_PART_NAMES, SNAPSHOT_PARTS, validate_snapshot } from "../shared/browser_module_protocol.ts";
import { BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY, CONFIG_STATUS_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import { touches_settings } from "../shared/storage_watch.ts";
import { THEME_STORAGE_KEY } from "../shared/theme/apply.ts";
import { keep_chain, warn_and_go } from "../shared/swallow.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;
type Sender = browser.runtime.MessageSender;
type Sent = { ok: true; id: string } | { ok: false; problem: string };

// Whether both settings are on in the stored config status, for the reason `module_setting_on` gives.
export async function pages_setting_on(storage: Pick<typeof browser.storage.local, "get">): Promise<boolean> {
  const status = (await storage.get(CONFIG_STATUS_STORAGE_KEY))[CONFIG_STATUS_STORAGE_KEY] as { settings?: { browser_module?: unknown; browser_module_pages?: unknown } } | undefined;
  return status?.settings?.browser_module === true && status.settings.browser_module_pages === true;
}

export type BrowserModuleRpcDeps = {
  session: SessionStorage;
  is_on: () => Promise<boolean>;
  // The base channel's `send`. Never awaited inside a handler (see `BrowserModuleDeps.handlers`).
  send: (kind: string, args: ModuleArgs) => Promise<Sent>;
  get_tab: (tab_id: number) => Promise<browser.tabs.Tab | undefined>;
  // The message table's `dispatch`, with no sender counted as an extension page.
  dispatch: (message: unknown, sender: Sender) => Promise<unknown> | undefined | void;
  // What each snapshot holds now, or undefined for nothing.
  read_part: Record<SnapshotPart, () => Promise<unknown>>;
  now: () => number;
};

// A message of the page that the background may take, or undefined. Its own `tab`, `frameId` or sender fields mean nothing: the sender is built apart.
function page_message_of(text: string): Record<string, unknown> | undefined {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof message !== "object" || message === null || Array.isArray(message)) return undefined;
  const type = (message as { type?: unknown }).type;
  return locked_route_of(type) === "background" ? (message as Record<string, unknown>) : undefined;
}

const error_text = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS);

// A handler that throws, at once or later, gives an error answer and never reaches the background's own error path.
async function answer_of(run: () => Promise<unknown> | undefined | void): Promise<PageAnswer> {
  try {
    return { value: await run() };
  } catch (error) {
    return { error: error_text(error) };
  }
}

export function create_browser_module_rpc(deps: BrowserModuleRpcDeps) {
  // The page's answers to pushes that are on their way. In memory only, as the promise of a `tabs.sendMessage` is.
  const waiting = new Map<string, { tab_id: number; resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let pushes = 0;

  const read_locked = async (): Promise<Record<string, string>> => {
    const stored: unknown = (await deps.session.get(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY))[BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY];
    return typeof stored === "object" && stored !== null && !Array.isArray(stored) ? (stored as Record<string, string>) : {};
  };

  // A tab is locked while its address is the one it had at the page's last call. A navigation changes it, and the next page's first call marks it again.
  const mark_locked = async (tab_id: number, url: string): Promise<void> => {
    const locked = await read_locked();
    if (locked[tab_id] === url || (!(tab_id in locked) && Object.keys(locked).length >= MAX_STATE_TABS)) return;
    await deps.session.set({ [BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY]: { ...locked, [tab_id]: url } });
  };

  const drop_waiting = (tab_id: number | undefined, why: string): void => {
    for (const [call_id, entry] of waiting) {
      if (tab_id !== undefined && entry.tab_id !== tab_id) continue;
      waiting.delete(call_id);
      entry.reject(new Error(why));
    }
  };

  const reply = async (tab_id: number, call_id: string, answer: PageAnswer): Promise<void> => {
    let text: string | undefined;
    try {
      text = JSON.stringify(answer);
    } catch {
      text = undefined;
    }
    const sent = text === undefined ? undefined : await deps.send("page_reply", { tab_id, call_id, answer: text });
    if (sent?.ok !== true) await deps.send("page_reply", { tab_id, call_id, answer: JSON.stringify({ error: text === undefined ? "the answer is not plain data" : "the answer is too large" } satisfies PageAnswer) });
  };

  // The base runs this inside its queue, so it never awaits the dispatch: a handler that sends to the same tab would wait behind it for good. The reply only says the call was taken. A throw gives an error reply.
  // The kind row checked the arg shapes: `tab_id` is a whole number, `call_id` an id and `message` text.
  const page_call = async (args: ModuleArgs): Promise<void> => {
    const { tab_id, call_id, message } = args as { tab_id: number; call_id: string; message: string };
    if (!(await deps.is_on())) throw new Error("the browser_module_pages setting is off");
    const request = page_message_of(message);
    if (request === undefined) throw new Error("the message is not one a locked page may send");
    const tab = await deps.get_tab(tab_id);
    if (tab === undefined || tab.id !== tab_id || tab.url === undefined) throw new Error("no such tab");
    await mark_locked(tab_id, tab.url);
    // The sender holds only what the browser says of the tab: no extension id, so no handler counts it as an extension page, and frame 0, the only frame the module runs in. An address the page names is the tab's.
    const sender: Sender = { tab, frameId: 0, url: tab.url };
    const request_at_tab = "url" in request ? { ...request, url: tab.url } : request;
    void answer_of(() => deps.dispatch(request_at_tab, sender))
      .then((answer) => reply(tab_id, call_id, answer))
      .catch(warn_and_go("browser_module_rpc.reply"));
  };

  const page_answer = async ({ tab_id, call_id, answer }: ModuleArgs): Promise<void> => {
    const entry = waiting.get(call_id as string);
    if (entry === undefined || entry.tab_id !== tab_id) return;
    waiting.delete(call_id as string);
    let parsed: PageAnswer;
    try {
      parsed = JSON.parse(answer as string) as PageAnswer;
    } catch {
      return entry.reject(new Error("the page's answer is not JSON"));
    }
    if (typeof parsed !== "object" || parsed === null) entry.reject(new Error("the page's answer is not a table"));
    else if (typeof parsed.error === "string") entry.reject(new Error(parsed.error));
    else entry.resolve(parsed.value);
  };

  const is_locked_tab = async (tab_id: number): Promise<boolean> => {
    if (!(await deps.is_on())) return false;
    const url = (await read_locked())[tab_id];
    return url !== undefined && (await deps.get_tab(tab_id))?.url === url;
  };

  // In place of `tabs.sendMessage`: the module hands the message to the page, and the page's answer settles the promise. A locked page has one frame.
  const send_to_locked_tab = async (tab_id: number, message: unknown, frame_id?: number): Promise<unknown> => {
    if (frame_id !== undefined && frame_id !== 0) throw new Error("a locked page has only its top frame");
    const call_id = `p${deps.now().toString(36)}-${pushes++}`;
    const answer = new Promise<unknown>((resolve, reject) => waiting.set(call_id, { tab_id, resolve, reject }));
    const sent = await deps.send("page_push", { tab_id, call_id, message: JSON.stringify(message) });
    if (!sent.ok) {
      waiting.delete(call_id);
      throw new Error(sent.problem);
    }
    return answer;
  };

  let snapshots: Promise<unknown> = Promise.resolve();
  // A part that fails its own check (over its cap) is removed, so the page reads nothing rather than an old copy.
  const write_parts = async (parts: readonly SnapshotPart[]): Promise<void> => {
    if (!(await deps.is_on())) {
      drop_waiting(undefined, "the browser_module_pages setting is off");
      await deps.session.remove([...SNAPSHOT_PART_NAMES.map((part) => SNAPSHOT_PARTS[part].key), BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY]);
      return;
    }
    for (const part of parts) {
      const value = await deps.read_part[part]();
      const snapshot = { v: BROWSER_MODULE_PROTOCOL_VERSION, ...(value !== undefined && { value }) };
      if (validate_snapshot(part, snapshot).ok) await deps.session.set({ [SNAPSHOT_PARTS[part].key]: snapshot });
      else await deps.session.remove(SNAPSHOT_PARTS[part].key);
    }
  };
  // One write at a time, so a later change never lands under an earlier one.
  const sync_parts = (parts: readonly SnapshotPart[]): Promise<void> => {
    const run = snapshots.then(() => write_parts(parts));
    snapshots = keep_chain(run);
    return run;
  };

  return {
    handlers: { page_call, page_answer },
    is_locked_tab,
    send_to_locked_tab,
    // Run at each background start. A setting change runs it too, through `storage_changed`.
    sync: () => sync_parts(SNAPSHOT_PART_NAMES),
    storage_changed(changes: Record<string, unknown>, area: string): void {
      if (area !== "local") return;
      // A settings change can turn the setting on or off, so it rewrites every part.
      if (touches_settings(changes, area)) void sync_parts(SNAPSHOT_PART_NAMES);
      else if (COMPILED_KEYMAP_STORAGE_KEY in changes) void sync_parts(["keymap", "which_key"]);
      if (THEME_STORAGE_KEY in changes) void sync_parts(["theme"]);
    },
    // The page of the tab went away, as a `tabs.sendMessage` to it would reject.
    tab_left(tab_id: number): void {
      drop_waiting(tab_id, "the page went away");
    },
    async tab_removed(tab_id: number): Promise<void> {
      drop_waiting(tab_id, "the tab closed");
      const locked = await read_locked();
      if (!(tab_id in locked)) return;
      delete locked[tab_id];
      await deps.session.set({ [BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY]: locked });
    },
  };
}
