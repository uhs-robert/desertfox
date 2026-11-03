// Key test cases of piece P4 (which-key). run.mjs calls this with its helpers.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_whichkey_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, events, expect, sleep }) {
  const whichkey_events = (mark, page_id) => events.slice(mark).filter((event) => event.type === "whichkey" && event.page_id === page_id);

  await open_page("page", "wk", { new_tab: true });

  await run_case("g then a pause shows the which-key panel with the keys that follow", async () => {
    const mark = events.length;
    await send_keys("g");
    const shown = await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "wk" && event.value !== "", "the which-key panel");
    expect(/^(column|grid):\d+$/.test(shown.value) && Number(shown.value.split(":")[1]) >= 5, `panel reported "${shown.value}"`);
  });

  await run_case("the next key closes the panel", async () => {
    const mark = events.length;
    await send_keys("-k", "Escape");
    await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "wk" && event.value === "", "the panel to close");
  });

  await run_case("gg typed at once shows no panel", async () => {
    const mark = events.length;
    await send_keys("gg");
    await sleep(700);
    expect(whichkey_events(mark, "wk").length === 0, "a panel showed for a finished sequence");
  });

  await run_case("g? opens the help page", async () => {
    const help_tab_count = `(async () => (await browser.tabs.query({})).filter((tab) => tab.url.endsWith("/help.html")).length)()`;
    const before = await evaluate_in_background(rdp, extension_id, help_tab_count);
    await send_keys("g?");
    await sleep(1000);
    const after = await evaluate_in_background(rdp, extension_id, help_tab_count);
    expect(after === before + 1, `help tabs went from ${before} to ${after}`);
    await evaluate_in_background(rdp, extension_id, `(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.endsWith("/help.html")) await browser.tabs.remove(tab.id); })()`);
    await sleep(500);
  });
}
