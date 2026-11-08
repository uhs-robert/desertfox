// Key test case of `:help <name>`. run.mjs calls run_cases with its helpers.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["help", "cmdline"];

export async function run_cases({ run_case, send_keys, rdp, extension_id, open_page, expect, sleep }) {
  const help_urls = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({})).map((tab) => tab.url).filter((url) => url.includes("/home.html")))()`);
  const close_help_tabs = () => evaluate_in_background(rdp, extension_id, `(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes("/home.html")) await browser.tabs.remove(tab.id); })()`);

  await run_case("`:help scroll.to` opens the help page at that command's card", async () => {
    await close_help_tabs();
    await open_page("page", "p13_help", { new_tab: true });
    // Escape twice leaves the address bar if the load kept the focus there.
    await send_keys("-k", "Escape", "-k", "Escape");
    await sleep(500);
    await send_keys(":help scroll.to", "-k", "Return");
    await sleep(1500);
    const urls = await help_urls();
    expect(urls.length === 1 && urls[0].endsWith("/home.html#command=scroll.to"), `the help tabs were ${JSON.stringify(urls)}`);
    await close_help_tabs();
  });

  await run_case("`:help <command>` on the help page keeps the tab count and shows the card", async () => {
    await close_help_tabs();
    await open_page("page", "p13_help", { new_tab: true });
    await send_keys("-k", "Escape", "-k", "Escape");
    await sleep(500);
    await send_keys(":help", "-k", "Return");
    await sleep(1500);
    const tab_count = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({})).length)()`);
    const before = await tab_count();
    await send_keys(":help scroll.to", "-k", "Return");
    await sleep(1500);
    const urls = await help_urls();
    expect(urls.length === 1 && urls[0].endsWith("/home.html#command=scroll.to"), `the help tabs were ${JSON.stringify(urls)}`);
    expect((await tab_count()) === before, "the tab count changed");
    await close_help_tabs();
  });
}
