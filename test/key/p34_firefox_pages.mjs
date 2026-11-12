// The ,f keys open Firefox's own pages through the native host, which runs the parent Firefox as a remote client.
// Without the host the address goes to the clipboard, and the first such toast also names :native.install.
import { evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["help", "keys"];

const NOTICE_KEY = "desertfox_firefox_page_notice";

export async function run_cases({ rdp, run_case, expect, open_page, press_keys, settle_focus, poll_until, wait_cmdline, type_in_line, events, wait_event, in_active_tab, in_background, set_optional_permissions, clear_notices, read_local }) {
  // The selected tab of the most recent browser window, read from chrome code, because no content script runs on an about: page.
  const selected_address = () => evaluate_in_chrome(rdp, `Services.wm.getMostRecentWindow("navigator:browser").gBrowser.selectedBrowser.currentURI.spec`);
  const window_count = () => evaluate_in_chrome(rdp, `[...Services.wm.getEnumerator("navigator:browser")].length`);
  const tabs_at = (address) => in_background(`browser.tabs.query({}).then((tabs) => tabs.filter((tab) => tab.url === ${JSON.stringify(address)}).length)`);
  const close_tabs_at = (prefix) => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.startsWith(${JSON.stringify(prefix)})) await browser.tabs.remove(tab.id); })()`);
  const toast_text = () => in_active_tab(`[...document.documentElement.children].find((child) => child.style.zIndex === "2147483645")?.openOrClosedShadowRoot?.textContent ?? ""`);

  await run_case(",fs opens about:preferences as the selected tab of the same window", async () => {
    try {
      await open_page("page", "ff_settings", { new_tab: true });
      const windows_before = await window_count();
      await press_keys(",fs");
      await poll_until("about:preferences to be the selected tab", async () => (await selected_address()) === "about:preferences", { timeout_ms: 12000 });
      expect((await window_count()) === windows_before, "the host opened a new window instead of a tab");
    } finally {
      await close_tabs_at("about:preferences");
      await settle_focus();
    }
  });

  await run_case(",ff takes a page name and opens it", async () => {
    try {
      await open_page("page", "ff_pick", { new_tab: true });
      await press_keys(",ff");
      await wait_cmdline((line) => line.open && line.focused, "the line to open for the page name");
      await type_in_line("debugging");
      await press_keys("-k", "Return");
      await poll_until("about:debugging to be the selected tab", async () => (await selected_address()).startsWith("about:debugging"), { timeout_ms: 12000 });
    } finally {
      await close_tabs_at("about:debugging");
      await settle_focus();
    }
  });

  await run_case("without the host ,fs copies the address and names the install page once", async () => {
    try {
      await in_background(`browser.storage.local.remove("${NOTICE_KEY}")`);
      await set_optional_permissions("remove", ["nativeMessaging"]);
      await open_page("page", "ff_nohost", { new_tab: true });
      const mark = events.length;
      await press_keys(",fs");
      await wait_event(mark, (event) => event.type === "toast" && event.page_id === "ff_nohost", "the copy toast");
      const first = await toast_text();
      expect(/Copied about:preferences\. Press Ctrl\+L, then paste\./.test(first), `the toast is: ${first}`);
      expect(/:native\.install/.test(first), `the first toast does not name :native.install: ${first}`);
      expect((await in_background(`navigator.clipboard.readText()`)) === "about:preferences", "the clipboard does not hold about:preferences");
      expect((await read_local(NOTICE_KEY)) === true, "the notice flag was not stored");
      await press_keys(",fd");
      await poll_until("about:downloads on the clipboard", async () => (await in_background(`navigator.clipboard.readText()`)) === "about:downloads");
      expect((await tabs_at("about:preferences")) === 0 && (await tabs_at("about:downloads")) === 0, "a page opened without the host");
    } finally {
      await set_optional_permissions("grant", ["nativeMessaging"]);
      await in_background(`browser.storage.local.remove("${NOTICE_KEY}")`);
      await clear_notices();
      await settle_focus();
    }
  });
}
