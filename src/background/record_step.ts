// The one place a finished step is recorded. The router calls it for background commands and for a replay, the page calls it
// (through `page_steps`) for a leaf of content commands. Later recorders read the same call.

import type { CommandDef } from "../shared/command.ts";
import type { CheckedArgs } from "../shared/command.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import type { Outcome } from "../shared/messages.ts";
import { check_args, type EnumSources } from "../shared/registry/check_args.ts";
import { as_stored, type RepeatMemory } from "./repeat_memory.ts";
import { warn_and_go } from "../shared/swallow.ts";

export type StepOrigin = {
  is_private: boolean;
  // The request filled a param from the command line. The typed command stores itself when it runs.
  prompted?: boolean;
  // A hint pick that opens a link. `.` shows hints again and does not reopen the address.
  skip_repeat?: boolean;
  // The page sent this step when a hint pick began. A macro keeps its `hint.run` only from here, because the leaf that ends later repeats the same step.
  from_pick?: boolean;
};

// `failed_step` is the index of the step that failed or was cancelled, so a recorder that takes every step can stop there. The page does not know it.
export type StepOutcome = Outcome & { failed_step?: number };

export type RecordStep = (steps: readonly BoundInvocation[], outcome: StepOutcome, origin: StepOrigin) => Promise<void>;

// Whether `.` and a macro may run this step again.
export function can_repeat(command: CommandDef | undefined, step: Pick<BoundInvocation, "args">): boolean {
  const rule = command?.repeatable;
  return typeof rule === "function" ? rule((step.args ?? {}) as CheckedArgs) : rule !== false;
}

export type StepRecorderDeps = {
  get_command: (id: string) => CommandDef | undefined;
  repeat_memory: RepeatMemory;
};

// `steps` are the steps of one request or leaf, which `.` replays together. Called for every outcome, so a recorder that takes failed steps sees them.
export function create_step_recorder(deps: StepRecorderDeps): RecordStep {
  return async function record_step(steps, outcome, origin) {
    if (!outcome.ok || outcome.cancelled || origin.prompted || origin.skip_repeat) return;
    const repeatable = steps.filter((step) => can_repeat(deps.get_command(step.id), step));
    if (repeatable.length === 0) return;
    await deps.repeat_memory.save(repeatable.map(as_stored), origin.is_private).catch(warn_and_go("deps.repeat_memory.save"));
  };
}

// A leaf holds a few keys' worth of commands. The cap stops a page from filling the slot.
const MAX_PAGE_STEPS = 16;

const is_plain_object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// What a page script may record: content commands with checked args. The page already sends `run` messages, so this adds no reach, but the slot must hold only what the router would accept.
// One bad step rejects the whole leaf.
export function page_steps(message: unknown, get_command: (id: string) => CommandDef | undefined, sources: EnumSources): BoundInvocation[] | undefined {
  const list = (message as { invocations?: unknown } | undefined)?.invocations;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_PAGE_STEPS) return undefined;
  const steps: BoundInvocation[] = [];
  for (const item of list as { id?: unknown; args?: unknown; count?: unknown }[]) {
    const command = typeof item?.id === "string" ? get_command(item.id) : undefined;
    if (command?.runs_in !== "content") return undefined;
    if (item.args !== undefined && !is_plain_object(item.args)) return undefined;
    if (item.count !== undefined && !(Number.isInteger(item.count) && (item.count as number) > 0)) return undefined;
    const checked = check_args(command, item.args as Record<string, unknown> | undefined, sources);
    if (!checked.ok) return undefined;
    steps.push({ id: command.id, args: checked.args as CheckedArgs, ...(item.count === undefined ? {} : { count: item.count as number }) });
  }
  return steps;
}

// The page's word on how its leaf ended. Anything but a plain success is a failure, which no recorder keeps in the slot.
export function page_outcome(message: unknown): Outcome {
  const outcome = (message as { outcome?: { ok?: unknown; cancelled?: unknown } } | undefined)?.outcome;
  if (outcome?.ok !== true) return { ok: false, message: "failed" };
  return outcome.cancelled === true ? { ok: true, cancelled: true } : { ok: true };
}
