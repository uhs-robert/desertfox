// The extension side of the browser module channel (`src/shared/browser_module_protocol.ts`). While the `browser_module` setting is on, it keeps the module's state in `storage.session`:
// the toolbar switch, the single-key bindings the module may run, and per tab the mode and whether DesertFox is live there. It also reads the module's hello and records what became of it.
// Everything here is a copy rebuilt from stored data (the keymap, the disabled flag, the tab mode records), so a background restart loses nothing. An extension reload empties `storage.session`, and the module then claims nothing until the start writes the state again.

import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, TreeNode } from "../shared/prefix_tree.ts";
import { CONFIG_STATUS_STORAGE_KEY, DISABLED_STORAGE_KEY, TAB_MODE_STORAGE_PREFIX } from "../shared/config/storage_keys.ts";
import type { KeyRow, KindTable, ModuleArgs, ModuleMessage, ModuleReply, ModuleRequest, ModuleState, TabState } from "../shared/browser_module_protocol.ts";
import {
  BROWSER_MODULE_HELLO_STORAGE_KEY,
  BROWSER_MODULE_PROTOCOL_VERSION,
  BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY,
  BROWSER_MODULE_FROM_MODULE_STORAGE_KEY,
  BROWSER_MODULE_STATE_STORAGE_KEY,
  BROWSER_MODULE_STATUS_STORAGE_KEY,
  check_module_args,
  HELLO_MIN_INTERVAL_MS,
  MESSAGE_MIN_GAP_MS,
  is_module_command_id,
  MAX_KEY_ROWS,
  MAX_STATE_TABS,
  status_of_hello,
  EXTENSION_TO_MODULE_KINDS,
  message_list_bytes,
  reply_fits,
  MAX_MESSAGES,
  MODULE_TO_EXTENSION_KINDS,
  validate_message,
  validate_message_list,
  validate_module_state,
} from "../shared/browser_module_protocol.ts";
import { touches_settings } from "../shared/storage_watch.ts";
import { keep_chain, warn_and_go } from "../shared/swallow.ts";
import { mode_of_record } from "./tab_modes.ts";
import type { TabModeRecord } from "./tab_modes.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

// Checks a command's args through the one validator and gives them back with every default filled, or undefined when the registry refuses them.
export type CheckCommandArgs = (id: string, args: Record<string, unknown> | undefined) => Record<string, unknown> | undefined;

// A leaf the module may run: one step, no guard, no key to wait for, and a command from the protocol's list whose args the registry accepts. Anything else stays with the content script.
function row_of(key: string, node: TreeNode, check_args: CheckCommandArgs): KeyRow | undefined {
  if (node.kind !== "leaf" || node.steps.length !== 1) return undefined;
  if (node.when_focus !== undefined || node.when_present !== undefined || node.otherwise !== undefined || node.otherwise_page !== undefined) return undefined;
  const { invocation, capture, register } = node.steps[0]!;
  if (capture !== undefined || register !== undefined || invocation.prompt !== undefined || !is_module_command_id(invocation.id)) return undefined;
  const filled = check_args(invocation.id, invocation.args);
  const args = filled && check_module_args(invocation.id, filled);
  return args?.ok ? { key, id: invocation.id, args: args.value } : undefined;
}

// The single-key normal bindings the module may run, in key order. Sequences (`gg`) and counts are the content script's.
export function key_rows_of(keymap: CompiledKeymap | undefined, check_args: CheckCommandArgs): KeyRow[] {
  const children = keymap?.modes.normal?.children ?? {};
  const rows = Object.entries(children).flatMap(([key, node]) => row_of(key, node, check_args) ?? []);
  return rows.sort((a, b) => (a.key < b.key ? -1 : 1)).slice(0, MAX_KEY_ROWS);
}

export const tab_state_of = (record: TabModeRecord): TabState => ({ mode: mode_of_record(record), live: record.live === true });

// The tab id of a tab mode key, or undefined for the manual insert hold key that shares the prefix.
export const tab_id_of_key = (key: string): string | undefined => (key.startsWith(TAB_MODE_STORAGE_PREFIX) && /^\d{1,10}$/.test(key.slice(TAB_MODE_STORAGE_PREFIX.length)) ? key.slice(TAB_MODE_STORAGE_PREFIX.length) : undefined);

// Whether the setting is on in the stored config status, which holds the settings in force. The status is written in the same `set` as the change event that asks, while `get_config` updates after it.
export async function module_setting_on(storage: Pick<typeof browser.storage.local, "get">): Promise<boolean> {
  const status = (await storage.get(CONFIG_STATUS_STORAGE_KEY))[CONFIG_STATUS_STORAGE_KEY] as { settings?: { browser_module?: unknown } } | undefined;
  return status?.settings?.browser_module === true;
}

