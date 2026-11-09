// Key cases for the mode of the focused frame: the badge and the background's tab mode follow the frame that holds focus, not only the top frame.
// /hidden_input_frame stands in for Google Docs: on load it focuses a contenteditable in an offscreen same-origin frame.
export const areas = ["ui", "keys"];
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, expect, sleep }) {
  const page_id = "p15_hidden_input";
  const in_top_frame = async (code) => (await evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }); })()`))?.[0];
  // The record shape is TabModeRecord in src/background/tab_modes.ts. Null means the background holds no mode for the tab.
  const stored_tab_mode = () =>
    evaluate_in_background(rdp, extension_id, `(async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const key = "desertfox_tab_mode_" + tab.id;
      const record = (await browser.storage.local.get(key))[key];
      return record === undefined ? null : record.focused_child?.mode ?? record.top_mode ?? null;
    })()`);
  // The badge is read from the page, not from the page's indicator reports: two reports sent 1 ms apart can reach the server out of order.
  const badge = () => in_top_frame(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  async function expect_eventually(read, expected, what) {
    let seen;
    for (let waited = 0; waited <= 3000; waited += 100) {
      seen = await read();
      if (seen === expected) return;
      await sleep(100);
    }
    expect(false, `${what} is ${seen}, expected ${expected}`);
  }
  async function expect_badge_and_mode(label) {
    await expect_eventually(badge, label, "the badge");
    await expect_eventually(stored_tab_mode, label.toLowerCase(), "the stored tab mode");
  }
  const SHIFT_ESCAPE = ["-M", "shift", "-k", "Escape", "-m", "shift"];
  const focus_editor = `document.getElementById("input_frame").contentDocument.getElementById("editor").focus()`;

  await run_case("the background keeps the tab mode a page reports at load", async () => {
    for (let load = 0; load < 5; load++) {
      await open_page("page", `p15_load_${load}`, { new_tab: load === 0 });
      await sleep(500);
      expect((await stored_tab_mode()) === "normal", `the stored tab mode after load ${load} is ${await stored_tab_mode()}`);
    }
  });

  await run_case("a hidden input frame focused at load shows INSERT, and Escape there shows NORMAL", async () => {
    await open_page("hidden_input_frame", page_id, { new_tab: true });
    await expect_badge_and_mode("INSERT");
    // Showing the tab fires focus on the top window as well, which must not take the badge back.
    await sleep(500);
    await expect_badge_and_mode("INSERT");
    await send_keys("-k", "Escape");
    await expect_badge_and_mode("NORMAL");
  });

  await run_case("focus moving to the top page and back to the hidden frame moves the badge with it", async () => {
    // The top page goes to ignore mode, so the badge shows which frame it follows.
    await in_top_frame(`document.activeElement.blur()`);
    await sleep(300);
    await send_keys(...SHIFT_ESCAPE);
    await expect_badge_and_mode("IGNORE");
    await in_top_frame(focus_editor);
    await expect_badge_and_mode("INSERT");
    await in_top_frame(`document.activeElement.blur()`);
    await expect_badge_and_mode("IGNORE");
  });

  await run_case("a focused hidden frame that is removed gives the badge back to the top page", async () => {
    await in_top_frame(focus_editor);
    await expect_badge_and_mode("INSERT");
    await in_top_frame(`document.getElementById("input_frame").remove()`);
    await expect_badge_and_mode("IGNORE");
    await send_keys(...SHIFT_ESCAPE);
  });
}
