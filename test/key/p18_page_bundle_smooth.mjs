// copy.url (yy) through the page bundle, and the half-page scroll animation with Firefox smooth scrolling on.
import { evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["bundles", "scroll"];

const CTRL_D = ["-M", "ctrl", "d", "-m", "ctrl"];

const clipboard_text = `(async () => {
  const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
  transferable.init(null);
  transferable.addDataFlavor("text/plain");
  Services.clipboard.getData(transferable, Services.clipboard.kGlobalClipboard, null);
  const data = {};
  try { transferable.getTransferData("text/plain", data); } catch { return ""; }
  return data.value.QueryInterface(Ci.nsISupportsString).data;
})()`;

export async function run_cases({ run_case, on_teardown, expect, open_page, press_keys, poll_until, wait_event, events, url_of, rdp, in_background }) {
  await run_case("yy copies the page address through the page bundle", async () => {
    await open_page("aligned", "copy_url", { new_tab: true });
    await evaluate_in_chrome(rdp, `Services.clipboard.emptyClipboard(Services.clipboard.kGlobalClipboard)`);
    const mark = events.length;
    await press_keys("yy");
    await wait_event(mark, (event) => event.type === "toast" && event.page_id === "copy_url", "the copy notice");
    const expected = url_of("aligned", "copy_url");
    await poll_until("the clipboard to hold the page address", async () => (await evaluate_in_chrome(rdp, clipboard_text)) === expected);
  });

  await run_case("the first C-d scrolls the page smoothly when general.smoothScroll is on", async () => {
    await evaluate_in_chrome(rdp, `Services.prefs.setBoolPref("general.smoothScroll", true)`);
    on_teardown(() => evaluate_in_chrome(rdp, `Services.prefs.setBoolPref("general.smoothScroll", false)`));
    await open_page("aligned", "smooth_page", { new_tab: true });
    const in_page = (code) => in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }))`);
    await in_page(`window.__samples = []; addEventListener("scroll", () => window.__samples.push(scrollY)); 0`);
    await press_keys(...CTRL_D);
    const expected_end = (await in_page(`innerHeight / 2`))[0];
    await poll_until("the scroll to reach half a page", async () => (await in_page(`scrollY`))[0] >= expected_end - 1);
    const samples = (await in_page(`window.__samples`))[0];
    const between = samples.filter((y) => y > 0 && y < expected_end - 1);
    expect(between.length >= 2, `no intermediate scroll positions: ${JSON.stringify(samples)}`);
  });
}
