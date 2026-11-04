// Key test case of the layering: where surfaces overlap, the one with the higher LAYERS number is on top.
// The surfaces are top-layer popovers, where z-index has no effect, so the case hit-tests the page. At each grid point it
// takes the top host, hides it, and sees which host shows through: the one hidden must have the higher layer attribute.
// Which-key opens first and the toast comes after, so show order alone would put the toast on top.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, events, expect, sleep }) {
  const in_active_tab = (code) => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }); })()`);
  const hit_test = `(() => {
    const layer = (element) => Number(element.getAttribute("data-oasisfox-layer"));
    const own = (element) => element && element.hasAttribute("data-oasisfox-layer");
    const overlaps = [];
    let hosts = 0;
    for (const child of document.documentElement.children) if (own(child)) hosts++;
    for (let x = 0; x < innerWidth; x += 8) {
      for (let y = Math.max(innerHeight - 160, 0); y < innerHeight; y += 8) {
        const top = document.elementFromPoint(x, y);
        if (!own(top)) continue;
        const display = top.style.display;
        top.style.display = "none";
        const under = document.elementFromPoint(x, y);
        top.style.display = display;
        if (own(under)) overlaps.push([layer(top), layer(under)]);
      }
    }
    return JSON.stringify({ hosts, overlaps });
  })()`;

  await run_case("where surfaces overlap, the higher layer is on top", async () => {
    await open_page("caret", "p9_layers", { new_tab: true });
    await send_keys("gV");
    await send_keys("3w");
    await send_keys("v");
    await send_keys("e");
    let mark = events.length;
    await send_keys(",", "w");
    await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p9_layers" && event.value !== "", "the which-key panel");
    mark = events.length;
    await send_keys("y");
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === "p9_layers", "the copied toast");
    const { hosts, overlaps } = JSON.parse((await in_active_tab(hit_test))[0]);
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await sleep(300);
    expect(hosts >= 2, `${hosts} surface hosts are shown, need the which-key panel and the toast`);
    expect(overlaps.length > 0, "no two surfaces overlap in the bottom 160px, so the order is not tested");
    const wrong = overlaps.filter(([top, under]) => top < under);
    expect(wrong.length === 0, `a lower layer is on top of a higher one at ${wrong.length} points, first ${JSON.stringify(wrong[0])}`);
  });
}
