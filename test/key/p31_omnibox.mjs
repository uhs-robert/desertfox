// The `df` address bar keyword, typed into the real address bar: it runs a command on a page where keys never reach DesertFox.
import { CTRL } from "./harness.mjs";
import { evaluate_in_background, evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["omnibox"];

export async function run_cases({ rdp, extension_id, run_case, setup, expect, events, wait_event, open_page, press_keys, poll_until, type_in_address_bar, wait_active_tab, wait_tab_quiet }) {
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

  const clear_notifications = () => in_background(`browser.notifications.getAll().then((all) => Promise.all(Object.keys(all).map((id) => browser.notifications.clear(id))))`);
  const notification_count = async () => Object.keys((await in_background(`browser.notifications.getAll()`)) ?? {}).length;

  await run_case("df tab.prev typed on a normal page runs and returns to about:license", async () => {
    expect((await active_url()) !== "about:license", "the previous case left a normal page active");
    await type_command("df tab.prev");
    await press_keys("-k", "Return");
    await poll_until("about:license to be active", async () => (await active_url()) === "about:license");
  });

  await run_case("a refused line on about:license runs nothing and shows a notification", async () => {
    await clear_notifications();
    await type_command("df rust");
    await press_keys("-k", "Return");
    // The protected page has no toast, so the refusal arrives as a notification. That proves the keyword fired.
    await poll_until("the refusal notification", async () => (await notification_count()) > 0);
    expect((await active_url()) === "about:license", "the active tab stayed");
  });

  await run_case("a refused line on a normal page shows a page toast and no notification", async () => {
    await clear_notifications();
    await type_command("df tab.next");
    await press_keys("-k", "Return");
    await poll_until("a normal page to be active", async () => (await active_url()) !== "about:license");
    const before = await active_url();
    const mark = events.length;
    await type_command("df rust");
    await press_keys("-k", "Return");
    await wait_event(mark, (event) => event.type === "toast", "the refusal toast on the page");
    expect((await notification_count()) === 0, "the refusal also raised a notification");
    expect((await active_url()) === before, "the active tab stayed");
  });

  await run_case("typing a command word lists the registry's commands, at most the rows Firefox shows", async () => {
    await focus_address_bar();
    await type_in_address_bar("df tab.ne");
    await poll_until("the next command to be suggested", async () => (await bar_rows()).some((row) => /^(tab\.)?next /.test(row)));
    // The default suggestion row and at most nine suggestions fill the ten rows of the address bar.
    expect((await bar_rows()).length <= 10, "more than ten rows");
    await press_keys("-k", "Escape");
  });

  await run_case("a short word fills all ten rows", async () => {
    await focus_address_bar();
    await type_in_address_bar("df t");
    await poll_until("ten rows", async () => (await bar_rows()).length === 10);
    await press_keys("-k", "Escape");
  });
}
