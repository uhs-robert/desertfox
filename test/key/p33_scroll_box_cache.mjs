// j on a page whose root does not scroll: the kept scroll box keeps the right pane as the page changes, and the time per press is recorded.
// With MEASURE_DIR set, the median of the longest main-thread stall after each press goes to $MEASURE_DIR/scroll_box/out.jsonl.
import { appendFileSync, mkdirSync } from "node:fs";
import { pane_page_script } from "../fixtures/pane_page.mjs";

export const areas = ["scroll"];

// The scan blocks the page's main thread, so the longest gap between two ticks of a 2 ms timer after a press is the press's cost.
const TICKER = `(() => {
  window.__gap_ms = 0;
  let last = performance.now();
  setInterval(() => { const now = performance.now(); window.__gap_ms = Math.max(window.__gap_ms, now - last); last = now; }, 2);
  return true;
})()`;

export async function run_cases({ run_case, open_page, press_keys, in_active_tab, expect, sleep }) {
  const tops = () => in_active_tab(`[document.getElementById("big-pane").scrollTop, document.getElementById("small-pane").scrollTop]`);

  await run_case("j keeps moving the big pane, then the small one once the big one stops scrolling", async () => {
    await open_page("aligned", "sbc_panes", { new_tab: true });
    expect((await in_active_tab(pane_page_script())) === true, "the panes were not added");
    await press_keys("j");
    await sleep(300);
    await press_keys("j");
    await sleep(300);
    let [big, small] = await tops();
    expect(big > 0 && small === 0, `big ${big}, small ${small}`);
    const big_before = big;
    await in_active_tab(`document.getElementById("big-pane").style.overflow = "hidden"; true`);
    await press_keys("j");
    await sleep(300);
    [big, small] = await tops();
    expect(big === big_before && small > 0, `big ${big}, small ${small}`);
  });

  await run_case("j scrolls the small pane after the kept pane left the page", async () => {
    await open_page("aligned", "sbc_removed", { new_tab: true });
    expect((await in_active_tab(pane_page_script())) === true, "the panes were not added");
    await press_keys("j");
    await sleep(300);
    await in_active_tab(`document.getElementById("big-pane").remove(); true`);
    await press_keys("j");
    await sleep(300);
    const small = await in_active_tab(`document.getElementById("small-pane").scrollTop`);
    expect(small > 0, `small ${small}`);
  });

  await run_case("main-thread stall per j press on a page of 20000 elements", async () => {
    await open_page("aligned", "sbc_timing", { new_tab: true });
    expect((await in_active_tab(pane_page_script())) === true, "the panes were not added");
    await in_active_tab(TICKER);
    const samples = [];
    for (let press = 0; press < 20; press++) {
      await in_active_tab(`window.__gap_ms = 0; true`);
      await press_keys("j");
      await sleep(150);
      samples.push(await in_active_tab(`window.__gap_ms`));
    }
    const median = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    if (process.env.MEASURE_DIR) {
      mkdirSync(`${process.env.MEASURE_DIR}/scroll_box`, { recursive: true });
      appendFileSync(`${process.env.MEASURE_DIR}/scroll_box/out.jsonl`, JSON.stringify({ median_ms: median, samples }) + "\n");
    }
  });
}
