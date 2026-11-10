// The `+` register writes the system clipboard from the background, which only a real Firefox can confirm. The `"<reg>` prefix, `"ap` and `<C-r><reg>` need real keys.
import { evaluate_in_chrome } from "./rdp.mjs";
import { CTRL } from "./harness.mjs";

export const areas = ["find", "cmdline", "keys"];

const clipboard_text = `(async () => {
  const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
  transferable.init(null);
  transferable.addDataFlavor("text/plain");
  Services.clipboard.getData(transferable, Services.clipboard.kGlobalClipboard, null);
  const data = {};
  try { transferable.getTransferData("text/plain", data); } catch { return ""; }
  return data.value.QueryInterface(Ci.nsISupportsString).data;
})()`;

export async function run_cases({ run_case, open_page, poll_until, rdp, in_background, in_active_tab, press_keys, wait_event, events, expect, settle_focus }) {
  const send = (message) => in_active_tab(`browser.runtime.sendMessage(${JSON.stringify(message)})`);
  const read_register = (name) => send({ type: "register_read", name });
  await run_case("a register_write to + from a page reaches the system clipboard", async () => {
    await open_page("page", "p9r_one", { new_tab: true });
    await evaluate_in_chrome(rdp, `Services.clipboard.emptyClipboard(Services.clipboard.kGlobalClipboard)`);
    const send = `browser.runtime.sendMessage({ type: "register_write", name: "+", text: "from the plus register" })`;
    await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(send)} }))`);
    await poll_until("the clipboard to hold the register text", async () => (await evaluate_in_chrome(rdp, clipboard_text)) === "from the plus register");
  });

  await run_case('"ayy yanks the address into register a and the unnamed register', async () => {
    await open_page("page", "p9r_yank", { new_tab: true });
    await settle_focus();
    await press_keys('"ayy');
    await poll_until("register a to hold the address", async () => String(await read_register("a")).includes("id=p9r_yank"));
    await poll_until("the unnamed register to hold the address", async () => String(await read_register('"')).includes("id=p9r_yank"));
  });

  await run_case('"bp opens register b as a URL here', async () => {
    await open_page("page", "p9r_open", { new_tab: true });
    await settle_focus();
    const target = await in_active_tab(`location.origin + "/page?id=p9r_target"`);
    await send({ type: "register_write", name: "b", text: target });
    const mark = events.length;
    await press_keys('"bp');
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p9r_target", "the page of register b to load");
  });

  await run_case("<C-r>c in a field types register c", async () => {
    await open_page("field", "p9r_paste", { new_tab: true });
    await settle_focus();
    await send({ type: "register_write", name: "c", text: "from register c" });
    const mark = events.length;
    await press_keys(...CTRL("r"), "c");
    await wait_event(mark, (event) => event.type === "input" && event.page_id === "p9r_paste" && event.value === "from register c", "the field to hold the register text");
  });

  await run_case('a pause after " shows the stored registers, and Escape closes the panel', async () => {
    await open_page("page", "p9r_wk", { new_tab: true });
    await settle_focus();
    await send({ type: "register_write", name: "d", text: "listed" });
    const mark = events.length;
    await press_keys('"');
    await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "p9r_wk" && event.value !== "", "the register panel");
    const closed = events.length;
    await press_keys("-k", "Escape");
    await wait_event(closed, (event) => event.type === "whichkey" && event.page_id === "p9r_wk" && event.value === "", "the panel to close");
  });
}
