// The `media_quality` rule in one frame: poll for the site player, take it to the rule's level, and stop once the level has held for a while.

import { choose_level } from "./choose_level.ts";
import type { Driver } from "./driver.ts";

export const RULE_INTERVAL_MS = 100;
// A player that never lists levels (no video here) stops costing anything after this.
export const RULE_GIVE_UP_MS = 10_000;
// Once a video has reached the rule's level the poll ends after it held this long.
export const RULE_HOLD_MS = 3000;
// The rule is read again this often while the poll runs, so a switch-off or an edit takes effect within about a second.
export const RULE_RECHECK_MS = 1000;

export type RuleDeps = {
  // The rule for this frame's address, `off` included.
  read_value: () => Promise<string>;
  probe: () => Driver | undefined;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  // Whether the frame's document finished loading.
  loaded: () => boolean;
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
  const recheck_ticks = Math.ceil(RULE_RECHECK_MS / RULE_INTERVAL_MS);
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
      let value = await deps.read_value();
      if (mine !== generation || value === "off") return;
      let deadline = deps.now() + RULE_GIVE_UP_MS;
      let held = 0;
      let ticks = 0;
      // A navigation inside a site changes the address while the old video still plays, often already at the rule's level. The poll therefore ends early only for a video other than the one it started on, and otherwise runs to the deadline. A change of video starts the watch again.
      let first_video: string | undefined;
      let last_video: string | undefined;
      while (mine === generation && deps.now() < deadline && held < hold_ticks) {
        let at_level = false;
        let video_is_new = true;
        try {
          const driver = deps.probe();
          // A finished load that has no player has none to wait for. A start for a navigation may still run before its page does.
          if (driver === undefined && !navigated && deps.loaded()) return;
          if (driver) {
            const video = driver.video_id();
            first_video ??= video;
            if (last_video !== undefined && video !== last_video) {
              held = 0;
              deadline = deps.now() + RULE_GIVE_UP_MS;
            }
            last_video = video;
            video_is_new = first_video === undefined || video !== first_video;
            at_level = take_to_level(driver, value);
          }
        } catch {
          // A page object that throws counts as a player that is not ready.
        }
        // `auto` has no level to watch, so one hand-back ends it.
        held = at_level ? (value === "auto" ? hold_ticks : held + (video_is_new || !navigated ? 1 : 0)) : 0;
        if (held >= hold_ticks) break;
        await deps.sleep(RULE_INTERVAL_MS);
        if (++ticks % recheck_ticks === 0 && mine === generation) {
          const again = await deps.read_value();
          if (mine !== generation || again === "off") return;
          value = again;
        }
      }
    },
  };
}
