// The extension side of the browser module channel (`src/shared/browser_module_protocol.ts`). While the `browser_module` setting is on, it keeps the module's state in `storage.session`:
// the toolbar switch, the single-key bindings and the locked-page key tree the module may run, and per tab the mode and whether DesertFox is live there. It also reads the module's hello and records what became of it.
// Everything here is a copy rebuilt from stored data (the keymap, the disabled flag, the tab mode records), so a background restart loses nothing. An extension reload empties `storage.session`, and the module then claims nothing until the start writes the state again.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch, TreeNode } from "../shared/prefix_tree.ts";
import type { CommandMeta } from "../shared/command.ts";
import { panel_after_prefix } from "./list_keys.ts";
import { CONFIG_STATUS_STORAGE_KEY, DISABLED_STORAGE_KEY, TAB_MODE_STORAGE_PREFIX } from "../shared/config/storage_keys.ts";
import type { BarConfig, BarFields, BarToast, KeyRow, KindTable, SidebarKeyRow, ModuleArgs, ModuleMessage, ModuleReply, ModuleRequest, ModuleState, ModuleStatus, ScopeTree, TabState, WhichKeyTable, WhichKeyTablePanel } from "../shared/browser_module_protocol.ts";
import {
  BROWSER_MODULE_HELLO_STORAGE_KEY,
  BROWSER_MODULE_PROTOCOL_VERSION,
  BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY,
  BROWSER_MODULE_FROM_MODULE_STORAGE_KEY,
  BROWSER_MODULE_STATE_STORAGE_KEY,
  BROWSER_MODULE_STATUS_STORAGE_KEY,
  bar_config_of,
  bar_fields_of,
  bar_theme_of,
  DEVTOOLS_HINT_KEY,
  DEVTOOLS_TREE_KEYS,
  DEVTOOLS_VISUAL_KEY,
  DEVTOOLS_VISUAL_KEYS,
  validate_module_hello,
  HELLO_MIN_INTERVAL_MS,
  MESSAGE_MIN_GAP_MS,
  is_sidebar_command_id,
  CHROME_HINT_COMMAND_ID,
  chrome_hint_keys_of,
  MAX_CHROME_HINT_BINDINGS,
  MAX_CHROME_HINT_KEY_TOKENS,
  MAX_SIDEBAR_KEY_TOKENS,
  sidebar_keys_of,
  MAX_KEY_ROWS,
  MAX_STATE_TABS,
  MAX_TOAST_CHARS,
  status_of_hello,
  EXTENSION_TO_MODULE_KINDS,
  message_list_bytes,
  reply_fits,
  MAX_MESSAGES,
  MODULE_TO_EXTENSION_KINDS,
  validate_message,
  validate_message_list,
  validate_module_state,
  validate_scope_tree,
  MAX_KEY_CHARS,
  MAX_WHICH_KEY_BYTES,
  MAX_WHICH_KEY_DELAY_MS,
  MAX_WHICH_KEY_LABEL_CHARS,
  MAX_WHICH_KEY_PANELS,
  MAX_WHICH_KEY_ROWS,
  MAX_WHICH_KEY_SKIP,
  MAX_WHICH_KEY_TITLE_PARTS,
  which_key_table_of,
} from "../shared/browser_module_protocol.ts";
import { DEFAULT_SETTINGS, DEFAULT_TOAST_ERROR_MS, DEFAULT_TOAST_MS } from "../shared/default_settings.ts";
import type { ToastKind } from "../shared/messages/tab.ts";
import { native_leaf, scope_tree_of } from "../shared/browser_module_scope.ts";
import type { CheckCommandArgs } from "../shared/browser_module_scope.ts";
import { THEME_STORAGE_KEY } from "../shared/theme/apply.ts";
import { is_reply } from "../shared/browser_module_protocol.ts";
import { touches_settings } from "../shared/storage_watch.ts";
import { keep_chain, warn_and_go } from "../shared/swallow.ts";
import { mode_of_record } from "./tab_modes.ts";
import type { TabModeRecord } from "./tab_modes.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export type { CheckCommandArgs } from "../shared/browser_module_scope.ts";

