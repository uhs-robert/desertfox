// The arrow mode (Alt+l): hjkl act as arrows on the focused control, Escape ends it and reaches the page once, and only Escape, Alt+l and a focus move into a field end it. Alt+l also starts it from a text field and from caret mode. The /arrow_widgets page records what its own scripts saw in data attributes.
export const areas = ["keys", "scroll", "ui"];

import { ALT } from "./harness.mjs";

export async function run_cases({ run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  async function expect_badge(label) {
    let seen;
    await poll_until(`the ${label} badge`, async () => (seen = await badge()) === label, { timeout_ms: 3000, expected_timeout: true }).catch(() => expect(false, `the badge is ${seen}, expected ${label}`));
  }
  const dataset = (name) => in_active_tab(`document.documentElement.dataset.${name}`);
  const focus = (id) => in_active_tab(`document.getElementById(${JSON.stringify(id)}).focus(); 0`);
  const value = (id, prop = "value") => in_active_tab(`String(document.getElementById(${JSON.stringify(id)}).${prop})`);
  async function expect_value(id, wanted, prop) {
    await poll_until(`${id} to read ${wanted}`, async () => (await value(id, prop)) === wanted, { timeout_ms: 3000, expected_timeout: true }).catch(async () => expect(false, `${id} reads ${await value(id, prop)}, expected ${wanted}`));
  }
  const open_widgets = (id) => open_page("arrow_widgets", `arrow_${id}`, { new_tab: true });

  await run_case("Alt+l starts the mode with the ARROW badge and Alt+l ends it", async () => {
    await open_widgets("toggle");
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await press_keys(...ALT("l"));
    await expect_badge("NORMAL");
  });

  await run_case("on a select, j and k move the value over the disabled option and fire change", async () => {
    await open_widgets("select");
    await focus("sel");
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await press_keys("j");
    await expect_value("sel", "c");
    await press_keys("k");
    await expect_value("sel", "a");
    expect((await dataset("changes")) === "sel,sel,", `change events: ${await dataset("changes")}`);
    await expect_badge("ARROW");
  });

  await run_case("on a range, l steps up and h steps down", async () => {
    await open_widgets("range");
    await focus("rng");
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await press_keys("ll");
    await expect_value("rng", "7");
    await press_keys("h");
    await expect_value("rng", "6");
  });

  await run_case("on a radio, j clicks the next radio of the group, so a page that listens to click sees it", async () => {
    await open_widgets("radio");
    await focus("r1");
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await press_keys("j");
    await expect_value("r2", "true", "checked");
    expect((await in_active_tab(`document.activeElement.id`)) === "r2", "the focus did not follow the check");
    expect((await dataset("changes")) === "r2,", `change events: ${await dataset("changes")}`);
    expect((await dataset("clicks")) === "r2,", `click events: ${await dataset("clicks")}`);
  });

  await run_case("on a select inside a shadow root, j moves the inner select", async () => {
    await open_widgets("shadow");
    await in_active_tab(`document.getElementById("shadow_host").shadowRoot.getElementById("inner_sel").focus(); 0`);
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await press_keys("j");
    await poll_until("the inner select to move", async () => (await in_active_tab(`document.getElementById("shadow_host").shadowRoot.getElementById("inner_sel").value`)) === "y", { timeout_ms: 3000, expected_timeout: true }).catch(() => expect(false, "the inner select did not move"));
  });

  await run_case("on a script widget, j sends an ArrowDown keydown the page reads", async () => {
    await open_widgets("script");
    await focus("list");
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await press_keys("jk");
    await poll_until("the listbox to see both arrows", async () => (await dataset("keys")) === "ArrowDown,ArrowUp,", { timeout_ms: 3000, expected_timeout: true }).catch(async () => expect(false, `the listbox saw ${await dataset("keys")}`));
  });

  await run_case("with nothing focused, j scrolls the page", async () => {
    await open_widgets("scroll");
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await press_keys("j");
    await poll_until("the page to scroll", async () => (await in_active_tab(`scrollY`)) > 0, { timeout_ms: 3000, expected_timeout: true }).catch(() => expect(false, "j did not scroll"));
    expect((await dataset("keys")) === "", "a key reached the page");
  });

  await run_case("Escape ends the mode and the page sees exactly one Escape", async () => {
    await open_widgets("escape");
    await focus("list");
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await sleep(300);
    expect((await dataset("escapes")) === "1", `the page saw ${await dataset("escapes")} Escape keydowns`);
    await press_keys("j");
    await sleep(200);
    expect((await dataset("keys")) === "", "j sent an arrow after the mode ended");
  });

  await run_case("a mouse press and a key DesertFox does not cancel leave the mode on", async () => {
    await open_widgets("sticky");
    await focus("list");
    await press_keys(...ALT("l"));
    await in_active_tab(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0`);
    await press_keys("-k", "F9");
    await expect_badge("ARROW");
    await press_keys("j");
    await poll_until("j to still send an arrow", async () => (await dataset("keys")) === "ArrowDown,", { timeout_ms: 3000, expected_timeout: true }).catch(async () => expect(false, `the listbox saw ${await dataset("keys")}`));
  });

  await run_case("focus moving into a text field ends the mode, and hjkl type there", async () => {
    await open_widgets("field");
    await focus("list");
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await focus("field");
    await expect_badge("INSERT");
    await press_keys("hjklL");
    await expect_value("field", "hjklL");
    expect((await dataset("keys")) === "", "a typed key reached the listbox");
    expect((await dataset("changes")) === "", "a typed key changed a control");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await press_keys("j");
    await sleep(200);
    expect((await dataset("keys")) === "", "the mode came back with the focus leaving the field");
  });

  await run_case("Alt+l from a text field blurs the field and starts the mode, and j then acts as an arrow", async () => {
    await open_widgets("from_field");
    await focus("field");
    await expect_badge("INSERT");
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    expect((await in_active_tab(`document.activeElement === document.body`)) === true, "the field kept the focus");
    expect((await value("field")) === "", "Alt+l typed into the field");
    await focus("list");
    await press_keys("j");
    await poll_until("j to send an arrow", async () => (await dataset("keys")) === "ArrowDown,", { timeout_ms: 3000, expected_timeout: true }).catch(async () => expect(false, `the listbox saw ${await dataset("keys")}`));
  });

  await run_case("Alt+l from caret mode leaves it and starts the mode, and Alt+l again ends it", async () => {
    await open_widgets("from_caret");
    await press_keys("v");
    await expect_badge("CARET");
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await press_keys(...ALT("l"));
    await expect_badge("NORMAL");
  });

  await run_case("a new page starts with the mode off", async () => {
    await open_widgets("nav_a");
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await open_page("arrow_widgets", "arrow_nav_b", { new_tab: false });
    await expect_badge("NORMAL");
    await focus("list");
    await press_keys("j");
    await sleep(200);
    expect((await dataset("keys")) === "", "the old mode sent an arrow on the new page");
  });

  await run_case("switching tabs and back keeps the mode: the badge says ARROW and j still sends an arrow", async () => {
    await open_widgets("tabs_a");
    await focus("list");
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await open_widgets("tabs_b");
    await expect_badge("NORMAL");
    await press_keys("gT");
    await poll_until("the first tab to be active", async () => (await in_active_tab(`location.search`)).includes("arrow_tabs_a"), { timeout_ms: 3000, expected_timeout: true });
    await expect_badge("ARROW");
    await press_keys("j");
    await poll_until("j to send an arrow", async () => (await dataset("keys")) === "ArrowDown,", { timeout_ms: 3000, expected_timeout: true }).catch(async () => expect(false, `the listbox saw ${await dataset("keys")}`));
  });

  await run_case("focus moving into a frame shows FRAME, and back on the top page the mode is still on", async () => {
    await open_page("frames", "arrow_frames", { new_tab: true });
    await in_active_tab(`{ const list = document.body.appendChild(document.createElement("div")); list.id = "list"; list.tabIndex = 0; document.documentElement.dataset.keys = ""; list.addEventListener("keydown", (event) => { if (event.key.startsWith("Arrow")) document.documentElement.dataset.keys += event.key + ","; }); list.focus(); }`);
    await press_keys(...ALT("l"));
    await expect_badge("ARROW");
    await in_active_tab(`document.getElementById("same").contentWindow.focus(); 0`);
    await expect_badge("FRAME");
    await in_active_tab(`document.getElementById("same").contentWindow.blur(); window.focus(); document.getElementById("list").focus(); 0`);
    await expect_badge("ARROW");
    await press_keys("j");
    await poll_until("j to send an arrow", async () => (await dataset("keys")) === "ArrowDown,", { timeout_ms: 3000, expected_timeout: true }).catch(async () => expect(false, `the listbox saw ${await dataset("keys")}`));
  });
}
