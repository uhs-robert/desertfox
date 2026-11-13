// Key test cases of the settings page: change, reset, and a refresh from a write the page did not make.
// Set DESERTFOX_SHOT_DIR to save a shot of the page.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["help", "config"];

export async function run_cases({ run_case, press_keys, poll_until, rdp, extension_id, take_shot, expect, sleep }) {
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
    await poll_until("the tag to turn changed", async () => (await tag_of("which_key_border")) === "changed");
    expect((await saved()).which_key_border === "round", `saved layer was ${JSON.stringify(await saved())}`);
    expect((await tag_of("which_key_border")) === "changed", "the tag did not turn changed");

    await in_page(row("which_key_border", `row.querySelector(".desertfox-settings-reset").click();`));
    await poll_until("the reset to clear the saved edit", async () => (await saved()).which_key_border === undefined);
    await poll_until("the tag to leave changed", async () => (await tag_of("which_key_border")) !== "changed");
    expect((await saved()).which_key_border === undefined, "reset left the saved edit");
    expect((await tag_of("which_key_border")) !== "changed", "the tag stayed changed after reset");

    // A second extension page sends the same message the page does, as a `:set` in another tab would. It ends with a write of the config status, which is what the page listens for.
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/quick-start") }).then(() => true)`);
    await poll_until("the quick start page to load", () => in_background(`(() => { const other = browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.hash === "#/quick-start"); return other?.document.readyState === "complete"; })()`).catch(() => false));
    await in_background(`(() => { const other = browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.hash === "#/quick-start"); return other.browser.runtime.sendMessage({ type: "change_setting", name: "newtab_date", action: "set", value: false }).then((answer) => answer.ok); })()`);
    const read_shown = () => in_page(row("newtab_date", `return { checked: row.querySelector("input").checked, tag: row.querySelector(".desertfox-help-badge").textContent };`));
    await poll_until("the settings page to refresh the row", async () => (await read_shown()).tag === "changed").catch(() => undefined);
    const shown = await read_shown();
    expect(shown.checked === false && shown.tag === "changed", `another write showed ${JSON.stringify(shown)}`);
    await in_background(`(() => { const other = browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.hash === "#/quick-start"); return other.browser.runtime.sendMessage({ type: "change_setting", name: "newtab_date", action: "reset" }).then((answer) => answer.ok); })()`);
    await close_tabs();
  });

  await run_case("settings page: the changed-only filter hides unchanged rows and empty groups and keeps the forms", async () => {
    await close_tabs();
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/settings") }).then(() => true)`);
    await poll_until("the settings page to list the settings", () => in_page(`return !!view && view.document.querySelectorAll("[data-setting]").length > 20;`).catch(() => false), { timeout_ms: 10000 });
    const shown = (selector) => in_page(`const node = view.document.querySelector(${JSON.stringify(selector)}); return !!node && view.getComputedStyle(node).display !== "none";`);
    const none_line = ".desertfox-settings-none-changed";
    await in_page(`view.document.querySelector(".desertfox-only-changed-toggle").click();`);
    // Whatever the file or an earlier case changed, the CSS must follow the rows' own data-changed.
    const state = await in_page(`const hidden = (node) => view.getComputedStyle(node).display === "none";
      const rows = [...view.document.querySelectorAll(".desertfox-settings-row")];
      const sections = [...view.document.querySelectorAll(".desertfox-settings-section")];
      return { rows: rows.every((node) => hidden(node) === (node.getAttribute("data-changed") === "false")), sections: sections.every((node) => hidden(node) === !node.querySelector('[data-changed="true"]')), none_line: !hidden(view.document.querySelector(${JSON.stringify(none_line)})), any_changed: rows.some((node) => node.getAttribute("data-changed") === "true") };`);
    expect(state.rows, "a row's visibility did not follow data-changed");
    expect(state.sections, "a group's visibility did not follow its changed rows");
    expect(state.none_line === !state.any_changed, "the none-changed line did not match the rows");
    expect(await shown(".desertfox-keys"), "the Keys form was hidden by the filter");
    await in_page(row("which_key_border", `const select = row.querySelector("select"); select.selectedIndex = 1; select.dispatchEvent(new view.Event("change"));`));
    await poll_until("the changed row to show", async () => await shown('[data-setting="which_key_border"]'));
    await in_page(row("which_key_border", `row.querySelector(".desertfox-settings-reset").click();`));
    await poll_until("the reset row to hide", async () => !(await shown('[data-setting="which_key_border"]')));
    await close_tabs();
  });

  // The page is a tab of its own, so the hash changes under the first finder.
  const any_view = `(browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.pathname === "/home.html"))`;
  const in_any = (code) => evaluate_in_background(rdp, extension_id, `(() => { const view = ${any_view}; ${code} })()`);
  const reached = (slug) => in_any(`
    const heading = view.document.getElementById("settings-${slug}");
    if (!heading) return "no heading";
    const top = Math.round(heading.getBoundingClientRect().top);
    // Closed Advanced leaves Quickmarks last on the page, with no room below to reach the top half.
    return top >= 0 && top < (${JSON.stringify(slug === "quickmarks")} ? view.innerHeight : view.innerHeight / 2) && view.document.activeElement === heading ? "reached" : "heading at " + top + " of " + view.innerHeight;
  `);
  const section_slugs = () => in_any(`return [...view.document.querySelectorAll(".desertfox-help-sections:not([hidden]) a")].map((link) => decodeURIComponent(link.getAttribute("href").split("/")[1]));`);
  // The heading must be reached once the page is full, so a poll on the state replaces a fixed wait.
  const settle_on = async (slug) => {
    await poll_until(`the ${slug} heading to be reached`, async () => (await reached(slug)) === "reached", { timeout_ms: 3000 }).catch(() => undefined);
    return reached(slug);
  };
  const open_fresh = async (slug) => {
    await close_tabs();
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#section=settings/${slug}") }).then(() => true)`);
    await poll_until("the settings page to list the settings", () => in_any(`return !!view && view.document.querySelectorAll("[data-setting]").length > 20;`).catch(() => false), { timeout_ms: 10000 });
  };
  const scroll_y = () => in_any(`return Math.round(view.scrollY);`);
  // A box that grows resizes the page body, which is what pulls a held heading back into view.
  const grow_page = () => in_any(`const filler = view.document.createElement("div"); filler.style.height = "40px"; view.document.querySelector(".desertfox-help-page").append(filler); return new Promise((resolve) => view.requestAnimationFrame(() => view.requestAnimationFrame(resolve)));`);

  await run_case("settings page: every sidebar section link reaches its heading, from a click and from a fresh load", async () => {
    await close_tabs();
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/settings") }).then(() => true)`);
    await poll_until("the settings page to list the settings", () => in_any(`return !!view && view.document.querySelectorAll("[data-setting]").length > 20;`).catch(() => false), { timeout_ms: 10000 });
    const slugs = await section_slugs();
    expect(slugs.length > 3 && slugs[0] === "appearance", `the sidebar listed ${JSON.stringify(slugs)}`);
    const failures = [];
    for (const slug of slugs) {
      await in_any(`view.scrollTo(0, 0); view.document.querySelector(".desertfox-help-sections:not([hidden]) a[href$='/${slug}']").click();`);
      const state = await settle_on(slug);
      if (state !== "reached") failures.push(`${slug}: ${state}`);
    }
    expect(failures.length === 0, `links that missed their heading: ${failures.join("; ")}`);

    // The same link again, after the reader scrolled away, fires no hashchange.
    await in_any(`view.scrollTo(0, 0);`);
    await in_any(`view.document.querySelector(".desertfox-help-sections:not([hidden]) a[href$='/${slugs.at(-1)}']").click();`);
    const same_hash = await settle_on(slugs.at(-1));
    expect(same_hash === "reached", `the same-hash click ended at ${same_hash}`);

    const fresh_failures = [];
    for (const slug of slugs) {
      await open_fresh(slug);
      const state = await settle_on(slug);
      if (state !== "reached") fresh_failures.push(`${slug}: ${state}`);
    }
    expect(fresh_failures.length === 0, `fresh loads that missed their heading: ${fresh_failures.join("; ")}`);
    await close_tabs();
  });

  await run_case("settings page: a reader who scrolls during the load is not pulled back to the heading", async () => {
    // The hold lasts 5 s from the render, so each step below runs inside it.
    await open_fresh("new-tab");
    await in_any(`view.dispatchEvent(new view.WheelEvent("wheel")); view.scrollTo(0, 0);`);
    await grow_page();
    const after_wheel = await scroll_y();
    expect(after_wheel === 0, `a wheel scroll was pulled back to ${after_wheel}`);

    await open_fresh("new-tab");
    const before_key = await scroll_y();
    await press_keys("j");
    await poll_until("the j key to move the page", async () => (await scroll_y()) !== before_key, { timeout_ms: 3000 });
    // The page's clock starts at its load, so under 4 s on it means the 5 s hold was still running when j scrolled.
    const key_at_ms = await in_any(`return Math.round(view.performance.now());`);
    expect(key_at_ms < 4000, `the j key scrolled ${key_at_ms} ms after the page loaded, so the hold may have ended already`);
    // The key scrolls smoothly, so the position is read once two reads a frame pair apart agree.
    const settled_y = () => in_any(`return new Promise((resolve) => { const first = view.scrollY; view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve(first === view.scrollY ? Math.round(first) : -1))); });`);
    await poll_until("the key scroll to stop", async () => (await settled_y()) >= 0, { timeout_ms: 3000 });
    const after_key = await settled_y();
    await grow_page();
    const after_growth = await settled_y();
    expect(after_growth === after_key, `a bound key scroll went from ${after_key} to ${after_growth} after the page grew`);
    await close_tabs();
  });
}