// A leaf the module may run: one step, no guard, no key to wait for, and a command from the protocol's list whose args the registry accepts. Anything else stays with the content script.
function row_of(key: string, node: TreeNode, check_args: CheckCommandArgs): KeyRow | undefined {
  const native = node.kind === "leaf" ? native_leaf(node, check_args) : undefined;
  return native && { key, id: native.native, args: native.args };
}

// The single-key normal bindings the module may run, in key order. The scope tree beside them holds sequences and counts, for a module that reads it.
export function key_rows_of(keymap: CompiledKeymap | undefined, check_args: CheckCommandArgs): KeyRow[] {
  const children = keymap?.modes.normal?.children ?? {};
  const rows = Object.entries(children).flatMap(([key, node]) => row_of(key, node, check_args) ?? []);
  return rows.sort((a, b) => (a.key < b.key ? -1 : 1)).slice(0, MAX_KEY_ROWS);
}

// The sidebar mode's keys of one or two tokens (`gg`) whose leaf runs one sidebar command, in key order. The rest of the mode stays out: the module runs nothing else there.
export function sidebar_rows_of(keymap: CompiledKeymap | undefined, check_args: CheckCommandArgs): SidebarKeyRow[] {
  const sidebar_tree = (keymap?.modes as Record<string, TreeNode | undefined> | undefined)?.sidebar;
  const rows: SidebarKeyRow[] = [];
  const walk = (node: TreeNode | undefined, keys: string[]): void => {
    if (node === undefined) return;
    if (node.kind === "branch") {
      if (keys.length < MAX_SIDEBAR_KEY_TOKENS) for (const [key, child] of Object.entries(node.children)) walk(child, [...keys, key]);
      return;
    }
    if (keys.length === 0 || node.steps.length !== 1 || node.when_focus !== undefined || node.when_present !== undefined || node.otherwise !== undefined || node.otherwise_page !== undefined) return;
    const { invocation, capture, register } = node.steps[0]!;
    if (capture === undefined && register === undefined && invocation.prompt === undefined && is_sidebar_command_id(invocation.id) && check_args(invocation.id, invocation.args)) rows.push({ keys, id: invocation.id });
  };
  walk(sidebar_tree, []);
  const sorted = rows.sort((a, b) => (a.keys.join(" ") < b.keys.join(" ") ? -1 : 1)).slice(0, MAX_KEY_ROWS);
  return sidebar_keys_of(sorted) ?? [];
}

// The normal-mode bindings that run `hint.browser` alone, as key token lists in key order. The module takes them with the focus in Firefox's own dialogs and windows, where no content script hears them.
export function chrome_hint_keys_of_keymap(keymap: CompiledKeymap | undefined): string[][] {
  const bindings: string[][] = [];
  const walk = (node: TreeNode | undefined, keys: string[]): void => {
    if (node === undefined) return;
    if (node.kind === "branch") {
      if (keys.length < MAX_CHROME_HINT_KEY_TOKENS) for (const [key, child] of Object.entries(node.children)) walk(child, [...keys, key]);
      return;
    }
    if (keys.length === 0 || node.steps.length !== 1 || node.when_focus !== undefined || node.when_present !== undefined || node.otherwise !== undefined || node.otherwise_page !== undefined) return;
    const { invocation, capture, register } = node.steps[0]!;
    if (capture === undefined && register === undefined && invocation.prompt === undefined && invocation.id === CHROME_HINT_COMMAND_ID) bindings.push(keys);
  };
  walk(keymap?.modes.normal, []);
  const sorted = bindings.sort((a, b) => (a.join(" ") < b.join(" ") ? -1 : 1)).slice(0, MAX_CHROME_HINT_BINDINGS);
  return chrome_hint_keys_of(sorted) ?? [];
}

