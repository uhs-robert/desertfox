// Key test cases of the help sidebar groups. run.mjs calls run_cases with its helpers.
// Set DESERTFOX_SHOT_DIR to save a shot of the sidebar with Commands open and one with Quick Start open.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["help"];

export async function run_cases({ run_case, press_keys, poll_until, rdp, extension_id, take_shot, expect, sleep }) {
  const view = `(browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.pathname === "/home.html"))`;
  const in_help = (code) => evaluate_in_background(rdp, extension_id, `(() => { const view = ${view}; ${code} })()`);
  const close_help_tabs = () => evaluate_in_background(rdp, extension_id, `(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes("/home.html")) await browser.tabs.remove(tab.id); })()`);
  const group_state = (page_title) => in_help(`
    const row = [...view.document.querySelectorAll(".desertfox-help-nav-row")].find((candidate) => candidate.querySelector("a").textContent === ${JSON.stringify(page_title)});
    const list = row.nextElementSibling;
    return { open: !list.hidden, expanded: row.querySelector("button").getAttribute("aria-expanded"), links: list.children.length };
  `);
  const click = (selector_code) => in_help(`${selector_code}.click();`);
  // Two frames later, a rebuild that a click queued has run, so a value that should have been kept can be read.
  const after_render = () => evaluate_in_background(rdp, extension_id, `(async () => { const view = ${view}; await new Promise((resolve) => view.requestAnimationFrame(() => view.requestAnimationFrame(resolve))); })()`);
  const shot = async (name) => {
    if (!process.env.DESERTFOX_SHOT_DIR) return;
    await sleep(300);
    await take_shot(`${process.env.DESERTFOX_SHOT_DIR}/${name}.png`);
  };

  await run_case("help sidebar: a menu entry opens its group and a child link scrolls to its section", async () => {
    await close_help_tabs();
    await press_keys("qh");
    await poll_until("the help page to render", () => in_help(`return !!view && !!view.document.querySelector("h1");`).catch(() => false), { timeout_ms: 10000 });

    const entry = (title) => `[...view.document.querySelectorAll(".desertfox-help-nav-row a")].find((link) => link.textContent === ${JSON.stringify(title)})`;
    await click(entry("Commands"));
    await poll_until("the Commands group to open", async () => (await group_state("Commands")).open);
    const commands = await group_state("Commands");
    expect(commands.open && commands.expanded === "true" && commands.links > 10, `the Commands group after the click was ${JSON.stringify(commands)}`);
    const settings = await group_state("Settings");
    expect(!settings.open, "the Settings group stayed open on the Commands page");
    await shot("help-sidebar-commands");

    await click(`view.document.querySelector(".desertfox-help-sections:not([hidden]) a[href$='/tab']")`);
    await poll_until("the tab group heading to take the focus and scroll into place", async () => (await in_help(`return view.scrollY > 0 && view.document.activeElement === view.document.getElementById("commands-tab");`)) === true);
    const at_tab = await in_help(`const heading = view.document.getElementById("commands-tab"); return { y: view.scrollY, top: Math.round(heading.getBoundingClientRect().top), focused: view.document.activeElement === heading };`);
    expect(at_tab.y > 0 && at_tab.top < 200 && at_tab.focused, `the tab group heading was not reached: ${JSON.stringify(at_tab)}`);

    await click(entry("Quick Start"));
    await poll_until("the Quick Start group to open", async () => (await group_state("Quick Start")).open);
    // A short window makes the sidebar overflow. The rule sits in a style element because a rebuild drops inline styles.
    const scrolled = await in_help(`const style = view.document.createElement("style"); style.id = "scroll-case"; style.textContent = ".desertfox-help-sidebar { height: 200px !important; }"; view.document.head.append(style); const bar = view.document.querySelector(".desertfox-help-sidebar"); bar.scrollTop = 60; return bar.scrollTop;`);
    expect(scrolled > 0, `the sidebar did not scroll: ${scrolled}`);
    await click(`view.document.querySelector(".desertfox-help-sections:not([hidden]) a")`);
    await after_render();
    const kept = await in_help(`return view.document.querySelector(".desertfox-help-sidebar").scrollTop;`);
    expect(kept === scrolled, `the sidebar scroll went from ${scrolled} to ${kept} after a section link`);
    await in_help(`view.document.getElementById("scroll-case").remove();`);
    const quick_start = await group_state("Quick Start");
    expect(quick_start.open && quick_start.expanded === "true" && quick_start.links > 0, `the Quick Start group after the click was ${JSON.stringify(quick_start)}`);
    expect(!(await group_state("Commands")).open, "the Commands group stayed open on the Quick Start page");
    await shot("help-sidebar-quick-start");

    await click(`view.document.querySelector(".desertfox-help-nav-row button[aria-expanded='false']")`);
    await poll_until("the Settings group to open", async () => (await group_state("Settings")).open).catch(() => undefined);
    expect((await group_state("Settings")).open, "the Settings chevron did not open its group");
    expect((await group_state("Quick Start")).open, "opening Settings closed the Quick Start group");
    await close_help_tabs();
  });
}
