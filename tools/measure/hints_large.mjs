// Key-test piece: time from the `f` keydown to the first hint label on a page with 10,000 links and 10,000 plain divs.
// Run as the measure README says for key-test pieces. Rows go to $MEASURE_DIR/hints_large/out.jsonl.
import { appendFileSync, mkdirSync } from "node:fs";
const work = process.env.MEASURE_DIR ?? "/tmp/desertfox-measure";
mkdirSync(`${work}/hints_large`, { recursive: true });
export const areas = ["hints"];
const OUT = `${work}/hints_large/out.jsonl`;
const HINTS_LAYER = 2147483647 - 4;
const COUNT = 10000;

const FILL = `(() => {
  const box = document.createElement("div");
  const parts = [];
  for (let i = 0; i < ${COUNT}; i++) parts.push('<a href="/page?id=big_' + i + '">link ' + i + '</a><div>plain ' + i + '</div>');
  box.innerHTML = parts.join("");
  document.body.append(box);
  return document.querySelectorAll("*").length;
})()`;

const PROBE = `(() => { const now = () => performance.timeOrigin + performance.now(); const fp = (window.__hl = { ev: [] });
  const end = now() + 20000; const seen = {};
  fp.timer = setInterval(() => { if (now() > end) return clearInterval(fp.timer);
    const hints = [...document.documentElement.children, ...document.body.children].find((c) => c.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}");
    if (hints?.openOrClosedShadowRoot?.querySelector(".desertfox-hint") && !seen.label) { seen.label = 1; fp.ev.push(["label", now()]); clearInterval(fp.timer); }
  }, 1);
  return 1; })()`;

export async function run_cases({ run_case, open_page, press_keys, sleep, in_active_tab }) {
  // One case per run, as a case may take 30 s at most.
  for (let run = 0; run < 16; run++) await run_case(`first label, run ${run}`, async () => {
    // Odd runs are the control: the same page without the fill, which is the key latency plus a small page's label time.
    await open_page("hints", `hl_${run}`, { new_tab: true });
    await sleep(300);
    const elements = run % 2 === 0 ? await in_active_tab(FILL) : await in_active_tab("document.querySelectorAll('*').length");
    await sleep(500);
    await in_active_tab(PROBE);
    const pressed = Date.now();
    await press_keys("f");
    await sleep(3000);
    const ev = JSON.parse(await in_active_tab("JSON.stringify(window.__hl.ev)"));
    appendFileSync(OUT, JSON.stringify({ run, elements, first_label_ms: ev[0] ? ev[0][1] - pressed : null }) + "\n");
    await press_keys("-k", "Escape");
    await sleep(400);
  });
}