// The compiled branch cut to the keys of the scope tree, so the panels list only what the module runs on a locked page, with the labels and group names of the full tree.
function branch_in_scope(branch: TreeBranch, scope: ScopeTree): TreeBranch {
  const children: Record<string, TreeNode> = {};
  for (const [token, child] of Object.entries(branch.children)) {
    const kept = Object.hasOwn(scope.children, token) ? scope.children[token] : undefined;
    if (kept === undefined) continue;
    const scoped_branch = typeof kept === "object" && "children" in kept ? kept : undefined;
    if (child.kind === "leaf" && !scoped_branch) children[token] = child;
    else if (child.kind === "branch" && scoped_branch) children[token] = branch_in_scope(child, scoped_branch);
  }
  return { ...branch, children };
}

const shown_text = (text: string, max_chars: number): string => text.replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, max_chars);

// The which-key table for the module (`WhichKeyTable`): one panel per branch path of the scope tree, from the rows the page's panel shows. Undefined when which-key is off or the table is over a limit.
export function which_key_table_of_keymap(keymap: CompiledKeymap | undefined, tree: ScopeTree, find_command: (id: string) => CommandMeta | undefined): WhichKeyTable | undefined {
  const normal = current_keymap(keymap)?.modes.normal;
  const delay_ms = Math.min(Math.round(keymap?.which_key_delay_ms ?? 0), MAX_WHICH_KEY_DELAY_MS);
  if (!normal || !(delay_ms > 0)) return undefined;
  const border = keymap?.which_key_border ?? "square";
  const shown = branch_in_scope(normal, tree);
  const panels: Record<string, WhichKeyTablePanel> = {};
  const add_panels = (branch: TreeBranch, path: string[]): void => {
    for (const [token, child] of Object.entries(branch.children)) {
      if (child.kind !== "branch" || token === "") continue;
      const keys = [...path, token];
      const panel = panel_after_prefix(shown, keys, find_command, border);
      const rows = panel.rows.slice(0, MAX_WHICH_KEY_ROWS).map(({ keys: row_keys, command, more }) => ({ keys: shown_text(row_keys, MAX_KEY_CHARS), command: shown_text(command, MAX_WHICH_KEY_LABEL_CHARS), ...(more && { more: true as const }) }));
      if (rows.length > 0) panels[keys.join(" ")] = { title: panel.title.slice(-MAX_WHICH_KEY_TITLE_PARTS).map((part) => shown_text(part, MAX_WHICH_KEY_LABEL_CHARS)), rows };
      add_panels(child, keys);
    }
  };
  add_panels(shown, []);
  const skip = keymap?.which_key_skip?.slice(0, MAX_WHICH_KEY_SKIP);
  const table = { delay_ms, ...(skip && skip.length > 0 && { skip }), border, panels };
  const checked = which_key_table_of(table);
  if (!checked) console.warn(`DesertFox: the which-key panels of locked pages were left out, because they are over the limit of ${MAX_WHICH_KEY_PANELS} panels or ${MAX_WHICH_KEY_BYTES} bytes`);
  return checked;
}

export const tab_state_of = (record: TabModeRecord): TabState => ({ mode: mode_of_record(record), live: record.live === true });

// The tab id of a tab mode key, or undefined for the manual insert hold key that shares the prefix.
export const tab_id_of_key = (key: string): string | undefined => (key.startsWith(TAB_MODE_STORAGE_PREFIX) && /^\d{1,10}$/.test(key.slice(TAB_MODE_STORAGE_PREFIX.length)) ? key.slice(TAB_MODE_STORAGE_PREFIX.length) : undefined);

// Whether a boolean setting is on in the stored config status, which holds the settings in force. The status is written in the same `set` as the change event that asks, while `get_config` updates after it.
export async function stored_setting_on(storage: Pick<typeof browser.storage.local, "get">, name: "browser_module" | "blur_on_load"): Promise<boolean> {
  const status = (await storage.get(CONFIG_STATUS_STORAGE_KEY))[CONFIG_STATUS_STORAGE_KEY] as { settings?: Record<string, unknown> } | undefined;
  return status?.settings?.[name] === true;
}
export const module_setting_on = (storage: Pick<typeof browser.storage.local, "get">): Promise<boolean> => stored_setting_on(storage, "browser_module");

