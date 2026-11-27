// The background end of DesertFox's own page code on a locked page (the PDF viewer and Reader View), where the browser module runs `content.js` and the bundles in a sandbox (`src/content/locked_shim.ts`).
// It answers the page's calls through the message table, stands in for `tabs.sendMessage` to such a tab, and keeps the snapshots of read-only data the page needs whole. Nothing is written or served while the `browser_module_pages` setting is off.
// Every call is foreign input from chrome storage: the base channel (`browser_module.ts`) checks the envelope and the size, this file checks the message and builds the sender itself.

import type { ModuleArgs, ModuleReply, PageAnswer, SnapshotPart } from "../shared/browser_module_protocol.ts";
import { BROWSER_MODULE_PROTOCOL_VERSION, locked_route_of, MAX_ERROR_CHARS, MAX_STATE_TABS, SNAPSHOT_PART_NAMES, SNAPSHOT_PARTS, validate_snapshot } from "../shared/browser_module_protocol.ts";
import { BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY, CONFIG_STATUS_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import { touches_settings } from "../shared/storage_watch.ts";
import { THEME_STORAGE_KEY } from "../shared/theme/apply.ts";
import { best_effort, keep_chain } from "../shared/swallow.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;
type Sender = browser.runtime.MessageSender;
type Sent = { ok: true; id: string } | { ok: false; problem: string };
// What the locked tabs key holds per tab: the address and document of the page code's first call, and the documents that later loads left.
type LockedTab = { url?: string; document_id?: number; left?: number[] };
const LEFT_DOCUMENTS_KEPT = 8;

// Whether both settings are on in the stored config status, for the reason `module_setting_on` gives.
export async function pages_setting_on(storage: Pick<typeof browser.storage.local, "get">): Promise<boolean> {
  const status = (await storage.get(CONFIG_STATUS_STORAGE_KEY))[CONFIG_STATUS_STORAGE_KEY] as { settings?: { browser_module?: unknown; browser_module_pages?: unknown } } | undefined;
  return status?.settings?.browser_module === true && status.settings.browser_module_pages === true;
}

export type BrowserModuleRpcDeps = {
  session: SessionStorage;
  is_on: () => Promise<boolean>;
  // The base channel's `send`. `on_id` hears the request id before the module can see the request.
  send: (kind: string, args: ModuleArgs, on_id?: (id: string) => void) => Promise<Sent>;
  get_tab: (tab_id: number) => Promise<browser.tabs.Tab | undefined>;
  // The message table's `dispatch`, with no sender counted as an extension page.
  dispatch: (message: unknown, sender: Sender) => Promise<unknown> | undefined | void;
  // What each snapshot holds now, or undefined for nothing.
  read_part: Record<SnapshotPart, () => Promise<unknown>>;
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

// The pages the module may run DesertFox's page code in: Reader View, and the PDF viewer, whose tab shows the PDF's own address. Never another about: page, whose principal is the system principal, and never an extension page.
export const runs_page_code = (address: string): boolean => address.startsWith("about:reader?") || /^(https?|file):/.test(address);

const answer_text = (answer: PageAnswer): string => {
  try {
    return JSON.stringify(answer);
  } catch {
    return JSON.stringify({ error: "the answer is not plain data" } satisfies PageAnswer);
  }
};

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
  // The page's answers to pushes that are on their way, by the push's message id. In memory only, as the promise of a `tabs.sendMessage` is.
  const waiting = new Map<string, { tab_id: number; resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  // One queue for every write of this file: the locked marks, their removal, the snapshots and the cleanup when the setting goes off. Two writes of the marks never interleave, so neither loses the other's tab.
  let queue: Promise<unknown> = Promise.resolve();
  const in_turn = <T>(step: () => Promise<T>): Promise<T> => {
    const run = queue.then(step);
    queue = keep_chain(run);
    return run;
  };

  const read_locked = async (): Promise<Record<string, LockedTab>> => {
    const stored: unknown = (await deps.session.get(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY))[BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY];
    return typeof stored === "object" && stored !== null && !Array.isArray(stored) ? (stored as Record<string, LockedTab>) : {};
  };

  // A tab is locked from its document's first call until its next top-level load. The next document marks it again with its own first call. A call from a document that a load left is refused, so a call the old document sent before a reload of the same address cannot mark the tab again. False when the call may not run.
  const mark_locked = (tab_id: number, url: string, document_id: number): Promise<boolean> =>
    in_turn(async () => {
      if (!(await deps.is_on())) return false;
      const locked = await read_locked();
      const entry = locked[tab_id] ?? {};
      if (entry.left?.includes(document_id)) return false;
      if (entry.url === url && entry.document_id === document_id) return true;
      if (!(tab_id in locked) && Object.keys(locked).length >= MAX_STATE_TABS) return false;
      await deps.session.set({ [BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY]: { ...locked, [tab_id]: { ...entry, url, document_id } } });
      return true;
    });

  // Counts the loads of each tab, and every setting off in `epoch`, so a push whose send spans one knows its page went away.
  const loads = new Map<number, number>();
  let epoch = 0;
  const drop_waiting = (tab_id: number | undefined, why: string): void => {
    if (tab_id === undefined) epoch += 1;
    else loads.set(tab_id, (loads.get(tab_id) ?? 0) + 1);
    for (const [id, entry] of waiting) {
      if (tab_id !== undefined && entry.tab_id !== tab_id) continue;
      waiting.delete(id);
      entry.reject(new Error(why));
    }
  };

  // The page went away: its pushes reject, as a `tabs.sendMessage` to it would, and the tab is no longer locked. A load keeps the id of the document it left. A closed tab keeps nothing.
  const unmark = (tab_id: number, why: string, closed: boolean): Promise<void> => {
    drop_waiting(tab_id, why);
    return in_turn(async () => {
      const locked = await read_locked();
      const entry = locked[tab_id];
      if (entry === undefined) return;
      if (closed) delete locked[tab_id];
      else locked[tab_id] = { left: [...(entry.left ?? []), ...(entry.document_id === undefined ? [] : [entry.document_id])].slice(-LEFT_DOCUMENTS_KEPT) };
      await deps.session.set({ [BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY]: locked });
    });
  };

  // The base runs this outside its queue, so the dispatch may send to the same tab. The text it returns is the reply's value.
  const page_call = async (args: ModuleArgs): Promise<string> => {
    // The kind row checked the arg shapes: `tab_id` and `document_id` are whole numbers and `message` text.
    const { tab_id, document_id, message } = args as { tab_id: number; document_id: number; message: string };
    const load_at_start = loads.get(tab_id) ?? 0;
    if (!(await deps.is_on())) throw new Error("the browser_module_pages setting is off");
    const request = page_message_of(message);
    if (request === undefined) throw new Error("the message is not one a locked page may send");
    const tab = await deps.get_tab(tab_id);
    if (tab === undefined || tab.id !== tab_id || tab.url === undefined) throw new Error("no such tab");
    if (!runs_page_code(tab.url)) throw new Error("DesertFox's page code does not run on this page");
    // A load that ran while the tab was read left the document that sent this call, and no mark records it yet.
    if ((loads.get(tab_id) ?? 0) !== load_at_start) throw new Error("the page went away");
    if (!(await mark_locked(tab_id, tab.url, document_id))) throw new Error("the page went away");
    // The sender holds only what the browser says of the tab: no extension id, so no handler counts it as an extension page, and frame 0, the only frame the module runs in. An address the page names is the tab's.
    const sender: Sender = { tab, frameId: 0, url: tab.url };
    const request_at_tab = "url" in request ? { ...request, url: tab.url } : request;
    const answer = answer_text(await answer_of(() => deps.dispatch(request_at_tab, sender)));
    // The answer can hold page text, so it goes nowhere once the setting is off.
    if (!(await deps.is_on())) throw new Error("the browser_module_pages setting is off");
    return answer;
  };

  // The module's reply to a push. A reply to no waiting push does nothing, so a second one is harmless.
  const push_answered = (reply: ModuleReply): void => {
    const entry = waiting.get(reply.reply_to);
    if (entry === undefined) return;
    waiting.delete(reply.reply_to);
    if (!reply.ok) return entry.reject(new Error(reply.error ?? "the page refused the message"));
    let answer: unknown;
    try {
      answer = JSON.parse(reply.value ?? "{}");
    } catch {
      return entry.reject(new Error("the page's answer is not JSON"));
    }
    if (typeof answer !== "object" || answer === null || Array.isArray(answer)) entry.reject(new Error("the page's answer is not a table"));
    else if (typeof (answer as PageAnswer).error === "string") entry.reject(new Error((answer as PageAnswer).error));
    else entry.resolve((answer as PageAnswer).value);
  };

  const is_locked_tab = async (tab_id: number): Promise<boolean> => {
    if (!(await deps.is_on())) return false;
    const url = (await read_locked())[tab_id]?.url;
    return url !== undefined && (await deps.get_tab(tab_id))?.url === url;
  };

  // In place of `tabs.sendMessage`: the module hands the message to the page, and the page's answer comes back in the reply. A locked page has one frame.
  const send_to_locked_tab = async (tab_id: number, message: unknown, frame_id?: number): Promise<unknown> => {
    if (frame_id !== undefined && frame_id !== 0) throw new Error("a locked page has only its top frame");
    const load_at_start = loads.get(tab_id) ?? 0;
    const epoch_at_start = epoch;
    const page_left = () => (loads.get(tab_id) ?? 0) !== load_at_start || epoch !== epoch_at_start;
    let answer: Promise<unknown> | undefined;
    // The wait is set before the module can see the push, so a fast reply finds it. A load or a setting off during the send sets none.
    const sent = await deps.send("page_push", { tab_id, message: JSON.stringify(message) }, (id) => {
      if (page_left()) return;
      answer = new Promise<unknown>((resolve, reject) => waiting.set(id, { tab_id, resolve, reject }));
      // A load can reject it before this function hands it back. The caller still gets the rejection.
      void best_effort(answer);
    });
    if (!sent.ok) throw new Error(sent.problem);
    if (answer === undefined) throw new Error(epoch === epoch_at_start ? "the page went away" : "the browser_module_pages setting is off");
    return answer;
  };

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
  const sync_parts = (parts: readonly SnapshotPart[]): Promise<void> => in_turn(() => write_parts(parts));

  return {
    handlers: { page_call },
    // The base channel's `on_reply`.
    push_answered,
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
    // Every top-level load of the tab, a reload of the same address included.
    tab_loading: (tab_id: number): Promise<void> => unmark(tab_id, "the page went away", false),
    tab_removed: (tab_id: number): Promise<void> => unmark(tab_id, "the tab closed", true),
  };
}
