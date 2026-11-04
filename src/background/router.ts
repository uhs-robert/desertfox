// The one entry for run requests: content scripts, Firefox shortcuts and later callers.

import type { CheckedArgs, CommandContext, CommandDef, ContextSource, ContextSourceName, Mode } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import type { BackgroundToContent, Outcome, Refusal, RunResponse } from "../shared/messages.ts";
import { check_args } from "../shared/registry/check_args.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";
import { is_context_source } from "../shared/registry/params.ts";
import { print_command } from "../shared/registry/print_command.ts";
import { apply_count } from "./count.ts";
import { as_stored, type RepeatMemory } from "./repeat_memory.ts";

export type ActiveTab = { tab_id: number; window_id: number; url: string | undefined; incognito?: boolean };

export type RouterDeps = {
  get_command: (command_id: string) => CommandDef | undefined;
  get_enum_sources: () => Promise<EnumSources>;
  active_tab: () => Promise<ActiveTab | undefined>;
  has_content_script: (tab_id: number) => Promise<boolean>;
  // Undefined when the content script cannot answer.
  ask_selection: (tab_id: number, frame_id: number) => Promise<string | undefined>;
  // True when the command runs with the param empty on this tab, so an empty selection runs it instead of opening the command line.
  runs_with_empty: (command_id: string, args: CheckedArgs, param: string, context: CommandContext) => Promise<boolean>;
  read_clipboard: () => Promise<string>;
  has_permission: (permission: string) => Promise<boolean>;
  send_to_tab: (tab_id: number, message: BackgroundToContent, frame_id?: number) => Promise<unknown>;
  // Opens the command line in the frame with the text typed in. Rejects when the tab has no content script.
  open_cmdline: (tab_id: number, frame_id: number, text: string) => Promise<unknown>;
  show_refusal: (tab_id: number | undefined, refusal: Refusal, frame_id?: number) => Promise<unknown>;
  // What `.` replays. A nested snippet router gets a no-op, so only the outermost request counts.
  repeat_memory: RepeatMemory;
};

export type RouteRequest = {
  invocations: BoundInvocation[];
  mode: Mode;
  // The tab the caller says it came from. The active tab wins when there is one.
  sender_tab_id?: number;
  frame_id?: number;
  // Set by keys and Firefox shortcuts: a missing value opens the command line. A snippet's `oasisfox.run` leaves it
  // unset and gets the validation failure instead, because nobody is there to type.
  may_prompt?: boolean;
  // The request runs but does not replace what `.` repeats.
  skip_repeat?: boolean;
};

export type Router = { run: (request: RouteRequest) => Promise<RunResponse> };

type Now = { active: ActiveTab | undefined; context: CommandContext };

const done: Outcome = { ok: true };
const refuse = (message: string): Outcome => ({ ok: false, message });

// What a content script answers to a request that waits on the user. No answer is done: an older script answers nothing.
function outcome_of_reply(reply: unknown): Outcome {
  const outcome = reply as Outcome | undefined;
  return outcome && typeof outcome === "object" && (outcome.ok === false ? typeof outcome.message === "string" : true) ? outcome : done;
}

