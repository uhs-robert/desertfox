// The one entry for run requests: content scripts, Firefox shortcuts and later callers.

import type { CheckedArgs, CommandContext, CommandDef, ContextSource, ContextSourceName, Mode } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import type { BackgroundToContent, Outcome, Refusal, RunResponse } from "../shared/messages.ts";
import { check_args } from "../shared/registry/check_args.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";
import { is_context_source } from "../shared/registry/params.ts";
import { print_command } from "../shared/registry/print_command.ts";
import { apply_count } from "./count.ts";
import type { RepeatMemory } from "./repeat_memory.ts";
import { create_step_recorder, type RecordStep } from "./record_step.ts";
import type { JumpEntry } from "../shared/jump_names.ts";
import { mark_page_url } from "../shared/mark_names.ts";

export type ActiveTab = { tab_id: number; window_id: number; url: string | undefined; incognito?: boolean };

export type RouterDeps = {
  get_command: (command_id: string) => CommandDef | undefined;
  get_enum_sources: () => Promise<EnumSources>;
  active_tab: () => Promise<ActiveTab | undefined>;
  // Undefined when the tab is gone.
  get_tab: (tab_id: number) => Promise<ActiveTab | undefined>;
  has_content_script: (tab_id: number) => Promise<boolean>;
  // Undefined when the content script cannot answer.
  ask_selection: (tab_id: number, frame_id: number) => Promise<string | undefined>;
  // True when the command runs with the param empty on this tab, so an empty selection runs it instead of opening the command line.
  runs_with_empty: (command_id: string, args: CheckedArgs, param: string, context: CommandContext) => Promise<boolean>;
  read_clipboard: () => Promise<string>;
  // The scroll offset of the top frame's page, read through the `page` bundle (loaded on first use), with the address of the page that answered. Undefined when the page cannot answer.
  read_offset: (tab_id: number) => Promise<PageOffset | undefined>;
  // Puts a place in the jump list of the window. Rejects for an address the list refuses.
  record_jump: (window_id: number, is_private: boolean, entry: JumpEntry) => Promise<unknown>;
  // The title of the bookmark at this address, undefined when there is none.
  bookmark_title: (url: string | undefined) => Promise<string | undefined>;
  // The query of the search results page at this address, undefined when it is no engine's results page.
  search_query: (url: string | undefined) => Promise<string | undefined>;
  has_permission: (permission: string) => Promise<boolean>;
  send_to_tab: (tab_id: number, message: BackgroundToContent, frame_id?: number) => Promise<unknown>;
  // Opens the command line in the frame with the text typed in. Rejects when the tab has no content script.
  open_cmdline: (tab_id: number, frame_id: number, text: string) => Promise<unknown>;
  show_refusal: (tab_id: number | undefined, refusal: Refusal, frame_id?: number) => Promise<unknown>;
  // True while the user has DesertFox turned off.
  is_disabled: () => Promise<boolean>;
  // What `.` replays. A nested snippet router gets a no-op, so only the outermost request counts.
  repeat_memory: RepeatMemory;
  // Replaces the `.` recorder, for a caller that records every step.
  record_step?: RecordStep;
  // Gets the time one background command took from the start of its step to its answer, for `debug.perf`.
  record_timing?: (command_id: string, ms: number) => void;
};

export type RouteRequest = {
  invocations: BoundInvocation[];
  mode: Mode;
  // The tab the caller says it came from. The first step runs there while it exists. Later steps follow the active tab.
  sender_tab_id?: number;
  frame_id?: number;
  // Set by keys and Firefox shortcuts: a missing value opens the command line. A snippet's `desertfox.run` leaves it
  // unset and gets the validation failure instead, because nobody is there to type.
  may_prompt?: boolean;
  // The request runs but does not replace what `.` repeats.
  skip_repeat?: boolean;
  // Set by a macro replay: page steps run as a held key's repeats do, so a scroll jumps and a mark after it saves where it ended.
  instant?: boolean;
  // Asked when a content step gets no reply because the page unloaded. True means the step did its work and the page left, so it is done.
  lost_reply_is_done?: () => Promise<boolean>;
  // Set by a macro replay: the step's number, which a refusal for a missing page names.
  macro_step?: number;
};

export type Router = { run: (request: RouteRequest) => Promise<RunResponse> };

type Now = { active: ActiveTab | undefined; context: CommandContext };

const done: Outcome = { ok: true };
const cancelled: Outcome = { ok: true, cancelled: true };
const refuse = (message: string): Outcome => ({ ok: false, message });
const NO_PAGE = "a page DesertFox runs on";
// A page that does not answer the offset read must not hold the command: it runs and records nothing.
export const JUMP_READ_TIMEOUT_MS = 1000;

export type PageOffset = { x: number; y: number; url: string };

