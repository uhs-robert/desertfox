import { show_toast_on_tab } from "../background/browser_deps.ts";
import { BUNDLE_LOADS_STORAGE_KEY } from "../background/storage_keys.ts";
import { browser_timing_log } from "../background/timing_browser.ts";
import { format_timings, summarize_timings, toast_summary } from "../background/timing_summary.ts";
import type { Timing } from "../background/timing_log.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";

// The bundle log keeps `{ file, ok, ms }` per injection. A failed load is not a load time.
async function bundle_load_timings(): Promise<Timing[]> {
  const stored = ((await browser.storage.local.get(BUNDLE_LOADS_STORAGE_KEY))[BUNDLE_LOADS_STORAGE_KEY] as { file?: string; ok?: boolean; ms?: number }[] | undefined) ?? [];
  return stored.flatMap((load) => (load.ok === true && typeof load.file === "string" && typeof load.ms === "number" ? [[`load ${load.file}`, load.ms] satisfies Timing] : []));
}

define("debug.perf", {
  name: "perf",
  label: "Copy timings",
  intent: "Copy load, command and hint build timings for a report.",
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: async (ctx) => {
    const rows = summarize_timings([...(await bundle_load_timings()), ...(await browser_timing_log.read())]);
    try {
      await navigator.clipboard.writeText(format_timings(rows));
    } catch (error) {
      throw new RuntimeRefusal(`Could not copy the timings: ${error instanceof Error ? error.message : String(error)}`);
    }
    await show_toast_on_tab(ctx, "perf", toast_summary(rows), "success");
  },
});
