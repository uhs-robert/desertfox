import type { ContentToBackground, Mode, Outcome, RunResponse, TreeLeaf } from "../shared/index.ts";
import { counted_invocations } from "./run_content.ts";

// A leaf with a background step goes to the router whole: it reads the active tab at each step, so a step after tab.next runs in the new tab.
// A leaf of content steps runs here and shows its own failure.
// Positional arguments, not a deps object: a test passes fakes the same way, and the bundle carries no object of unmangled keys.
export async function run_leaf(
  { steps }: TreeLeaf,
  count: number | undefined,
  repeat: boolean,
  send: (message: ContentToBackground) => Promise<RunResponse>,
  get_mode: () => Mode,
  run_steps: (steps: TreeLeaf["steps"], count: number | undefined, repeat: boolean) => Promise<Outcome>,
  show_toast: (message: string) => void,
): Promise<void> {
  const invocations = counted_invocations(steps, count);
  if (steps.some((step) => step.runs_in === "background" || (step.jump && !repeat))) {
    // The background shows a refusal itself.
    await send({ type: "run", invocations, mode: get_mode(), repeat });
    return;
  }
  const outcome = await run_steps(steps, count, repeat);
  if (!outcome.ok) show_toast(outcome.message);
  // A held key sends its first press only.
  if (!repeat) void send({ type: "record_step", invocations, outcome });
}

// A captured key goes through the router, so the keys after it wait until the leaf has run. Only a leaf made of captured-key steps holds: a step that waits on the user (a hint pick) would never see its keys. A leaf with a jump step goes to the router whole on a first press, whatever its other steps, so it holds too: hint mode skips the holds, so a pick in it still gets its keys. In a field the held keys go to the page unprocessed, so a hold there skips the Escape that leaves insert mode.
// `capture` is a param name, never empty, so its truth is its presence.
export const holds_keys_after = (leaf: TreeLeaf, in_field: boolean): boolean => !in_field && (leaf.steps.some((step) => step.jump) || leaf.steps.every((step) => step.capture));
