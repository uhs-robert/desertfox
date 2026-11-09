// `ts` saves the window's tabs under a name from the command line, and `tS` lists the sessions and opens the pick in a new window.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["cmdline", "tabs"];

export async function run_cases({ rdp, extension_id, run_case, press_keys, open_page, wait_cmdline, type_in_line, complete_in_line, poll_until, expect, url_of, read_local }) {
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
    await poll_until("the new window with the saved tabs", async () => {
      const windows = await background(`browser.windows.getAll({ populate: true }).then((windows) => windows.map((window) => ({ id: window.id, tabs: window.tabs.map((tab) => ({ url: tab.url, active: tab.active, discarded: tab.discarded })) })))`);
      const created = windows.find((window) => !windows_before.includes(window.id));
      opened = created;
      return created !== undefined && created.tabs.length === saved_count;
    });
    expect(opened.tabs.filter((tab) => tab.active).length === 1, "the new window has no single active tab");
    expect(opened.tabs.filter((tab) => !tab.active).every((tab) => tab.discarded), "a background tab of the new window is not discarded");
  });
}
