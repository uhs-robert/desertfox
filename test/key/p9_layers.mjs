// Key test case of the layering: the toast sits above the mode badge while both are shown.
// The badge only shows outside normal mode and outside the command line, so the case yanks in caret mode, which
// leaves the CARET or VISUAL badge and a toast on the page. Both hosts are in the page, so it compares their z-index.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, events, expect, sleep }) {
  const in_active_tab = (code) => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }); })()`);
  const layers = `(() => {
    const z = (element) => element ? Number(getComputedStyle(element).zIndex) : null;
    const badge = document.querySelector("[data-oasisfox-mode]");
    const toast = [...document.documentElement.children].find((child) => child !== badge && child.style.position === "fixed" && !child.hasAttribute("data-oasisfox-whichkey"));
    return JSON.stringify({ badge: z(badge), toast: z(toast) });
  })()`;

  await run_case("the toast is above the mode badge while both are shown", async () => {
    await open_page("caret", "p9_layers", { new_tab: true });
    await send_keys("gV");
    await send_keys("3w");
    await send_keys("v");
    await send_keys("e");
    const mark = events.length;
    await send_keys("y");
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === "p9_layers", "the copied toast");
    const { badge, toast } = JSON.parse((await in_active_tab(layers))[0]);
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await sleep(300);
    expect(badge !== null && toast !== null, `badge ${badge}, toast ${toast}: both must be shown`);
    expect(toast > badge, `toast z-index ${toast} is not above badge z-index ${badge}`);
  });
}
