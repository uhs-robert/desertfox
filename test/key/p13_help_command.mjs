// Key test case of `:help <name>`. run.mjs calls run_cases with its helpers.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["help", "cmdline"];

export async function run_cases({ run_case, press_keys, poll_until, wait_tab_quiet, wait_cmdline, rdp, extension_id, open_page, expect, extension_view, in_background, run_line }) {
  const help_urls = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({})).map((tab) => tab.url).filter((url) => url.includes("/home.html")))()`);
  const close_help_tabs = () => evaluate_in_background(rdp, extension_id, `(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes("/home.html")) await browser.tabs.remove(tab.id); })()`);
  const help_tab_id = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({})).find((tab) => tab.url.includes("/home.html"))?.id)()`);
  const tab_count = () => evaluate_in_background(rdp, extension_id, `(async () => (await browser.tabs.query({})).length)()`);
  const is_help_at_card = (urls) => urls.length === 1 && urls[0].endsWith("/home.html#command=scroll.to");
  // The help page is an extension page, so its content script reports no event. Its tree attribute and focus say that keys can reach it.
  const help_page_takes_keys = () => in_background(`(() => { const view = ${extension_view("home.html")}; return Boolean(view?.document.documentElement.hasAttribute("data-desertfox-tree-read-ms") && view.document.hasFocus()); })()`);

  await run_case("`:help scroll.to` opens the help page at that command's card", async () => {
    await close_help_tabs();
    await open_page("page", "p13_help", { new_tab: true });
    await run_line(":help scroll.to");
    await poll_until("the help tab at the scroll.to card", async () => is_help_at_card(await help_urls()), { timeout_ms: 8000 });
    await close_help_tabs();
  });

  await run_case("`:help <command>` on the help page keeps the tab count and shows the card", async () => {
    await close_help_tabs();
    await open_page("page", "p13_help", { new_tab: true });
    await run_line(":help");
    await poll_until("the help tab to take keys", help_page_takes_keys, { timeout_ms: 8000 });
    await wait_tab_quiet(await help_tab_id());
    const before = await tab_count();
    await run_line(":help scroll.to");
    await poll_until("the help tab at the scroll.to card", async () => is_help_at_card(await help_urls()), { timeout_ms: 8000 });
    // A second tab that opened late would show here, since the poll above could pass before it.
    await wait_cmdline((line) => !line.open, "the command line to close");
    const urls = await help_urls();
    expect(is_help_at_card(urls), `the help tabs were ${JSON.stringify(urls)}`);
    expect((await tab_count()) === before, "the tab count changed");
    await close_help_tabs();
  });
}
