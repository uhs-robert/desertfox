// The `+` register writes the system clipboard from the background, which only a real Firefox can confirm.
import { evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["find", "cmdline"];

const clipboard_text = `(async () => {
  const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
  transferable.init(null);
  transferable.addDataFlavor("text/plain");
  Services.clipboard.getData(transferable, Services.clipboard.kGlobalClipboard, null);
  const data = {};
  try { transferable.getTransferData("text/plain", data); } catch { return ""; }
  return data.value.QueryInterface(Ci.nsISupportsString).data;
})()`;

export async function run_cases({ run_case, open_page, poll_until, rdp, in_background }) {
  await run_case("a register_write to + from a page reaches the system clipboard", async () => {
    await open_page("page", "p9r_one", { new_tab: true });
    await evaluate_in_chrome(rdp, `Services.clipboard.emptyClipboard(Services.clipboard.kGlobalClipboard)`);
    const send = `browser.runtime.sendMessage({ type: "register_write", name: "+", text: "from the plus register" })`;
    await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(send)} }))`);
    await poll_until("the clipboard to hold the register text", async () => (await evaluate_in_chrome(rdp, clipboard_text)) === "from the plus register");
  });
}