// The place the top page of a tab on `tab_url` stands, or nothing when the read fails or takes longer than `JUMP_READ_TIMEOUT_MS`.
// The read can load `page.js`, and a page that loaded in the tab meanwhile answers for itself, not for `tab_url`, so that answer is nothing too.
export async function read_place_in_time(read: Promise<PageOffset | undefined>, tab_url: string): Promise<JumpEntry | undefined> {
  let timer: number | undefined;
  const waited = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, JUMP_READ_TIMEOUT_MS);
  });
  const offset = await Promise.race([read.catch(() => undefined), waited]).finally(() => clearTimeout(timer));
  return offset && place_in_tab(offset, tab_url);
}

export const url_origin = (url: string): string => new URL(url).origin;

// The place `offset` names, when its address matches the tab's under `address_of`: by default the same page.
export function place_in_tab(offset: PageOffset, tab_url: string, address_of: (url: string) => string = mark_page_url): JumpEntry | undefined {
  return address_of(offset.url) === address_of(tab_url) ? { url: mark_page_url(offset.url), x: offset.x, y: offset.y } : undefined;
}

// What a content script answers to a request that waits on the user. No answer is done: an older script answers nothing.
function outcome_of_reply(reply: unknown): Outcome {
  const outcome = reply as Outcome | undefined;
  const is_outcome = typeof outcome === "object" && (outcome?.ok === true || (outcome?.ok === false && typeof outcome.message === "string"));
  return is_outcome ? outcome : done;
}

// The refusal text when the count prefix is over the command's `repeat_limit`.
// A prompt step that may prompt opens the line and drops its count, so it is never over.
function over_repeat_limit(command: CommandDef | undefined, invocation: BoundInvocation, may_prompt: boolean | undefined): string | undefined {
  const limit = command?.repeat_limit;
  if (limit === undefined || (invocation.prompt && may_prompt) || invocation.count === undefined || invocation.count <= limit) return undefined;
  return `A count of ${invocation.count} is over the limit of ${limit} for ${invocation.id}`;
}

