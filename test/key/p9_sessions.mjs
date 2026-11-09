// `ts` saves the window's tabs under a name from the command line, `session.open --into=tab` adds them, and `tS` lists the sessions and opens a pick in a new window.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["cmdline", "tabs"];

export async function run_cases({ rdp, extension_id, run_case, press_keys, settle_focus, open_page, wait_cmdline, close_cmdline, type_in_line, complete_in_line, poll_until, expect, url_of, read_local }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);
  const shows_row = (text) => (line) => line.row_texts.some((row) => row.includes(text));

  await open_page("page", "p9s_one", { new_tab: true });
  await open_page("page", "p9s_two", { new_tab: true });

  await run_case("ts opens the line with session.save typed, and a name saves the window's tabs", async () => {
    await press_keys("t", "s");
    await wait_cmdline((line) => line.open && line.value === "session.save ", "ts to open the line with session.save");
    await type_in_line("kt work");
    await press_keys("-k", "Return");
    await poll_until("the session to be stored", async () => Boolean((await read_local("desertfox_sessions"))?.sessions?.["kt work"]));
    const stored = (await read_local("desertfox_sessions")).sessions["kt work"];
    expect(stored.tabs.some((tab) => tab.url === url_of("page", "p9s_one")), "p9s_one is not in the session");
    expect(stored.tabs.filter((tab) => tab.active).length === 1, "the session has no single active tab");
  });

  await run_case("session.open --into=tab adds the tabs discarded and the current tab stays active", async () => {
    const read_window = () => background(`browser.tabs.query({ currentWindow: true }).then((tabs) => tabs.map((tab) => ({ id: tab.id, url: tab.url, active: tab.active, discarded: tab.discarded })))`);
    const before = await read_window();
    const active_before = before.find((tab) => tab.active)?.id;
    const saved_count = (await read_local("desertfox_sessions")).sessions["kt work"].tabs.length;
    await press_keys(":");
    await wait_cmdline((line) => line.open, "the command line to open");
    await type_in_line("session.open --into=tab kt work");
    await press_keys("-k", "Return");
    let after;
    await poll_until("the tabs to be added", async () => ((after = await read_window()).length === before.length + saved_count));
    const added = after.filter((tab) => !before.some((old) => old.id === tab.id));
    expect(added.every((tab) => tab.discarded && !tab.active), "an added tab is loaded or active");
    expect(after.find((tab) => tab.active)?.id === active_before, "the current tab lost the focus");
  });

  // The case closes the window it opened. That leaves the compositor focus on a Firefox window that is not the page's, which settle_focus restores with hyprctl, as the reset of the next piece does.
  await run_case("tS lists the session, and a pick opens its tabs in a new window, discarded but the active one", async () => {
    const windows_before = await background(`browser.windows.getAll().then((windows) => windows.map((window) => window.id))`);
    const saved_count = (await read_local("desertfox_sessions")).sessions["kt work"].tabs.length;
    await press_keys("t", "S");
    await wait_cmdline((line) => line.open && line.value === "session.open ", "tS to open the line with session.open");
    await wait_cmdline(shows_row("kt work"), "the session in the list");
    await type_in_line("kt");
    await complete_in_line();
    await press_keys("-k", "Return");
    let opened;
    try {
      await poll_until("the new window with the saved tabs", async () => {
        const windows = await background(`browser.windows.getAll({ populate: true }).then((windows) => windows.map((window) => ({ id: window.id, tabs: window.tabs.map((tab) => ({ url: tab.url, active: tab.active, discarded: tab.discarded })) })))`);
        opened = windows.find((window) => !windows_before.includes(window.id));
        return opened !== undefined && opened.tabs.length === saved_count;
      });
      expect(opened.tabs.filter((tab) => tab.active).length === 1, "the new window has no single active tab");
      expect(opened.tabs.filter((tab) => !tab.active).every((tab) => tab.discarded), "a background tab of the new window is not discarded");
    } finally {
      // Every window the pick opened, also one the poll gave up on, so the next case starts in one window.
      await background(`(async () => { for (const window of await browser.windows.getAll()) if (!${JSON.stringify(windows_before)}.includes(window.id)) await browser.windows.remove(window.id); })()`);
      await settle_focus();
    }
  });

  // A pick of `tS` puts the session name in the line.
  await run_case("tS opens the line with session.open typed and lists the session, and a pick puts its name in the line", async () => {
    await press_keys("t", "S");
    await wait_cmdline((line) => line.open && line.value === "session.open ", "tS to open the line with session.open");
    await wait_cmdline(shows_row("kt work"), "the session in the list");
    await type_in_line("kt");
    await complete_in_line();
    await wait_cmdline((line) => line.value === "session.open kt work ", "the pick to put the session name in the line");
    await close_cmdline();
  });
}
