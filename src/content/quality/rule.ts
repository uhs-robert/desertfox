// The `media_quality` rule in one frame: poll for the site player, take it to the rule's level, and stop once the level has held for a while.

import { choose_level } from "./choose_level.ts";
import type { Driver } from "./driver.ts";

export const RULE_INTERVAL_MS = 100;
// A player that never lists levels (no video here) stops costing anything after this.
export const RULE_GIVE_UP_MS = 10_000;
// Once a video has reached the rule's level the poll ends after it held this long.
export const RULE_HOLD_MS = 3000;
// A frame with no video looks again this often, for `RULE_BACKUP_SPAN_MS`, in case the video came in a way no media event reports (inside a shadow root, or a site player that builds its handle first).
export const RULE_BACKUP_MS = 2000;
export const RULE_BACKUP_SPAN_MS = 10_000;

export type RuleDeps = {
  // Reports this frame to the background. The answer is the rule for the frame's address (`off` included), or undefined when the frame has no video to apply it to.
  report: () => Promise<string | undefined>;
  // True when the frame holds a video or a known player.
  has_media: () => boolean;
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
  // True while this frame's latest start polls.
  let polling = false;
  // The rule of the latest answer, which a running poll reads at each tick, so a settings change reaches it.
  let level: string | undefined;
  // The newest report decides. `wanted` is set while a start waits for its answer, and tells whether any of those starts was a navigation.
  let asked = 0;
  let wanted: boolean | undefined;
  // The time the look-again loop has left. A later report with no video fills it up again instead of starting a second loop.
  let look_left_ms = 0;
  const hold_ticks = Math.ceil(RULE_HOLD_MS / RULE_INTERVAL_MS);
  async function poll(navigated: boolean, mine: number): Promise<void> {
    let deadline = deps.now() + RULE_GIVE_UP_MS;
    let held = 0;
    // A navigation inside a site changes the address while the old video still plays, often already at the rule's level. The poll therefore ends early only for a video other than the one it started on, and otherwise runs to the deadline. A change of video starts the watch again.
    let first_video: string | undefined;
    let last_video: string | undefined;
    while (mine === generation && deps.now() < deadline && held < hold_ticks) {
      let at_level = false;
      let video_is_new = true;
      try {
        const driver = deps.probe();
        if (driver) {
          const video = driver.video_id();
          first_video ??= video;
          if (last_video !== undefined && video !== last_video) {
            held = 0;
            deadline = deps.now() + RULE_GIVE_UP_MS;
          }
          last_video = video;
          video_is_new = first_video === undefined || video !== first_video;
          at_level = take_to_level(driver, level!);
        }
      } catch {
        // A page object that throws counts as a player that is not ready.
      }
      // `auto` has no level to watch, so one hand-back ends it.
      held = at_level ? (level === "auto" ? hold_ticks : held + (video_is_new || !navigated ? 1 : 0)) : 0;
      if (held >= hold_ticks) break;
      await deps.sleep(RULE_INTERVAL_MS);
    }
  }
  async function apply(value: string, navigated: boolean): Promise<void> {
    level = value;
    if (navigated) manual = false;
    else if (manual) return;
    if (value === "off") {
      generation++;
      polling = false;
      return;
    }
    if (polling && !navigated) return;
    const mine = ++generation;
    polling = true;
    try {
      await poll(navigated, mine);
    } finally {
      if (mine === generation) polling = false;
    }
  }
  async function look_again(): Promise<void> {
    while (look_left_ms > 0) {
      await deps.sleep(RULE_BACKUP_MS);
      // A report that got a rule emptied the time while this slept. No stop on unload: a frozen page (back-forward cache) keeps its timers, and the leftover time runs out within 10 s.
      if (look_left_ms <= 0) break;
      look_left_ms -= RULE_BACKUP_MS;
      if (deps.has_media()) {
        look_left_ms = 0;
        void report(false, false);
      }
    }
  }
  // `refresh` is a report that starts nothing unless the rule changed since the last start (a settings change), so other updates cannot restart a poll that has ended.
  async function report(navigated: boolean, refresh: boolean): Promise<void> {
    if (!refresh) wanted = navigated || wanted === true;
    const mine = ++asked;
    const value = await deps.report();
    if (mine !== asked) return;
    if (value === undefined) {
      // A navigation that finds no video (a site that swaps its video) still ends a manual choice and the old poll, and frees the frame for the next video's wake.
      if (wanted) {
        manual = false;
        generation++;
        polling = false;
      }
      if (!polling) level = undefined;
      wanted = undefined;
      // A look-again loop that still sleeps carries on with the full time.
      const sleeping = look_left_ms > 0;
      look_left_ms = RULE_BACKUP_SPAN_MS;
      if (!sleeping) void look_again();
      return;
    }
    look_left_ms = 0;
    if (refresh && wanted === undefined && value === level) return;
    const start = wanted;
    wanted = undefined;
    return apply(value, start === true);
  }
  return {
    // A `media quality` choice stands: it ends the poll, and a start that is not a navigation leaves it alone.
    manual_choice(): void {
      // A report still waiting for its answer must not clear the choice or start a poll when it arrives.
      asked++;
      wanted = undefined;
      generation++;
      polling = false;
      manual = true;
    },
    // Each run of the bundle: reports, then applies the answer. A frame with no video starts nothing and looks again for a while. A run that is not a navigation in a frame that already has a rule only reports: a media command injects the bundle too, and must not restart the rule over a level chosen since.
    start(navigated: boolean): Promise<void> {
      return report(navigated, !navigated && level !== undefined);
    },
    // The settings changed. Only a frame that has a video asks again.
    async refresh(): Promise<void> {
      if (deps.has_media()) await report(false, true);
    },
    // A media event reached the document. A start that waits for its answer, or a frame that got a rule (it has a video), ignores them, because a `play` after every pause must not undo a choice made in the site's menu.
    wake(): void {
      if (level === undefined && wanted === undefined) void report(false, false);
    },
  };
}