export type BrowserModuleDeps = {
  session: SessionStorage;
  // Whether the setting is on (`module_setting_on`).
  is_on: () => Promise<boolean>;
  read_disabled: () => Promise<boolean>;
  read_keymap: () => Promise<CompiledKeymap | undefined>;
  read_tab_records: () => Promise<Record<string, TabModeRecord>>;
  check_args: CheckCommandArgs;
  // The allow list of each direction. The protocol's lists are empty now, so a test passes its own.
  kinds?: { from_module: KindTable; from_extension: KindTable };
  // One handler per kind the module may request. Handlers run outside the queue, so one may await `send`, and its reply is written when it settles. The text it gives is the reply's `value`, within its kind's limit. A handler that throws gives an error reply when the kind expects one. A push may run twice after a background restart, because its id leaves no trace here, so a handler is idempotent.
  handlers: Record<string, (args: ModuleArgs) => Promise<string | void>>;
  // Hears each reply the module sends to a request of the extension.
  on_reply?: (reply: ModuleReply) => void;
  now: () => number;
  // Runs `run` once after `ms`.
  later: (run: () => void, ms: number) => void;
};

export function create_browser_module(deps: BrowserModuleDeps) {
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(step: () => Promise<T>): Promise<T> => {
    const run = queue.then(step);
    queue = keep_chain(run);
    return run;
  };

  // A limiter runs `task` at most once per `gap` ms, in the queue. It is marked pending at once when a read is asked for, so a burst joins the read that is already waiting, and that read takes the latest values. The gap is checked when the read runs.
  // The hello waits a second. The message list waits only a short gap, so a call the module starts, or a held key that starts one, is not slowed by the hello's limit.
  const limited = (gap: number, task: () => Promise<void>): (() => void) => {
    let last = Number.NEGATIVE_INFINITY;
    let pending = false;
    const run = async (): Promise<void> => {
      const wait = last + gap - deps.now();
      if (wait > 0) return void deps.later(() => void enqueue(run), wait);
      pending = false;
      last = deps.now();
      await task();
    };
    return () => {
      if (pending) return;
      pending = true;
      void enqueue(run);
    };
  };

  const read_state = async (): Promise<ModuleState | undefined> => {
    const checked = validate_module_state((await deps.session.get(BROWSER_MODULE_STATE_STORAGE_KEY))[BROWSER_MODULE_STATE_STORAGE_KEY]);
    return checked.ok ? checked.value : undefined;
  };

  // A state that fails its own validator is never written: the module would refuse it anyway.
  const write_state = async (state: ModuleState): Promise<void> => {
    if (validate_module_state(state).ok) await deps.session.set({ [BROWSER_MODULE_STATE_STORAGE_KEY]: state });
  };

  const kinds = deps.kinds ?? { from_module: MODULE_TO_EXTENSION_KINDS, from_extension: EXTENSION_TO_MODULE_KINDS };
  // Ids of messages of the module that were handled, kept to skip them when the module rewrites its list. A copy: the replies in the extension's own list say the same for the requests that expect one.
  const handled = new Set<string>();
  let sent = 0;

  const read_outbox = async (): Promise<ModuleMessage[]> => {
    const list = validate_message_list((await deps.session.get(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY))[BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY] ?? [], kinds.from_extension);
    return list.ok ? list.value.messages : [];
  };

  // The newest messages that fit both caps. The list is rewritten whole, and a message that falls off the front is one the module has had time to read.
  const write_outbox = async (messages: ModuleMessage[]): Promise<void> => {
    let kept = messages.slice(-MAX_MESSAGES);
    while (kept.length > 0 && new TextEncoder().encode(JSON.stringify(kept)).length > message_list_bytes(kinds.from_extension)) kept = kept.slice(1);
    if (validate_message_list(kept, kinds.from_extension).ok) await deps.session.set({ [BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY]: kept });
  };

  const run_request = async (request: ModuleRequest): Promise<ModuleReply | undefined> => {
    const row = kinds.from_module[request.kind]!;
    const reply = (ok: boolean, error?: string, value?: string): ModuleReply | undefined =>
      row.reply ? { v: BROWSER_MODULE_PROTOCOL_VERSION, reply_to: request.id, ok, ...(error === undefined ? {} : { error }), ...(typeof value === "string" ? { value } : {}) } : undefined;
    const handler = deps.handlers[request.kind];
    if (handler === undefined) return reply(false, "no handler for this kind");
    try {
      const answered = reply(true, undefined, (await handler(request.args)) ?? undefined);
      return answered === undefined || reply_fits(answered, row) ? answered : reply(false, "the answer is too large");
    } catch {
      return reply(false, "the request failed");
    }
  };

  // Handles each message of the module list that is new. Refusals go out in one rewrite of the extension's list, and each handler's reply when it settles.
  const answer_module_messages = async (): Promise<void> => {
    const checked = validate_message_list((await deps.session.get(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY))[BROWSER_MODULE_FROM_MODULE_STORAGE_KEY], kinds.from_module);
    if (!checked.ok) return;
    const outbox = await read_outbox();
    const answered = new Set(outbox.flatMap((message) => ("reply_to" in message ? [message.reply_to] : [])));
    const seen = (id: string) => handled.has(id) || answered.has(id);
    const replies: ModuleMessage[] = [];
    for (const message of checked.value.messages) {
      if ("reply_to" in message) {
        if (!handled.has(`reply:${message.reply_to}`)) deps.on_reply?.(message);
        handled.add(`reply:${message.reply_to}`);
      } else if (!seen(message.id)) {
        handled.add(message.id);
        void run_request(message)
          .then((reply) => reply && enqueue(async () => write_outbox([...(await read_outbox()), reply])))
          .catch(warn_and_go("browser_module.reply"));
      }
    }
    for (const { id, error } of checked.value.refused) {
      if (seen(id)) continue;
      handled.add(id);
      replies.push({ v: BROWSER_MODULE_PROTOCOL_VERSION, reply_to: id, ok: false, error });
    }
    // A bounded memory: the oldest ids go first.
    for (const id of handled) if (handled.size > 4 * MAX_MESSAGES) handled.delete(id);
    if (replies.length > 0) await write_outbox([...outbox, ...replies]);
  };

  const read_hello_status = async (): Promise<void> => {
    if (!(await deps.is_on())) return;
    await deps.session.set({ [BROWSER_MODULE_STATUS_STORAGE_KEY]: status_of_hello((await deps.session.get(BROWSER_MODULE_HELLO_STORAGE_KEY))[BROWSER_MODULE_HELLO_STORAGE_KEY]) });
  };

  const read_messages = async (): Promise<void> => {
    if (await deps.is_on()) await answer_module_messages();
  };

  const request_hello_read = limited(HELLO_MIN_INTERVAL_MS, read_hello_status);
  const request_messages_read = limited(MESSAGE_MIN_GAP_MS, read_messages);

  const sync_now = async (): Promise<void> => {
    if (!(await deps.is_on())) {
      await deps.session.remove([BROWSER_MODULE_STATE_STORAGE_KEY, BROWSER_MODULE_STATUS_STORAGE_KEY, BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY]);
      return;
    }
    const disabled = await deps.read_disabled();
    const records = await deps.read_tab_records();
    const tabs: Record<string, TabState> = {};
    for (const [key, record] of Object.entries(records)) {
      const id = tab_id_of_key(key);
      if (id !== undefined && Object.keys(tabs).length < MAX_STATE_TABS) tabs[id] = tab_state_of(record);
    }
    await write_state({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: !disabled, keys: disabled ? [] : key_rows_of(await deps.read_keymap(), deps.check_args), tabs });
    request_hello_read();
    request_messages_read();
  };

  const tab_changed_now = async (tab_id: string, record: TabModeRecord | undefined): Promise<void> => {
    if (!(await deps.is_on())) return;
    const state = await read_state();
    // No state yet: a full sync is on its way or the setting just turned off.
    if (state === undefined) return;
    const tabs = { ...state.tabs };
    if (record === undefined) delete tabs[tab_id];
    else if (tab_id in tabs || Object.keys(tabs).length < MAX_STATE_TABS) tabs[tab_id] = tab_state_of(record);
    await write_state({ ...state, tabs });
  };

  // The extension starts a call. The kind must be on the extension's allow list and the args must pass its check. Nothing is written while the setting is off. The id comes back so a caller can match the reply.
  const send_now = async (kind: string, args: ModuleArgs): Promise<{ ok: true; id: string } | { ok: false; problem: string }> => {
    if (!(await deps.is_on())) return { ok: false, problem: "the browser module setting is off" };
    const request = { v: BROWSER_MODULE_PROTOCOL_VERSION, id: `x${deps.now().toString(36)}-${sent++}`, kind, args };
    const checked = validate_message(request, kinds.from_extension);
    if (!checked.ok) return checked;
    await write_outbox([...(await read_outbox()), checked.value]);
    return { ok: true, id: request.id };
  };

  const sync = (): Promise<void> => enqueue(sync_now);
  const tab_changed = (tab_id: string, record: TabModeRecord | undefined): Promise<void> => enqueue(() => tab_changed_now(tab_id, record));

  return {
    // Run at each background start, and after anything that changes the setting, the keymap or the switch.
    sync,
    tab_changed,
    send: (kind: string, args: ModuleArgs = {}) => enqueue(() => send_now(kind, args)),
    // Ask for a read. Each has its own limiter, which decides when it runs.
    read_hello: request_hello_read,
    read_messages: request_messages_read,
    // The one `storage.onChanged` listener.
    storage_changed(changes: Record<string, { newValue?: unknown }>, area: string): void {
      if (area === "session") {
        if (BROWSER_MODULE_HELLO_STORAGE_KEY in changes) request_hello_read();
        if (BROWSER_MODULE_FROM_MODULE_STORAGE_KEY in changes) request_messages_read();
        return;
      }
      if (area !== "local") return;
      // A change of the setting alone leaves the compiled keymap as it is, so the settings status counts too.
      if (COMPILED_KEYMAP_STORAGE_KEY in changes || DISABLED_STORAGE_KEY in changes || touches_settings(changes, area)) void sync();
      for (const [key, change] of Object.entries(changes)) {
        const id = tab_id_of_key(key);
        if (id !== undefined) void tab_changed(id, change.newValue as TabModeRecord | undefined);
      }
    },
  };
}
