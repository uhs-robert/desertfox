// The tab-switch measurement: pure parts, so test/rivals_tab_timing.test.ts covers them. run.mjs takes the marks in the chrome process and sends them here.
// All times are milliseconds on one chrome clock, so the start and the end of an interval come from the same clock.

// The gap asked for between two presses while the new tab loads. The real gap is longer, because the parent process is busy restoring the tab, so every run records its press times and the analysis reports the measured gap.
export const RETRY_MS = 10;

// The key that moves to the next tab in each tool's default keymap. Only DesertFox binds J to the next tab. Vimium, Vimium C and Tridactyl 1.25.1 bind K to it and J to the previous tab.
export const NEXT_TAB_KEY = { desertfox: "J", vimium: "K", vimiumc: "K", tridactyl: "K" };

// marks: { key_a_ms, selects: [{ index, ms }] in order, presses_b_ms: [ms] }. Tab 0 is the loaded start tab, tab 1 and tab 2 start unloaded.
// Hop A is the key in tab 0 (a loaded script) to tab 1 becoming active. Hop B starts when tab 1 becomes active and ends when tab 2 does, with a press every RETRY_MS in between.
// Returns { error } when a hop did not happen, so run.mjs can fail the run as one that cannot measure.
export function analyze_tab_switch(marks) {
  // The first switch must be to tab 1 and the second to tab 2. Any other order means the key did not do what the table says, even if the right tabs come up later.
  const [hop_a, landing] = marks.selects;
  if (hop_a?.index !== 1 || hop_a.ms < marks.key_a_ms) return { error: "the key in the loaded tab did not switch to the next tab" };
  if (landing?.index !== 2) return { error: "no press in the unloaded tab switched to the next tab" };
  const presses = marks.presses_b_ms.filter((ms) => ms >= hop_a.ms && ms <= landing.ms);
  const gaps = presses.slice(1).map((ms, i) => ms - presses[i]).sort((a, b) => a - b);
  return {
    first_hop_ms: hop_a.ms - marks.key_a_ms,
    arrive_to_land_ms: landing.ms - hop_a.ms,
    // Presses sent before the landing, minus the one that worked. A press still in flight when the landing happened counts as lost, so this can read one or two high.
    // DesertFox holds a key that arrives before its keymap is read and replays it, so for DesertFox this counts held presses and it can land up to one press gap sooner. How the rivals treat early keys was not checked, so for them it counts presses sent before the landing.
    lost_before_landing: Math.max(0, presses.length - 1),
    presses_sent: presses.length,
    // The measured gap between presses, the median of the differences. Null with fewer than two presses.
    press_gap_ms: gaps.length === 0 ? null : gaps[gaps.length >> 1],
    // Switches after the landing: presses that were in flight and worked as well. Zero means the landing was the only effect.
    extra_hops: marks.selects.length - 2,
  };
}