// The bar settings in the stored config status, or undefined while `browser_bar` is off. A value the status lacks or the protocol refuses reads as the default.
export async function read_bar_config(storage: Pick<typeof browser.storage.local, "get">): Promise<BarConfig | undefined> {
  const status = (await storage.get(CONFIG_STATUS_STORAGE_KEY))[CONFIG_STATUS_STORAGE_KEY] as { settings?: Record<string, unknown> } | undefined;
  const settings = status?.settings ?? {};
  if (settings.browser_bar === false) return undefined;
  return bar_config_of({ left: settings.browser_bar_left, right: settings.browser_bar_right, border: settings.browser_bar_border }) ?? { left: [...DEFAULT_SETTINGS.browser_bar_left], right: [...DEFAULT_SETTINGS.browser_bar_right], border: DEFAULT_SETTINGS.browser_bar_border };
}

export type BrowserModuleDeps = {
  session: SessionStorage;
  // Whether the setting is on (`module_setting_on`).
  is_on: () => Promise<boolean>;
  read_disabled: () => Promise<boolean>;
  // The global `blur_on_load`. Locked pages match no site rule, so the global value is the one in force there.
  read_blur_on_load?: () => Promise<boolean>;
  read_keymap: () => Promise<CompiledKeymap | undefined>;
  read_tab_records: () => Promise<Record<string, TabModeRecord>>;
  check_args: CheckCommandArgs;
  // The commands a locked page runs (`locked_page_command_ids`). With them the state carries the scope tree, so the module takes key sequences and counts too.
  locked_commands?: ReadonlySet<string>;
  // The registry's lookup, for the labels of the which-key table. Without it the state has no table.
  find_command?: (id: string) => CommandMeta | undefined;
  // The status bar's inputs. Without them the bar counts as off.
  // The bar settings, or undefined while `browser_bar` is off.
  read_bar_config?: () => Promise<BarConfig | undefined>;
  // The stored theme, `{ dark, light }` role colors.
  read_theme?: () => Promise<unknown>;
  // The bar appeared or went away, so the pages must ask for their keymap again (the corner badge hides while the bar shows).
  on_bar_change?: () => void;
  // The allow list of each direction. A test passes its own.
  kinds?: { from_module: KindTable; from_extension: KindTable };
  // One handler per kind the module may request. Handlers run outside the queue and at the same time, so one may await `send`. Each reply is written when its handler settles, so replies can land in any order, and the module matches each to its request by `reply_to`. The text it gives is the reply's `value`, within its kind's limit. A handler that throws gives an error reply when the kind expects one. A push may run twice after a background restart, because its id leaves no trace here, so a handler is idempotent.
  handlers: Record<string, (args: ModuleArgs) => Promise<string | void>>;
  // Hears each change of the status the settings page shows: `undefined` when the setting turns off, else the result of the last hello check.
  on_status?: (status: ModuleStatus | undefined) => void;
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

  // What each tab last reported for the bar, in memory only: the pending keys of a private tab must not reach the disk, and a restart empties them.
  const bars = new Map<string, BarFields>();
  // The pending keys and count of the child frame that holds a tab's focus. While one is set it stands in for the top frame's own, which the tab's entry in `bars` may still hold.
  const child_keys = new Map<string, Pick<BarFields, "pending" | "count">>();
  // The keys each child frame of a tab last reported, kept when the top frame's report ends the child's own entry. The focus coming back to the frame shows them again.
  const frame_keys = new Map<string, Map<number, Pick<BarFields, "pending" | "count">>>();
  // Whether the bar is up: the settings are on and the module said in its hello that it built the bar. Pages ask on their first key, so they get this copy and no storage read.
  let bar_seen = false;
  // The message each tab shows in the bar, in memory only like `bars`. The module hides it at `until`, and a tab entry drops it once `until` has passed.
  const toasts = new Map<string, BarToast>();
  let toast_count = 0;
  // What the last hello said, kept so that a sync needs no hello read: the hello has its own limiter.
  let hello_bar = false;
  // The module keeps the DevTools key table in memory only, so each new hello gets it again.
  let devtools_keys_sent = false;
  // Counts each reset of `devtools_keys_sent`, so a send that a newer hello overtook does not mark the newer hello as served.
  let hello_generation = 0;

  // Each row past the tree keys goes only to a module whose hello names its feature, since an older module refuses a table with an action it does not know.
  // The visual table goes first, so the module knows the mode's keys before `v` can start it.
  const send_devtools_tables = async (stored_hello: unknown): Promise<boolean> => {
    const hello = validate_module_hello(stored_hello);
    const flags = hello.ok ? hello.value : undefined;
    if (flags?.devtools_visual === true && !(await send_now("devtools.visual_keys", { keys: DEVTOOLS_VISUAL_KEYS })).ok) return false;
    const keys = [...DEVTOOLS_TREE_KEYS, ...(flags?.devtools_hints === true ? [DEVTOOLS_HINT_KEY] : []), ...(flags?.devtools_visual === true ? [DEVTOOLS_VISUAL_KEY] : [])];
    return (await send_now("devtools.keys", { keys })).ok;
  };
  const bar_built = (stored_hello: unknown): boolean => {
    const hello = validate_module_hello(stored_hello);
    return hello.ok && hello.value.v === BROWSER_MODULE_PROTOCOL_VERSION && hello.value.bar === true;
  };
  // A change of the answer tells the pages to ask again. The bar going away also drops what the tabs reported, which would otherwise show again, stale, when the bar returns.
  const set_bar_seen = (now: boolean): boolean => {
    if (now === bar_seen) return false;
    bar_seen = now;
    if (!now) {
      bars.clear();
      toasts.clear();
      child_keys.clear();
      frame_keys.clear();
    }
    deps.on_bar_change?.();
    return true;
  };

  // The tabs whose record says a load began and no page has taken over yet.
  const loading = new Set<string>();
  const live_toast = (id: string): BarToast | undefined => {
    const toast = toasts.get(id);
    if (toast && toast.until <= deps.now()) toasts.delete(id);
    return toasts.get(id);
  };
  // A load hides the page's own fields but not the toast, which the page never reported.
  const tab_with_bar = (id: string, tab: TabState | undefined): TabState => {
    const toast = live_toast(id);
    const base = { mode: tab?.mode ?? "normal", live: tab?.live ?? false, ...(toast && { toast }) };
    if (loading.has(id)) return base;
    const { pending: _, count: __, ...top } = bars.get(id) ?? {};
    return { ...base, ...(child_keys.has(id) ? { ...top, ...child_keys.get(id) } : bars.get(id)) };
  };
  // A tab that began a load shows no bar fields, from a record change or from a report. A load that leaves the old page in place brings them back at its end, because the page's own report is kept and its content script has nothing new to send.
  const tab_of_record = (id: string, record: TabModeRecord): TabState => {
    if (record.awaiting_commit) loading.add(id);
    else loading.delete(id);
    return tab_with_bar(id, tab_state_of(record));
  };

  const kinds = deps.kinds ?? { from_module: MODULE_TO_EXTENSION_KINDS, from_extension: EXTENSION_TO_MODULE_KINDS };
  // Ids of messages of the module that were handled, kept to skip them when the module rewrites its list. A copy: the replies in the extension's own list say the same for the requests that expect one.
  const handled = new Set<string>();
  // Ids of requests whose handler has not settled. Kept apart from `handled`, whose oldest ids drop, so a rewrite never starts a running request again.
  const running = new Set<string>();
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
    const checked = validate_message_list((await deps.session.get(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY))[BROWSER_MODULE_FROM_MODULE_STORAGE_KEY], kinds.from_module, deps.now());
    if (!checked.ok) return;
    const outbox = await read_outbox();
    const answered = new Set(outbox.flatMap((message) => ("reply_to" in message ? [message.reply_to] : [])));
    const seen = (id: string) => handled.has(id) || running.has(id) || answered.has(id);
    const replies: ModuleMessage[] = [];
    for (const message of checked.value.messages) {
      if ("reply_to" in message) {
        if (!handled.has(`reply:${message.reply_to}`)) deps.on_reply?.(message);
        handled.add(`reply:${message.reply_to}`);
      } else if (!seen(message.id)) {
        handled.add(message.id);
        running.add(message.id);
        void run_request(message)
          .finally(() => running.delete(message.id))
          // A reply that settles after the setting went off is dropped: the off sync removed the list, and the reply can hold page text.
          .then((reply) => reply && enqueue(async () => (await deps.is_on()) && write_outbox([...(await read_outbox()), reply])))
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
    const generation = hello_generation;
    const hello = (await deps.session.get(BROWSER_MODULE_HELLO_STORAGE_KEY))[BROWSER_MODULE_HELLO_STORAGE_KEY];
    const status = status_of_hello(hello);
    await deps.session.set({ [BROWSER_MODULE_STATUS_STORAGE_KEY]: status });
    deps.on_status?.(status);
    if (status.result === "matched" && !devtools_keys_sent) {
      const sent = await send_devtools_tables(hello);
      if (generation === hello_generation) devtools_keys_sent = sent;
    }
    // The rewrite takes the dropped reports out of the state too.
    hello_bar = bar_built(hello);
    if (set_bar_seen(!!(await deps.read_bar_config?.()) && hello_bar)) await sync_now();
  };

  const read_messages = async (): Promise<void> => {
    if (await deps.is_on()) await answer_module_messages();
  };

  const request_hello_read = limited(HELLO_MIN_INTERVAL_MS, read_hello_status);
  const request_messages_read = limited(MESSAGE_MIN_GAP_MS, read_messages);

  const sync_now = async (): Promise<void> => {
    if (!(await deps.is_on())) {
      hello_bar = false;
      devtools_keys_sent = false;
      hello_generation++;
      set_bar_seen(false);
      await deps.session.remove([BROWSER_MODULE_STATE_STORAGE_KEY, BROWSER_MODULE_STATUS_STORAGE_KEY, BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY]);
      deps.on_status?.(undefined);
      return;
    }
    const bar = await deps.read_bar_config?.();
    set_bar_seen(!!bar && hello_bar);
    const disabled = await deps.read_disabled();
    const records = await deps.read_tab_records();
    const tabs: Record<string, TabState> = {};
    for (const [key, record] of Object.entries(records)) {
      const id = tab_id_of_key(key);
      if (id !== undefined && Object.keys(tabs).length < MAX_STATE_TABS) tabs[id] = tab_of_record(id, record);
    }
    const bar_theme = bar_theme_of(await deps.read_theme?.());
    const blur_on_load = (await deps.read_blur_on_load?.()) === true;
    const keymap = disabled ? undefined : await deps.read_keymap();
    // A tree over its cap is left out, and the module falls back to the single keys, which stay.
    const tree = keymap && deps.locked_commands && scope_tree_of(keymap, deps.locked_commands, deps.check_args);
    const fits = tree && validate_scope_tree(tree).ok;
    const which_key = fits && deps.find_command ? which_key_table_of_keymap(keymap, tree, deps.find_command) : undefined;
    const sidebar_keys = sidebar_rows_of(keymap, deps.check_args);
    const chrome_hint_keys = chrome_hint_keys_of_keymap(keymap);
    await write_state({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: !disabled, keys: key_rows_of(keymap, deps.check_args), tabs, ...(sidebar_keys.length > 0 && { sidebar_keys }), ...(chrome_hint_keys.length > 0 && { chrome_hint_keys }), ...(bar_theme && { bar_theme }), ...(bar && { bar }), ...(blur_on_load ? { blur_on_load } : {}), ...(fits && { tree }), page_hints: true, ...(which_key && { which_key }) });
    request_hello_read();
    request_messages_read();
  };

  const tab_changed_now = async (tab_id: string, record: TabModeRecord | undefined): Promise<void> => {
    if (!(await deps.is_on())) return;
    const state = await read_state();
    // No state yet: a full sync is on its way or the setting just turned off.
    if (state === undefined) return;
    const tabs = { ...state.tabs };
    // A tab that closed, or whose new page took over, has nothing half-typed any more.
    if (record === undefined) (bars.delete(tab_id), toasts.delete(tab_id), child_keys.delete(tab_id), frame_keys.delete(tab_id), loading.delete(tab_id));
    if (record === undefined) delete tabs[tab_id];
    else if (tab_id in tabs || Object.keys(tabs).length < MAX_STATE_TABS) tabs[tab_id] = tab_of_record(tab_id, record);
    await write_state({ ...state, tabs });
  };

  // A content frame reports what the bar shows. The top frame's report replaces the tab's entry and ends the child's keys, unless it is marked `child`: then a child frame holds the focus, the report has no keys of its own, and the child's keys stay. A child frame says only what it has half-typed. `site` never reaches a private tab.
  const bar_report_now = async (tab_id: string, frame_id: number, incognito: boolean, raw: Record<string, unknown>): Promise<void> => {
    // A report in flight when the bar went away must not fill the maps again.
    if (!bar_seen) return;
    const { site, pending, count, ...rest } = bar_fields_of(raw);
    const before = JSON.stringify([bars.get(tab_id), child_keys.get(tab_id)]);
    if (frame_id !== 0) {
      const keys = { ...(pending && { pending }), ...(count && { count }) };
      set_child_keys(tab_id, keys);
      const frames = frame_keys.get(tab_id) ?? new Map();
      if (Object.keys(keys).length === 0) frames.delete(frame_id);
      else frames.set(frame_id, keys);
      frame_keys.set(tab_id, frames);
    } else {
      if (raw.child !== true) child_keys.delete(tab_id);
      const own = raw.child === true ? {} : { ...(pending && { pending }), ...(count && { count }) };
      const top: BarFields = { ...own, ...rest, ...(!incognito && site !== undefined && { site }) };
      if (Object.keys(top).length === 0) bars.delete(tab_id);
      else bars.set(tab_id, top);
    }
    await publish_bar(tab_id, before);
  };

  const set_child_keys = (tab_id: string, keys: Pick<BarFields, "pending" | "count">): void => {
    if (Object.keys(keys).length === 0) child_keys.delete(tab_id);
    else child_keys.set(tab_id, keys);
  };

  // Writes the tab's entry when the bar fields differ from `before`.
  const publish_bar = async (tab_id: string, before: string): Promise<void> => {
    if (JSON.stringify([bars.get(tab_id), child_keys.get(tab_id)]) === before) return;
    const state = await read_state();
    if (state === undefined || !(await deps.is_on())) return;
    if (!(tab_id in state.tabs) && Object.keys(state.tabs).length >= MAX_STATE_TABS) return;
    await write_state({ ...state, tabs: { ...state.tabs, [tab_id]: tab_with_bar(tab_id, { mode: state.tabs[tab_id]?.mode ?? "normal", live: state.tabs[tab_id]?.live ?? false }) } });
  };

  // Puts a message in the bar's slot of the tab. Gives false when the bar is not up, the tab is private and the extension may not run there, or the state has no room, so the caller falls back to a notification.
  const toast_now = async (tab_id: string, text: string, kind: ToastKind): Promise<boolean> => {
    if (!bar_seen) return false;
    const state = await read_state();
    if (state === undefined || !(await deps.is_on())) return false;
    if (!(tab_id in state.tabs) && Object.keys(state.tabs).length >= MAX_STATE_TABS) return false;
    const keymap = await deps.read_keymap();
    const ms = (kind === "error" ? keymap?.toast_error_ms : keymap?.toast_ms) || (kind === "error" ? DEFAULT_TOAST_ERROR_MS : DEFAULT_TOAST_MS);
    // One line: a message with a line break or a control character would draw as a gap or not at all.
    const line = text.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim().slice(0, MAX_TOAST_CHARS);
    if (line === "") return false;
    toasts.set(tab_id, { id: toast_count++, text: line, kind, until: deps.now() + ms });
    await write_state({ ...state, tabs: { ...state.tabs, [tab_id]: tab_with_bar(tab_id, state.tabs[tab_id]) } });
    return true;
  };

  // A child frame took the focus: its own half-typed keys, which the top frame's report may have dropped, show again. The frame's mode report says it, so it sends no second one.
  const bar_focus_now = async (tab_id: string, frame_id: number): Promise<void> => {
    if (!bar_seen || frame_id === 0) return;
    const before = JSON.stringify([bars.get(tab_id), child_keys.get(tab_id)]);
    set_child_keys(tab_id, frame_keys.get(tab_id)?.get(frame_id) ?? {});
    await publish_bar(tab_id, before);
  };

  // The extension starts a call. The kind must be on the extension's allow list and the args must pass its check. Nothing is written while the setting is off. The id comes back so a caller can match the reply.
  // `on_id` hears the id before the request is written, so a caller can wait for its reply before the module can answer. It returns false to take the request back unwritten, for a caller whose reason to send went away while the send waited its turn.
  const send_now = async (kind: string, args: ModuleArgs, on_id?: (id: string) => boolean | void): Promise<{ ok: true; id: string } | { ok: false; problem: string }> => {
    if (!(await deps.is_on())) return { ok: false, problem: "the browser module setting is off" };
    const request = { v: BROWSER_MODULE_PROTOCOL_VERSION, id: `x${deps.now().toString(36)}-${sent++}`, kind, args, sent_at: deps.now() };
    const checked = validate_message(request, kinds.from_extension);
    if (!checked.ok) return checked;
    if (on_id?.(request.id) === false) return { ok: false, problem: "the caller took the request back" };
    await write_outbox([...(await read_outbox()), checked.value]);
    return { ok: true, id: request.id };
  };

  // Takes a request back out of the list the module reads, so a module that wakes up later does not run a call the user already saw refused. Nothing is written when the request is not there.
  const withdraw_now = async (id: string): Promise<void> => {
    const outbox = await read_outbox();
    if (outbox.some((message) => !is_reply(message) && message.id === id)) await write_outbox(outbox.filter((message) => is_reply(message) || message.id !== id));
  };

  const sync = (): Promise<void> => enqueue(sync_now);
  const tab_changed = (tab_id: string, record: TabModeRecord | undefined): Promise<void> => enqueue(() => tab_changed_now(tab_id, record));

  return {
    // Run at each background start, and after anything that changes the setting, the keymap or the switch.
    sync,
    tab_changed,
    bar_report: (tab_id: number, frame_id: number, incognito: boolean, raw: Record<string, unknown>) => enqueue(() => bar_report_now(String(tab_id), frame_id, incognito, raw)),
    bar_focus: (tab_id: number, frame_id: number) => enqueue(() => bar_focus_now(String(tab_id), frame_id)),
    bar_active: (): Promise<boolean> => Promise.resolve(bar_seen),
    // `allow_private` is whether the extension may run in private windows, the same gate the module's bar has.
    show_toast: (tab_id: number, is_private: boolean, allow_private: boolean, text: string, kind: ToastKind) => (is_private && !allow_private ? Promise.resolve(false) : enqueue(() => toast_now(String(tab_id), text, kind))),
    send: (kind: string, args: ModuleArgs = {}, on_id?: (id: string) => boolean | void) => enqueue(() => send_now(kind, args, on_id)),
    withdraw: (id: string) => enqueue(() => withdraw_now(id)),
    // Ask for a read. Each has its own limiter, which decides when it runs.
    read_hello: request_hello_read,
    read_messages: request_messages_read,
    // The one `storage.onChanged` listener.
    storage_changed(changes: Record<string, { newValue?: unknown }>, area: string): void {
      if (area === "session") {
        if (BROWSER_MODULE_HELLO_STORAGE_KEY in changes) {
          devtools_keys_sent = false;
          hello_generation++;
          request_hello_read();
        }
        if (BROWSER_MODULE_FROM_MODULE_STORAGE_KEY in changes) request_messages_read();
        return;
      }
      if (area !== "local") return;
      // A change of the setting alone leaves the compiled keymap as it is, so the settings status counts too.
      if (COMPILED_KEYMAP_STORAGE_KEY in changes || THEME_STORAGE_KEY in changes || DISABLED_STORAGE_KEY in changes || touches_settings(changes, area)) void sync();
      for (const [key, change] of Object.entries(changes)) {
        const id = tab_id_of_key(key);
        if (id !== undefined) void tab_changed(id, change.newValue as TabModeRecord | undefined);
      }
    },
  };
}
