// The `media_quality` rule on the background side: a tab that navigates gets the probe in every frame. A frame whose probe finds a video gets the `quality` bundle, which reports, and the answer to a report from a frame with a video is the rule for that frame's address (`quality_report` in `main.ts`), so no frame asks for it again.
// A frame that loads after the tab's last event misses the rule. That is a known limit. An about:blank frame gets it from the second pass (`about_blank_pass` below), which runs `settle_ms` after the first.
import type { QualityReport } from "../shared/quality.ts";
import { best_effort } from "../shared/swallow.ts";

export type MediaQualityDeps = {
  // True when the extension is off, or the rule is idle everywhere (the global value is `off` or `auto` and no site row asks for a quality), so no frame has anything to apply.
  is_idle: () => Promise<boolean>;
  // Runs the probe in every frame. Rejects when any frame refuses, while the others still run it.
  inject_all: (tab_id: number) => Promise<unknown>;
  // The second pass, with `matchAboutBlank`, that reaches a player in an about:blank frame. It runs `settle_ms` after the first, once the frames have left their initial about:blank documents. With the flag at load, a frame under an all-off site rule left ignore mode (#466).
  inject_about_blank: (tab_id: number) => Promise<unknown>;
  // Runs the `quality` bundle in one frame, the one whose probe found a video. Rejects when the frame is gone.
  inject_frame: (tab_id: number, frame_id: number) => Promise<unknown>;
  // The address the frame holds now, or undefined when the frame is gone.
  frame_address: (tab_id: number, frame_id: number) => Promise<string | undefined>;
  wait: (ms: number) => Promise<void>;
  settle_ms: number;
};

type TabChange = { url?: string | undefined; status?: string | undefined };

// A changed address (a hard load, or a `pushState` such as a click on a related video) and a finished load each inject the probe. A finished load matters because the first update of a hard load can reach the document that is about to go away.
export const is_trigger = (change: TabChange): boolean => change.url !== undefined || change.status === "complete";

const is_web = (address: string | undefined): boolean => address !== undefined && /^https?:/.test(address);

// The answer to a frame's `quality_report`: the rule for the frame's address when it holds a video, nothing otherwise, so a page with no video costs no read. A switched-off extension answers `off`.
export async function rule_for_report(report: QualityReport, reads: { is_disabled: () => Promise<boolean>; value_for_frame: () => Promise<string> }): Promise<string | undefined> {
  if (!report.has_video) return undefined;
  return (await reads.is_disabled()) ? "off" : reads.value_for_frame();
}

export function create_media_quality(deps: MediaQualityDeps) {
  // The newest trigger of each web tab. An earlier one that finds itself superseded injects nothing more, and a second pass that waited through a newer trigger drops itself.
  const newest = new Map<number, number>();
  let turns = 0;
  async function about_blank_pass(tab_id: number, turn: number): Promise<void> {
    await deps.wait(deps.settle_ms);
    if (newest.get(tab_id) !== turn || (await deps.is_idle()) || newest.get(tab_id) !== turn) return;
    await best_effort(deps.inject_about_blank(tab_id));
  }
  // Whether the rule was idle at the last settings change, so a change from off to on is seen.
  let was_idle: boolean | undefined;
  return {
    // A page that loaded while the rule was off has no bundle, so a settings change that turns the rule on injects it into the open web tabs, about:blank frames included, with no navigation needed.
    async settings_changed(open_tabs: () => Promise<readonly { id?: number | undefined; url?: string | undefined }[]>): Promise<void> {
      const idle = await deps.is_idle();
      const turned_on = was_idle === true && !idle;
      was_idle = idle;
      if (!turned_on) return;
      for (const { id, url } of await open_tabs()) {
        if (id === undefined || !is_web(url)) continue;
        await best_effort(deps.inject_all(id));
        await best_effort(deps.inject_about_blank(id));
      }
    },
    // A frame's probe found a video. The bundle goes into that frame alone, unless the frame has left the address the probe saw (a navigation or a closed frame between the report and now), where the bundle would cost a page with no video. An about: frame has no address to compare.
    // The answer tells the probe whether the bundle was injected. After a refusal (the rule is off, the frame moved on or closed) the probe stays ready to report again, so turning the rule on at the same address still reaches the frame.
    async probe_reported(tab_id: number | undefined, frame_id: number | undefined, address: string): Promise<boolean> {
      if (tab_id === undefined || frame_id === undefined) return false;
      try {
        if (await deps.is_idle()) return false;
        if (is_web(address) && (await deps.frame_address(tab_id, frame_id)) !== address) return false;
        await deps.inject_frame(tab_id, frame_id);
        return true;
      } catch {
        // A frame or tab that closed has no rule to apply.
        return false;
      }
    },
    async tab_updated(tab_id: number, change: TabChange, address: string | undefined): Promise<void> {
      if (!is_trigger(change)) return;
      // A tab that left the web supersedes the work still pending for it, so nothing reaches its new document.
      if (!is_web(address)) return void newest.delete(tab_id);
      const turn = ++turns;
      newest.set(tab_id, turn);
      try {
        if ((await deps.is_idle()) || newest.get(tab_id) !== turn) return;
        await best_effort(deps.inject_all(tab_id));
        if (newest.get(tab_id) !== turn) return;
        void best_effort(about_blank_pass(tab_id, turn));
      } catch {
        // A tab that closed or a page that refuses scripts has no rule to apply.
      }
    },
  };
}
