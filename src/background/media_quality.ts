// The `media_quality` rule on the background side: a tab that navigates gets the `quality` bundle in every frame and a start message, and each frame resolves and applies the rule for its own address (`read_media_quality`).
// A frame that loads after the tab's last event misses the rule, and so does an about:blank frame. Both are known limits.

import type { QualityRuleStart } from "../shared/quality.ts";

export type MediaQualityDeps = {
  is_disabled: () => Promise<boolean>;
  // Runs the bundle in every frame. Rejects when any frame refuses, while the others still run it.
  inject_all: (tab_id: number) => Promise<unknown>;
  start: (tab_id: number, message: QualityRuleStart) => Promise<unknown>;
};

type TabChange = { url?: string | undefined; status?: string | undefined };

// A changed address is a navigation: a hard load, or a `pushState` such as a click on a related video. A finished load starts the rule too, because the first update of a hard load can reach the document that is about to go away.
export function trigger_of(change: TabChange): "navigated" | "loaded" | undefined {
  if (change.url !== undefined) return "navigated";
  return change.status === "complete" ? "loaded" : undefined;
}

const is_web = (address: string | undefined): boolean => address !== undefined && /^https?:/.test(address);

export function create_media_quality(deps: MediaQualityDeps) {
  // The newest trigger of a tab decides. An earlier one that finds itself superseded sends nothing, and its `navigated` is carried to the newest, so a load that finishes right after a navigation cannot hide the navigation.
  const latest = new Map<number, { turn: number; navigated: boolean }>();
  let turns = 0;
  return {
    async tab_updated(tab_id: number, change: TabChange, address: string | undefined): Promise<void> {
      const trigger = trigger_of(change);
      if (trigger === undefined) return;
      // A tab that left the web supersedes the work still pending for it, so nothing reaches its new document.
      if (!is_web(address)) return void latest.delete(tab_id);
      const turn = ++turns;
      latest.set(tab_id, { turn, navigated: trigger === "navigated" || latest.get(tab_id)?.navigated === true });
      try {
        if ((await deps.is_disabled()) || latest.get(tab_id)?.turn !== turn) return;
        await deps.inject_all(tab_id).catch(() => undefined);
        const state = latest.get(tab_id);
        if (state?.turn !== turn) return;
        latest.delete(tab_id);
        await deps.start(tab_id, { type: "quality_rule", navigated: state.navigated });
      } catch {
        // A tab that closed or a page that refuses scripts has no rule to apply.
      } finally {
        if (latest.get(tab_id)?.turn === turn) latest.delete(tab_id);
      }
    },
  };
}
