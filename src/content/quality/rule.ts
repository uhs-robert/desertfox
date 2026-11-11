// The `media_quality` rule in one frame: poll for the site player, take it to the rule's level, and stop once the level has held for a while.

import { choose_level } from "./choose_level.ts";
import type { Driver } from "./driver.ts";

export const RULE_INTERVAL_MS = 100;
// A player that never lists levels (no video here) stops costing anything after this.
export const RULE_GIVE_UP_MS = 10_000;
// A navigation inside a site changes the address before the new video loads, and the old video may already sit at the rule's level. The poll therefore keeps watching for this long after the level holds, so a new video that starts at the site's own choice is taken up again.
export const RULE_HOLD_MS = 3000;

export type RuleDeps = {
  // The rule for this frame's address, `off` included.
  read_value: () => Promise<string>;
  probe: () => Driver | undefined;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

// True when the player is at the rule's level. A player that lists no levels yet (YouTube answers `unknown` until it plays) is not.
function take_to_level(driver: Driver, value: string): boolean {
  const levels = driver.levels();
  if (levels.length === 0) return false;
  if (value === "auto") return driver.auto();
  const chosen = choose_level(levels, value, undefined, 1)!;
  if (chosen.active) return true;
  chosen.pick();
  return false;
}

export function create_rule(deps: RuleDeps) {
  // Each start and each manual choice moves this on, which ends the poll of an earlier start.
  let generation = 0;
  let manual = false;
  const hold_ticks = Math.ceil(RULE_HOLD_MS / RULE_INTERVAL_MS);
  return {
    // A `media quality` choice stands: it ends the poll, and a start that is not a navigation leaves it alone.
    manual_choice(): void {
      generation++;
      manual = true;
    },
    async start(navigated: boolean): Promise<void> {
      if (navigated) manual = false;
      else if (manual) return;
      const mine = ++generation;
      const value = await deps.read_value();
      if (mine !== generation || value === "off") return;
      const deadline = deps.now() + RULE_GIVE_UP_MS;
      let held = 0;
      while (mine === generation && deps.now() < deadline && held < hold_ticks) {
        let at_level = false;
        try {
          const driver = deps.probe();
          at_level = driver !== undefined && take_to_level(driver, value);
        } catch {
          // A page object that throws counts as a player that is not ready.
        }
        // `auto` has no level to watch, so one hand-back ends it.
        held = at_level ? (value === "auto" ? hold_ticks : held + 1) : 0;
        if (held < hold_ticks) await deps.sleep(RULE_INTERVAL_MS);
      }
    },
  };
}