export function create_router(deps: RouterDeps): Router {
  // Read at run time: an earlier step or repeat can change which tab is active.
  async function read_now(request: RouteRequest): Promise<Now> {
    const active = await deps.active_tab();
    const tab_id = active?.tab_id ?? request.sender_tab_id;
    // The sender frame exists only in the sender tab. Another tab gets its top frame.
    const same_tab = tab_id !== undefined && tab_id === request.sender_tab_id;
    const frame_id = same_tab ? (request.frame_id ?? 0) : 0;
    const context: CommandContext = { tab_id, window_id: active?.window_id, frame_id, mode: request.mode };
    return { active, context };
  }

  async function run(request: RouteRequest): Promise<RunResponse> {
    // Read before any step: window.new, window.close and tab.attach change which tab is active.
    const is_private = (await read_now(request)).active?.incognito === true;
    const prompted = new Set<BoundInvocation>();
    for (const invocation of request.invocations) {
      const outcome = await run_one(invocation, request, prompted).catch((error: unknown) => refuse(error instanceof Error ? error.message : String(error)));
      // The user left a waiting step: the rest of the sequence does not run, and nothing is repeated.
      if (outcome.ok && outcome.cancelled) return { ok: true, cancelled: true };
      if (outcome.ok) continue;
      const refusal: Refusal = { id: invocation.id, message: outcome.message };
      const { context } = await read_now(request);
      await deps.show_refusal(context.tab_id, refusal, context.frame_id);
      return { ok: false, refusal };
    }
    // A line the user filled in stores itself when it runs, and this request still holds the missing param.
    if (prompted.size === 0) await remember(request, is_private);
    return { ok: true };
  }

  // Only a request that ran to the end counts. Content commands do not repeat here: the hint start records itself.
  async function remember(request: RouteRequest, is_private: boolean): Promise<void> {
    if (request.skip_repeat) return;
    const repeatable = request.invocations.filter((invocation) => {
      const command = deps.get_command(invocation.id);
      return command?.runs_in === "background" && command.repeatable !== false;
    });
    if (repeatable.length === 0) return;
    await deps.repeat_memory.save(repeatable.map(as_stored), is_private).catch(() => undefined);
  }

  async function run_one(invocation: BoundInvocation, request: RouteRequest, prompted: Set<BoundInvocation>): Promise<Outcome> {
    const { active, context } = await read_now(request);
    const command = deps.get_command(invocation.id);
    if (!command) return refuse(`unknown command "${invocation.id}"`);

    const missing_need = await first_unmet_need(command, context.tab_id);
    if (missing_need) return refuse(`${command.label} needs ${missing_need}`);

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
      if (checked.missing_param === undefined || !request.may_prompt) return refuse(checked.error);
      return open(counted.args ?? {}, checked.missing_param);
    }

    const filled = await fill_context_sources(command.id, checked.args, context, active);
    if (!filled.ok) {
      return filled.empty_selection_param === undefined || !request.may_prompt ? filled : open(counted.args ?? {}, filled.empty_selection_param);
    }

    if (command.runs_in === "content") return run_in_content(command, filled.args, counted.times, context);
    for (let time = 0; time < counted.times; time++) {
      await command.run(time === 0 ? context : (await read_now(request)).context, filled.args);
    }
    return done;
  }

  async function first_unmet_need(command: CommandDef, tab_id: number | undefined): Promise<string | undefined> {
    for (const need of command.needs ?? []) {
      if (need === "content") {
        if (tab_id === undefined || !(await deps.has_content_script(tab_id))) return "a page OasisFox runs on";
      } else if (!(await deps.has_permission(need))) {
        return `the "${need}" permission`;
      }
    }
    return undefined;
  }

  async function run_in_content(command: CommandDef, args: CheckedArgs, times: number, context: CommandContext): Promise<Outcome> {
    const { tab_id, frame_id } = context;
    if (tab_id === undefined) return refuse(`${command.label} needs a tab`);
    const invocations = Array.from({ length: times }, () => ({ id: command.id, args }));
    try {
      return outcome_of_reply(await deps.send_to_tab(tab_id, { type: "run_in_content", invocations }, frame_id));
    } catch {
      return refuse(`${command.label} needs a page OasisFox runs on`);
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
      typed[name] = is_context_source(value) ? await read_source(value.from, context, active).catch(() => undefined) : value;
    }
    // The line opens when the key is pressed, because focus moves into the iframe and the selection with it.
    if (prefill) typed[open_param] = await read_source(prefill.from, context, active).catch(() => undefined);
    const { tab_id, frame_id } = context;
    if (tab_id === undefined) return refuse(`${command.label} needs a tab`);
    try {
      return outcome_of_reply(await deps.open_cmdline(tab_id, frame_id ?? 0, print_command(command, typed, { open_param, sources: await deps.get_enum_sources() })));
    } catch {
      return refuse(`${command.label} needs a page OasisFox runs on`);
    }
  }

  async function fill_context_sources(
    command_id: string,
    args: CheckedArgs,
    context: CommandContext,
    active: ActiveTab | undefined,
  ): Promise<{ ok: true; args: CheckedArgs } | { ok: false; message: string; empty_selection_param?: string }> {
    const filled: CheckedArgs = {};
    for (const [name, value] of Object.entries(args)) {
      if (!is_context_source(value)) {
        filled[name] = value;
        continue;
      }
      const text = await read_source(value.from, context, active);
      if (text === undefined && value.from === "selection" && (await deps.runs_with_empty(command_id, args, name, context))) {
        filled[name] = "";
        continue;
      }
      if (text === undefined) {
        const message = `${name}: ${value.from} is not available here`;
        return value.from === "selection" ? { ok: false, message, empty_selection_param: name } : { ok: false, message };
      }
      filled[name] = text;
    }
    return { ok: true, args: filled };
  }

  async function read_source(source: ContextSourceName, context: CommandContext, active: ActiveTab | undefined) {
    if (source === "current_url") return active?.url;
    if (source === "clipboard") return deps.read_clipboard();
    const selection = context.tab_id === undefined ? undefined : await deps.ask_selection(context.tab_id, context.frame_id ?? 0);
    return selection === "" ? undefined : selection;
  }

  return { run };
}
