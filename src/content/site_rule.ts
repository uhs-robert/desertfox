// What an install does to the mode when the page's site rule changes.
// An unusable keymap never changes the mode, so the last rule state stays and a later usable keymap is judged against it.

export type AllOffStep = "enter" | "leave" | "none";

export function all_off_step(usable: boolean, all_off: boolean, was_all_off: boolean, mode: string): AllOffStep {
  if (!usable) return "none";
  if (all_off && !was_all_off) return "enter";
  // A manual ignore mode on a page that no rule turned off stays.
  return !all_off && was_all_off && mode === "ignore" ? "leave" : "none";
}
