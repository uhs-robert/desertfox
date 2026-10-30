// The one entry for run requests: content scripts, Firefox shortcuts and later callers.

import type { CheckedArgs, CommandContext, CommandDef, ContextSourceName, Mode } from "../shared/command.ts";
import type { Invocation } from "../shared/invocation.ts";
import type { BackgroundToContent, Refusal, RunResponse } from "../shared/messages.ts";
import { check_args } from "../shared/registry/check_args.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";
import { is_context_source } from "../shared/registry/params.ts";
import { apply_count } from "./count.ts";

export type ActiveTab = { tab_id: number; window_id: number; url: string | undefined };

export type RouterDeps = {
  get_command: (command_id: string) => CommandDef | undefined;
  get_enum_sources: () => Promise<EnumSources>;
  active_tab: () => Promise<ActiveTab | undefined>;
  has_content_script: (tab_id: number) => Promise<boolean>;
  // Undefined when the content script cannot answer.
  ask_selection: (tab_id: number) => Promise<string | undefined>;
  read_clipboard: () => Promise<string>;
  has_permission: (permission: string) => Promise<boolean>;
  send_to_tab: (tab_id: number, message: BackgroundToContent) => Promise<unknown>;
  show_refusal: (tab_id: number | undefined, refusal: Refusal) => Promise<unknown>;
};

export type RouteRequest = {
  invocations: Invocation[];
  mode: Mode;
  // The tab the caller says it came from. The active tab wins when there is one.
  sender_tab_id?: number;
  frame_id?: number;
};

export type Router = { run: (request: RouteRequest) => Promise<RunResponse> };

type Outcome = { ok: true } | { ok: false; message: string };

const done: Outcome = { ok: true };
const refuse = (message: string): Outcome => ({ ok: false, message });

export function create_router(deps: RouterDeps): Router {
  async function run(request: RouteRequest): Promise<RunResponse> {
    const active = await deps.active_tab();
    const tab_id = active?.tab_id ?? request.sender_tab_id;
    const context: CommandContext = {
      tab_id,
      window_id: active?.window_id,
      frame_id: request.frame_id ?? 0,
      mode: request.mode,
    };

    for (const invocation of request.invocations) {
      const outcome = await run_one(invocation, context, active).catch((error: unknown) => refuse(error instanceof Error ? error.message : String(error)));
      if (outcome.ok) continue;
      const refusal: Refusal = { id: invocation.id, message: outcome.message };
      await deps.show_refusal(tab_id, refusal);
      return { ok: false, refusal };
    }
    return { ok: true };
  }

  async function run_one(invocation: Invocation, context: CommandContext, active: ActiveTab | undefined): Promise<Outcome> {
    const command = deps.get_command(invocation.id);
    if (!command) return refuse(`unknown command "${invocation.id}"`);

    const missing_need = await first_unmet_need(command, context.tab_id);
    if (missing_need) return refuse(`${command.label} needs ${missing_need}`);

    const counted = apply_count(command, invocation);
    const checked = check_args(command, counted.args, await deps.get_enum_sources());
    if (!checked.ok) {
      return refuse(checked.missing_param === undefined ? checked.error : `${command.label} needs the command line (phase 2)`);
    }

    const filled = await fill_context_sources(checked.args, context.tab_id, active);
    if (!filled.ok) return filled;

    if (command.runs_in === "content") return run_in_content(command, filled.args, counted.times, context.tab_id);
    for (let time = 0; time < counted.times; time++) await command.run(context, filled.args);
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

  async function run_in_content(command: CommandDef, args: CheckedArgs, times: number, tab_id: number | undefined): Promise<Outcome> {
    if (tab_id === undefined) return refuse(`${command.label} needs a tab`);
    const invocations = Array.from({ length: times }, () => ({ id: command.id, args }));
    try {
      await deps.send_to_tab(tab_id, { type: "run_in_content", invocations });
      return done;
    } catch {
      return refuse(`${command.label} needs a page OasisFox runs on`);
    }
  }

  async function fill_context_sources(
    args: CheckedArgs,
    tab_id: number | undefined,
    active: ActiveTab | undefined,
  ): Promise<{ ok: true; args: CheckedArgs } | { ok: false; message: string }> {
    const filled: CheckedArgs = {};
    for (const [name, value] of Object.entries(args)) {
      if (!is_context_source(value)) {
        filled[name] = value;
        continue;
      }
      const text = await read_source(value.from, tab_id, active);
      if (text === undefined) return { ok: false, message: `${name}: ${value.from} is not available here` };
      filled[name] = text;
    }
    return { ok: true, args: filled };
  }

  async function read_source(source: ContextSourceName, tab_id: number | undefined, active: ActiveTab | undefined) {
    if (source === "current_url") return active?.url;
    if (source === "clipboard") return deps.read_clipboard();
    const selection = tab_id === undefined ? undefined : await deps.ask_selection(tab_id);
    return selection === "" ? undefined : selection;
  }

  return { run };
}
