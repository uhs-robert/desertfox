// The tab-switch measurement: pure parts, so test/rivals_tab_timing.test.ts covers them. run.mjs takes the marks in the chrome process and sends them here.
// All times are milliseconds on one chrome clock, so the start and the end of an interval come from the same clock.

// Gap between two presses while the new tab loads. It is the resolution of the landing time: a key that works is sent up to this long after the script came up.
export const RETRY_MS = 10;

// The key that moves to the next tab in each tool's default keymap. Vimium and Vimium C bind K to the next tab and J to the previous one, DesertFox and Tridactyl the other way round.
export const NEXT_TAB_KEY = { desertfox: "J", vimium: "K", vimiumc: "K", tridactyl: "J" };

// marks: { key_a_ms, selects: [{ index, ms }] in order, presses_b_ms: [ms] }. Tab 0 is the loaded start tab, tab 1 and tab 2 start unloaded.
// Hop A is the key in tab 0 (a loaded script) to tab 1 becoming active. Hop B starts when tab 1 becomes active and ends when tab 2 does, with a press every RETRY_MS in between.
// Returns { error } when a hop did not happen, so run.mjs can fail the run as one that cannot measure.
export function analyze_tab_switch(marks) {
  const hop_a = marks.selects.find((select) => select.index === 1 && select.ms >= marks.key_a_ms);
  if (!hop_a) return { error: "the key in the loaded tab did not switch to the next tab" };
  const landing = marks.selects.find((select) => select.index === 2 && select.ms > hop_a.ms);
  if (!landing) return { error: "no press in the unloaded tab switched to the next tab" };
  const sent = marks.presses_b_ms.filter((ms) => ms >= hop_a.ms && ms <= landing.ms).length;
  const after = marks.selects.filter((select) => select.ms > landing.ms).length;
  return {
    first_hop_ms: hop_a.ms - marks.key_a_ms,
    arrive_to_land_ms: landing.ms - hop_a.ms,
    // Presses sent before the landing, minus the one that worked. A press still in flight when the landing happened counts as lost, so this can read one or two high at RETRY_MS spacing.
    lost_before_landing: Math.max(0, sent - 1),
    presses_sent: sent,
    // Switches after the landing: presses that were in flight and worked as well. Zero means the landing was the only effect.
    extra_hops: after,
  };
}
