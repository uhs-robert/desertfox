// Key test cases of the settings page: change, reset, and a refresh from a write the page did not make.
// Set DESERTFOX_SHOT_DIR to save a shot of the page.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["help", "config"];

export async function run_cases({ run_case, poll_until, rdp, extension_id, take_shot, expect, sleep }) {
  const view = `(browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.pathname === "/home.html" && candidate.location.hash === "#/settings"))`;
  const in_page = (code) => evaluate_in_background(rdp, extension_id, `(() => { const view = ${view}; ${code} })()`);
  const in_background = (code) => evaluate_in_background(rdp, extension_id, code);
  const close_tabs = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes("/home.html")) await browser.tabs.remove(tab.id); })()`);
  const row = (name, code) => `const row = view.document.querySelector('[data-setting="${name}"]'); ${code}`;
  const tag_of = (name) => in_page(row(name, `return row.querySelector(".desertfox-help-badge").textContent;`));
  const saved = () => in_background(`browser.storage.local.get("desertfox_saved_settings").then((got) => got.desertfox_saved_settings ?? {})`);

  await run_case("settings page: a select change saves, reset returns to the file value, another write refreshes the row", async () => {
    await close_tabs();
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/settings") }).then(() => true)`);
    await poll_until("the settings page to list the settings", () => in_page(`return !!view && view.document.querySelectorAll("[data-setting]").length > 20;`).catch(() => false), { timeout_ms: 10000 });
    if (process.env.DESERTFOX_SHOT_DIR) { await sleep(300); await take_shot(`${process.env.DESERTFOX_SHOT_DIR}/settings-page.png`); }

    await in_page(row("which_key_border", `const select = row.querySelector("select"); select.selectedIndex = 1; select.dispatchEvent(new view.Event("change"));`));
    await poll_until("the select change to be saved", async () => (await saved()).which_key_border === "round");
    await poll_until("the tag to turn saved", async () => (await tag_of("which_key_border")) === "saved");
    expect((await saved()).which_key_border === "round", `saved layer was ${JSON.stringify(await saved())}`);
    expect((await tag_of("which_key_border")) === "saved", "the tag did not turn saved");

    await in_page(row("which_key_border", `row.querySelector(".desertfox-settings-reset").click();`));
    await poll_until("the reset to clear the saved edit", async () => (await saved()).which_key_border === undefined);
    await poll_until("the tag to leave saved", async () => (await tag_of("which_key_border")) !== "saved");
    expect((await saved()).which_key_border === undefined, "reset left the saved edit");
    expect((await tag_of("which_key_border")) !== "saved", "the tag stayed saved after reset");

    // A second extension page sends the same message the page does, as a `:set` in another tab would. It ends with a write of the config status, which is what the page listens for.
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/quick-start") }).then(() => true)`);
    await poll_until("the quick start page to load", () => in_background(`(() => { const other = browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.hash === "#/quick-start"); return other?.document.readyState === "complete"; })()`).catch(() => false));
    await in_background(`(() => { const other = browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.hash === "#/quick-start"); return other.browser.runtime.sendMessage({ type: "change_setting", name: "newtab_date", action: "set", value: false }).then((answer) => answer.ok); })()`);
    const read_shown = () => in_page(row("newtab_date", `return { checked: row.querySelector("input").checked, tag: row.querySelector(".desertfox-help-badge").textContent };`));
    await poll_until("the settings page to refresh the row", async () => (await read_shown()).tag === "saved").catch(() => undefined);
    const shown = await read_shown();
    expect(shown.checked === false && shown.tag === "saved", `another write showed ${JSON.stringify(shown)}`);
    await in_background(`(() => { const other = browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.hash === "#/quick-start"); return other.browser.runtime.sendMessage({ type: "change_setting", name: "newtab_date", action: "reset" }).then((answer) => answer.ok); })()`);
    await close_tabs();
  });
}
