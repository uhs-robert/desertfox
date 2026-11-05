// Key test cases of the help sidebar groups. run.mjs calls run_cases with its helpers.
// Set OASISFOX_SHOT_DIR to save a shot of the sidebar with Commands open and one with Quick Start open.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ run_case, send_keys, rdp, extension_id, take_shot, expect, sleep }) {
  const view = `(browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.pathname === "/help.html"))`;
  const in_help = (code) => evaluate_in_background(rdp, extension_id, `(() => { const view = ${view}; ${code} })()`);
  const close_help_tabs = () => evaluate_in_background(rdp, extension_id, `(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes("/help.html")) await browser.tabs.remove(tab.id); })()`);
  const group_state = (page_title) => in_help(`
    const row = [...view.document.querySelectorAll(".oasisfox-help-nav-row")].find((candidate) => candidate.querySelector("a").textContent === ${JSON.stringify(page_title)});
    const list = row.nextElementSibling;
    return { open: !list.hidden, expanded: row.querySelector("button").getAttribute("aria-expanded"), links: list.children.length };
  `);
  const click = (selector_code) => in_help(`${selector_code}.click();`);
  const shot = async (name) => {
    if (!process.env.OASISFOX_SHOT_DIR) return;
    await sleep(300);
    await take_shot(`${process.env.OASISFOX_SHOT_DIR}/${name}.png`);
  };

  await run_case("help sidebar: a menu entry opens its group and a child link scrolls to its section", async () => {
    await close_help_tabs();
    await send_keys("qh");
    let ready;
    for (let attempt = 0; attempt < 40 && !ready; attempt++) {
      await sleep(250);
      ready = await in_help(`return !!view && !!view.document.querySelector("h1");`).catch(() => false);
    }
    expect(ready, "the help page never rendered");

    const entry = (title) => `[...view.document.querySelectorAll(".oasisfox-help-nav-row a")].find((link) => link.textContent === ${JSON.stringify(title)})`;
    await click(entry("Commands"));
    await sleep(600);
    const commands = await group_state("Commands");
    expect(commands.open && commands.expanded === "true" && commands.links > 10, `the Commands group after the click was ${JSON.stringify(commands)}`);
    const home = await group_state("Home");
    expect(!home.open, "the Home group stayed open on the Commands page");
    await shot("help-sidebar-commands");

    await click(`view.document.querySelector(".oasisfox-help-sections:not([hidden]) a[href$='/tab']")`);
    await sleep(600);
    const at_tab = await in_help(`const heading = view.document.getElementById("commands-tab"); return { y: view.scrollY, top: Math.round(heading.getBoundingClientRect().top), focused: view.document.activeElement === heading };`);
    expect(at_tab.y > 0 && at_tab.top < 200 && at_tab.focused, `the tab group heading was not reached: ${JSON.stringify(at_tab)}`);

    await click(entry("Quick Start"));
    await sleep(600);
    const quick_start = await group_state("Quick Start");
    expect(quick_start.open && quick_start.expanded === "true" && quick_start.links > 0, `the Quick Start group after the click was ${JSON.stringify(quick_start)}`);
    expect(!(await group_state("Commands")).open, "the Commands group stayed open on the Quick Start page");
    await shot("help-sidebar-quick-start");

    await click(`view.document.querySelector(".oasisfox-help-nav-row button[aria-expanded='false']")`);
    await sleep(200);
    expect((await group_state("Home")).open, "the Home chevron did not open its group");
    expect((await group_state("Quick Start")).open, "opening Home closed the Quick Start group");
    await close_help_tabs();
  });
}
