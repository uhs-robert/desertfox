// The `df` address bar keyword, typed into the real address bar: it runs a command on a page where keys never reach DesertFox.
import { CTRL } from "./harness.mjs";
import { evaluate_in_background, evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["omnibox"];

export async function run_cases({ rdp, extension_id, run_case, setup, expect, open_page, press_keys, poll_until, type_in_address_bar, wait_active_tab, wait_tab_quiet }) {
  const in_background = (code) => evaluate_in_background(rdp, extension_id, code);
  const active_url = () => in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab?.url)`);
  const tab_count = () => in_background(`browser.tabs.query({}).then((tabs) => tabs.length)`);

  // Text typed in the same run as Ctrl+L loses its first characters, so the page losing the focus comes first.
  async function focus_address_bar() {
    await press_keys(...CTRL("l"));
    await poll_until("the page to lose the focus to the address bar", async () => (await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.executeScript(tab.id, { code: "document.hasFocus()" }))`))?.[0] === false, { expected_timeout: true }).catch(() => undefined);
  }
  // Extensions cannot open an about: page, so the address bar does.
  async function open_about_in_new_tab(address) {
    const tabs_before = await tab_count();
    await press_keys(...CTRL("t"));
    await poll_until("the new tab to open", async () => (await tab_count()) === tabs_before + 1);
    await focus_address_bar();
    await type_in_address_bar(address);
    await press_keys("-k", "Return");
    await poll_until(`${address} to load`, async () => (await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab.url === ${JSON.stringify(address)} && tab.status === "complete" ? tab.id : 0)`)) > 0, { timeout_ms: 8000 });
  }
  // What the address bar draws for the text typed in it, read from the rows of its result panel.
  const bar_rows = () =>
    evaluate_in_chrome(rdp, `(() => { const bar = Services.wm.getMostRecentWindow("navigator:browser").gURLBar; return [...bar.view.panel.querySelectorAll(".urlbarView-row")].filter((row) => !row.hasAttribute("hidden")).map((row) => row.innerText.replace(/\\s+/g, " ").trim()); })()`);
  const type_command = async (text) => {
    await focus_address_bar();
    await type_in_address_bar(text);
    // The keyword mode shows the one default row: the hint, then the typed text.
    await poll_until("the address bar to show the DesertFox hint row", async () => (await bar_rows()).some((row) => row.startsWith("Type a DesertFox command")));
  };

  await setup("open two pages and about:license", async () => {
    await open_page("page", "omni_a", { new_tab: true });
    await open_page("page", "omni_b", { new_tab: true });
    await open_about_in_new_tab("about:license");
    await wait_tab_quiet(await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab.id)`));
  });

  await run_case("df tab.next typed on about:license runs on the protected page", async () => {
    await type_command("df tab.next");
    await press_keys("-k", "Return");
    await poll_until("the active tab to leave about:license", async () => (await active_url()) !== "about:license");
  });

  await run_case("df tab.prev typed on a normal page runs too", async () => {
    const before = await active_url();
    await type_command("df tab.prev");
    await press_keys("-k", "Return");
    await poll_until("the active tab to change", async () => (await active_url()) !== before);
  });

  await run_case("a refused line runs nothing and shows a notification", async () => {
    const before = await active_url();
    await in_background(`browser.notifications.getAll().then((all) => Promise.all(Object.keys(all).map((id) => browser.notifications.clear(id))))`);
    await type_command("df rust");
    await press_keys("-k", "Return");
    // The protected page has no toast, so the refusal arrives as a notification. That proves the keyword fired.
    await poll_until("the refusal notification", async () => Object.keys((await in_background(`browser.notifications.getAll()`)) ?? {}).length > 0);
    expect((await active_url()) === before, "the active tab stayed");
  });
}
