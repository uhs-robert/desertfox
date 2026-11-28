// Space holds (y<Space>, each leaf runs, a second Space leaves) and the register prefix ("ayy, "_yy) on a page where no DesertFox page code runs: about:preferences in the parent process.
// A locked page shows the Copied toast as a desktop notification, which a nested test session never answers, so these cases read the clipboard and the register store instead.

import { module_steps } from "./browser_module_steps.mjs";
export const areas = ["keys"];

const SENTINEL = "desertfox-key-test-sentinel";
const clipboard_text = `(async () => {
  const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
  transferable.init(null);
  transferable.addDataFlavor("text/plain");
  Services.clipboard.getData(transferable, Services.clipboard.kGlobalClipboard, null);
  const data = {};
  try { transferable.getTransferData("text/plain", data); } catch { return ""; }
  return data.value.QueryInterface(Ci.nsISupportsString).data;
})()`;
const set_clipboard = (text) => `(async () => { Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(${JSON.stringify(text)}); })()`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, in_background, clear_notices } = context;
  const steps = module_steps(context);
  const { chrome, open_tab, focus_page, close_selected_tab, home, selected_spec } = steps;

  await setup("turn the module on", async () => {
    await steps.turn_on_module();
    await home("py_home");
  });

  const register_a = () => in_background(`browser.storage.local.get("desertfox_register_a").then((found) => JSON.stringify(found))`);

  await run_case("y then Space holds the group: yy and yc both copy the address, and a second Space leaves it", async () => {
    try {
      await open_tab("about:preferences");
      await focus_page();
      await sleep(500);
      const url = await selected_spec();
      await clear_notices();
      await press_keys("y", "-k", "space");
      for (const leaf of ["y", "c"]) {
        await chrome(set_clipboard(SENTINEL));
        await press_keys(leaf);
        await poll_until(`y ${leaf} in a hold`, async () => (await chrome(clipboard_text)) === url, { timeout_ms: 5000 });
      }
      await press_keys("-k", "space");
      await chrome(set_clipboard(SENTINEL));
      await press_keys("c");
      await sleep(500);
      expect((await chrome(clipboard_text)) === SENTINEL, "c copied after the hold ended");
    } finally {
      await close_selected_tab();
    }
  });

  await run_case('"a before yy stores the address in register a, and "_ before yy copies nothing', async () => {
    try {
      await open_tab("about:preferences");
      await focus_page();
      await sleep(500);
      const url = await selected_spec();
      await clear_notices();
      await chrome(set_clipboard(SENTINEL));
      const before = (await register_a()) ?? "";
      await press_keys('"', "_", "y", "y");
      await sleep(1000);
      expect((await chrome(clipboard_text)) === SENTINEL, '"_yy changed the clipboard');
      expect(((await register_a()) ?? "") === before, '"_yy wrote register a');
      await press_keys('"', "a", "y", "y");
      await poll_until("register a to hold the address", async () => ((await register_a()) ?? "").includes(url), { timeout_ms: 5000 });
      await poll_until("the clipboard to hold the address too", async () => (await chrome(clipboard_text)) === url, { timeout_ms: 5000 });
    } finally {
      await close_selected_tab();
    }
  });
}