export function create_router(deps: RouterDeps): Router {
  const record_step = deps.record_step ?? create_step_recorder(deps);

  // Read at run time: an earlier step or repeat can change which tab is active. The first step is pinned to the sender, because
  // the active tab can change between the key press and this read. A sender that is gone falls back to the active tab.
  async function read_now(request: RouteRequest, pin_to_sender: boolean): Promise<Now> {
    const sender = pin_to_sender && request.sender_tab_id !== undefined ? await deps.get_tab(request.sender_tab_id).catch(() => undefined) : undefined;
    const active = sender ?? (await deps.active_tab());
    const tab_id = active?.tab_id ?? request.sender_tab_id;
    // The sender frame exists only in the sender tab. Another tab gets its top frame.
    const same_tab = tab_id !== undefined && tab_id === request.sender_tab_id;
    const frame_id = same_tab ? (request.frame_id ?? 0) : 0;
    const context: CommandContext = { tab_id, window_id: active?.window_id, frame_id, mode: request.mode };
    return { active, context };
  }

  async function run(request: RouteRequest): Promise<RunResponse> {
    // Keys stop in the page, so this catches what does not come from a key: a slot chord, a snippet call, a line that was open.
    if (await deps.is_disabled()) return { ok: false, refusal: { id: "desertfox.off", message: "DesertFox is off" } };
    // Read before any step: window.new, window.close and tab.attach change which tab is active.
    const is_private = (await read_now(request, true)).active?.incognito === true;
    const prompted = new Set<BoundInvocation>();
    const fail_at = async (index: number, message: string): Promise<RunResponse> => {
      await record_step(request.invocations, { ok: false, message, failed_step: index }, { is_private });
      const refusal: Refusal = { id: request.invocations[index]!.id, message };
      const { context } = await read_now(request, index === 0);
      await deps.show_refusal(context.tab_id, refusal, context.frame_id);
      return { ok: false, refusal };
    };
    // Over every step before the first runs, so a sequence never runs half.
    for (const [index, invocation] of request.invocations.entries()) {
      const over = over_repeat_limit(deps.get_command(invocation.id), invocation, request.may_prompt);
      if (over) return fail_at(index, over);
    }
    for (const [index, invocation] of request.invocations.entries()) {
      const is_first = index === 0;
      const outcome = await run_one(invocation, request, prompted, is_first).catch((error: unknown) => refuse(error instanceof Error ? error.message : String(error)));
      // The user left a waiting step: the rest of the sequence does not run, and nothing is repeated.
      if (outcome.ok && outcome.cancelled) {
        await record_step(request.invocations, { ...outcome, failed_step: index }, { is_private });
        return { ok: true, cancelled: true };
      }
      if (outcome.ok) continue;
      return fail_at(index, outcome.message);
    }
    // Before the reply, so a `.` typed next finds the slot written.
    await record_step(request.invocations, done, { is_private, prompted: prompted.size > 0, skip_repeat: request.skip_repeat === true });
    return { ok: true };
  }

  async function run_one(invocation: BoundInvocation, request: RouteRequest, prompted: Set<BoundInvocation>, is_first: boolean): Promise<Outcome> {
    // Before the tab read, permission checks and validation, so a slow preflight shows in the time.
    const started_ms = performance.now();
    const { active, context } = await read_now(request, is_first);
    const command = deps.get_command(invocation.id);
    if (!command) return refuse(`unknown command "${invocation.id}"`);

    const missing_need = await first_unmet_need(command, context.tab_id);
    if (missing_need) return refuse(needs_message(command, missing_need, request));

    const open = (args: Record<string, unknown>, param: string, prefill?: ContextSource) => {
      prompted.add(invocation);
      return open_line(command, args, param, context, active, prefill);
    };
    // A count before a key that opens the line is dropped.
    const sources = await deps.get_enum_sources();
    if (invocation.prompt && request.may_prompt) {
      // The fixed args must be good. Only the prompted param may be left out.
      const fixed = check_args(command, invocation.args, sources);
      if (!fixed.ok && fixed.missing_param === undefined) return refuse(fixed.error);
      return open(invocation.args ?? {}, invocation.prompt.param, invocation.prompt.prefill);
    }

    const counted = apply_count(command, invocation);
    const checked = check_args(command, counted.args, sources);
    if (!checked.ok) {
      // A key that takes its number from the count (`50%`) was pressed with none.
      return refuse(typeof command.count === "object" && checked.missing_param === command.count.param ? "Type a number first" : checked.error);
    }

    const filled = await fill_context_sources(command.id, checked.args, context, active, request.may_prompt === true);
    if (!filled.ok) {
      return filled.empty_selection_param === undefined || !request.may_prompt ? filled : open(counted.args ?? {}, filled.empty_selection_param, filled.prefill);
    }

    // A source passed the check above as a marker. Its text is checked now, by the same validator. An empty text keeps its marker, because an empty selection or clipboard is a runtime matter that the handler reports.
    const expanded = Object.fromEntries(Object.entries(filled.args).map(([name, value]) => [name, value === "" && is_context_source(checked.args[name]) ? checked.args[name] : value]));
    const rechecked = check_args(command, expanded, sources);
    if (!rechecked.ok) return refuse(rechecked.error);
    // The handler gets the rechecked args, with a kept marker back as its empty text.
    const final_args = Object.fromEntries(Object.entries(rechecked.args).map(([name, value]) => [name, is_context_source(value) ? filled.args[name] : value]));

    // The read finishes before the command starts, because the command moves the view.
    const left = await read_place_left(command, final_args, context, active);
    const outcome = await run_command(command, final_args, counted.times, context, request);
    // Only background commands are timed. A content command can wait on the user (hint mode, find, caret, visual), the registry cannot say which, and the wait would read as a slow command.
    // Not `debug.perf`, which would time itself into the numbers it reports. A refusal or a throw is not a round trip.
    if (command.runs_in === "background" && outcome.ok && command.id !== "debug.perf") deps.record_timing?.(command.id, performance.now() - started_ms);
    // A refused or cancelled command moved nothing.
    if (left && outcome.ok && !outcome.cancelled) await deps.record_jump(left.window_id, left.is_private, left.entry).catch(() => undefined);
    return outcome;
  }

  async function run_command(command: CommandDef, args: CheckedArgs, times: number, context: CommandContext, request: RouteRequest): Promise<Outcome> {
    if (command.runs_in === "content") return run_in_content(command, args, times, context, request);
    for (let time = 0; time < times; time++) {
      const result = outcome_of_reply(await command.run!(time === 0 ? context : (await read_now(request, false)).context, args));
      if (!result.ok) return result;
    }
    return done;
  }

  // Where a command that moves the view starts. Only commands that say `jumps` pay for the read. A child frame's own offset has no entry in the list, so a command there records nothing.
  async function read_place_left(command: CommandDef, args: CheckedArgs, context: CommandContext, active: ActiveTab | undefined) {
    const moves_view = typeof command.jumps === "function" ? command.jumps(args) : command.jumps === true;
    if (!moves_view || !active?.url || active.window_id < 0 || (context.frame_id ?? 0) !== 0 || context.tab_id !== active.tab_id) return undefined;
    const entry = await read_place_in_time(deps.read_offset(active.tab_id), active.url);
    return entry && { window_id: active.window_id, is_private: active.incognito === true, entry };
  }

  // A replay step names its number, because the user did not type the step.
  const needs_message = (command: CommandDef, need: string, request: RouteRequest) => (request.macro_step === undefined ? `${command.label} needs ${need}` : `Macro stopped at step ${request.macro_step}: needs ${need}`);

  async function first_unmet_need(command: CommandDef, tab_id: number | undefined): Promise<string | undefined> {
    for (const need of command.needs ?? []) {
      if (need === "content") {
        if (tab_id === undefined || !(await deps.has_content_script(tab_id))) return NO_PAGE;
      } else if (!(await deps.has_permission(need))) {
        return `the "${need}" permission`;
      }
    }
    return undefined;
  }

  async function run_in_content(command: CommandDef, args: CheckedArgs, times: number, context: CommandContext, request: RouteRequest): Promise<Outcome> {
    const { tab_id, frame_id } = context;
    if (tab_id === undefined) return refuse(`${command.label} needs a tab`);
    const invocations = Array.from({ length: times }, () => ({ id: command.id, args, ...(command.bundle && { bundle: command.bundle }) }));
    try {
      return outcome_of_reply(await deps.send_to_tab(tab_id, { type: "run_in_content", invocations, ...(request.instant && { repeat: true as const }) }, frame_id));
    } catch {
      if (await request.lost_reply_is_done?.().catch(() => false)) return done;
      return refuse(needs_message(command, NO_PAGE, request));
    }
  }

  // Types the command into the command line and waits until the user submits or leaves it. A source that has nothing to give prefills empty, because the
  // user can still type the value.
  async function open_line(
    command: CommandDef,
    args: Record<string, unknown>,
    open_param: string,
    context: CommandContext,
    active: ActiveTab | undefined,
    prefill?: ContextSource,
  ): Promise<Outcome> {
    const typed: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(args)) {
      typed[name] = is_context_source(value) ? await read_chain(value, context, active).catch(() => undefined) : value;
    }
    // The line opens when the key is pressed, because focus moves into the iframe and the selection with it.
    if (prefill) typed[open_param] = await read_chain(prefill, context, active).catch(() => undefined);
    const { tab_id, frame_id } = context;
    if (tab_id === undefined) return refuse(`${command.label} needs a tab`);
    // A reply lost after the line opened means the page went away, as when Enter opens a link in this tab. Navigation cancels the wait,
    // so the rest of the sequence does not run against a page that is still loading, and no refusal shows.
    const had_page = await deps.has_content_script(tab_id);
    try {
      return outcome_of_reply(await deps.open_cmdline(tab_id, frame_id ?? 0, print_command(command, typed, { open_param, sources: await deps.get_enum_sources() })));
    } catch {
      return had_page ? cancelled : refuse(`${command.label} needs a page DesertFox runs on`);
    }
  }

  async function fill_context_sources(
    command_id: string,
    args: CheckedArgs,
    context: CommandContext,
    active: ActiveTab | undefined,
    may_prompt: boolean,
  ): Promise<{ ok: true; args: CheckedArgs } | { ok: false; message: string; empty_selection_param?: string; prefill?: ContextSource }> {
    const filled: CheckedArgs = {};
    for (const [name, value] of Object.entries(args)) {
      if (!is_context_source(value)) {
        filled[name] = value;
        continue;
      }
      const first = await read_source(value.from, context, active);
      if (first === undefined && value.from === "selection" && (await deps.runs_with_empty(command_id, args, name, context))) {
        filled[name] = "";
        continue;
      }
      const text = first ?? (value.then === undefined ? undefined : await read_source(value.then, context, active));
      // The page's query stands in for an empty selection. With someone to type, the line opens with it typed in, so the key never searches at once.
      if (first === undefined && text !== undefined && value.from === "selection" && may_prompt) {
        return { ok: false, message: `${name}: nothing selected`, empty_selection_param: name, prefill: { from: value.then! } };
      }
      if (text === undefined) {
        const message = `${name}: ${value.from} is not available here`;
        return value.from === "selection" ? { ok: false, message, empty_selection_param: name } : { ok: false, message };
      }
      filled[name] = text;
    }
    return { ok: true, args: filled };
  }

  // The first source with a value: `from`, else `then`.
  async function read_chain(source: ContextSource, context: CommandContext, active: ActiveTab | undefined) {
    return (await read_source(source.from, context, active)) ?? (source.then === undefined ? undefined : read_source(source.then, context, active));
  }

  async function read_source(source: ContextSourceName, context: CommandContext, active: ActiveTab | undefined) {
    if (source === "current_url") return active?.url;
    if (source === "clipboard") return deps.read_clipboard();
    if (source === "bookmark_title") return deps.bookmark_title(active?.url);
    if (source === "search_query") return deps.search_query(active?.url);
    const selection = context.tab_id === undefined ? undefined : await deps.ask_selection(context.tab_id, context.frame_id ?? 0);
    return selection === "" ? undefined : selection;
  }

  return { run };
}
