// Key test cases of the Keys section on the settings page: real presses fill the capture box and the content script stays out of it,
// a rebound key runs in an open tab at once, Remove and Reset, browser chords are captured and do not fire, and the export carries the edits.
// Set DESERTFOX_SHOT_DIR to save a shot of the editor.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["help", "config", "keys"];

const ALT = (key) => ["-M", "alt", key, "-m", "alt"];

export async function run_cases({ run_case, open_page, press_keys, poll_until, rdp, extension_id, expect, on_teardown, wait_active_tab, scroll_delta_by_press, take_shot, sleep }) {
  const view = `(browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.pathname === "/home.html" && candidate.location.hash === "#/settings"))`;
  const in_page = (code) => evaluate_in_background(rdp, extension_id, `(() => { const view = ${view}; ${code} })()`);
  const in_background = (code) => evaluate_in_background(rdp, extension_id, code);
  const close_settings_tabs = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes("/home.html")) await browser.tabs.remove(tab.id); })()`);
  const layer = () => in_background(`browser.storage.local.get("desertfox_keymap_edits").then((got) => got.desertfox_keymap_edits ?? {})`);
  // The row's Edit button, found by its accessible name. \`.closest("tr")\` gives the row.
  const row_of = (mode, keys) => `view.document.querySelector(${JSON.stringify(`[aria-label="Edit ${keys} in ${mode} mode"]`)})`;
  const shown_keys = () => in_page(`return [...view.document.querySelectorAll(".desertfox-keys-capture kbd")].map((kbd) => kbd.textContent);`);
  const capture_focused = () => in_page(`return view.document.hasFocus() && view.document.activeElement === view.document.querySelector('.desertfox-keys-capture');`);

  // Key edits are stored state, and a failed case can leave some. The reset goes through the background's own message, so the compiled keymap follows the stored layer.
  const reset_edits = () => in_page(`return view.browser.storage.local.get("desertfox_keymap_edits").then(async (got) => { for (const [mode, table] of Object.entries(got.desertfox_keymap_edits ?? {})) for (const keys of Object.keys(table)) await view.browser.runtime.sendMessage({ type: "change_keymap", mode, keys, action: "reset" }); return true; });`);
  on_teardown(async () => {
    if (Object.keys(await layer()).length > 0) {
      await open_settings();
      await reset_edits();
    }
    await in_background(`(async () => { await browser.storage.local.remove("desertfox_disabled"); })()`);
    await close_settings_tabs();
  });

  async function open_settings() {
    await close_settings_tabs();
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/settings"), active: true }).then(() => true)`);
    await poll_until("the Keys section to list the bindings", () => in_page(`return !!view && view.document.querySelectorAll(".desertfox-keys-row").length > 20;`).catch(() => false), { timeout_ms: 10000 });
  }

  async function focus_capture(mode, keys) {
    if (keys === undefined) await in_page(`view.document.querySelector('[aria-label="Add a binding in ${mode} mode"]').click();`);
    else await in_page(`${row_of(mode, keys)}.click();`);
    await poll_until("the editor to open", () => in_page(`return !!view.document.querySelector('.desertfox-keys-editor')?.isConnected;`).catch(() => false));
    await in_page(`view.document.querySelector('.desertfox-keys-capture').focus();`);
    await poll_until("the capture box to hold the focus", capture_focused);
  }

  await run_case("keys section: real presses fill the capture box and the content script does not react, Backspace and Escape and Clear edit it", async () => {
    await open_settings();
    await focus_capture("normal");
    const before_y = await in_page(`return view.scrollY;`);
    if (process.env.DESERTFOX_SHOT_DIR) { await sleep(300); await take_shot(`${process.env.DESERTFOX_SHOT_DIR}/keys-editor.png`); }
    // j and gg scroll the page, i enters insert mode and Escape would leave it: none of them may reach the content script.
    await press_keys("j", "g", "g", "i");
    await poll_until("the capture box to show four keys", async () => (await shown_keys()).length === 4);
    expect(JSON.stringify(await shown_keys()) === JSON.stringify(["j", "g", "g", "i"]), `captured ${JSON.stringify(await shown_keys())}`);
    await sleep(300);
    const after = await in_page(`return { y: view.scrollY, focused: view.document.activeElement.classList.contains("desertfox-keys-capture") };`);
    expect(after.y === before_y && after.focused, `the page reacted to a captured key: ${JSON.stringify({ before_y, after })}`);

    await press_keys("-k", "BackSpace");
    await poll_until("Backspace to drop the last key", async () => (await shown_keys()).length === 3);
    await press_keys("-M", "ctrl", "d", "-m", "ctrl");
    await poll_until("Ctrl+d to be captured", async () => (await shown_keys()).at(-1) === "<C-d>");

    await press_keys("-k", "Escape");
    await poll_until("Escape to cancel the capture", async () => !(await capture_focused()) && (await shown_keys()).length === 0);

    await in_page(`view.document.querySelector('.desertfox-keys-capture').focus();`);
    await poll_until("the capture box to take the focus again", capture_focused);
    await press_keys("x");
    await poll_until("x to be captured", async () => (await shown_keys()).length === 1);
    await in_page(`[...view.document.querySelectorAll(".desertfox-keys-editor button")].find((button) => button.textContent === "Clear").click();`);
    await poll_until("Clear to empty the sequence", async () => (await shown_keys()).length === 0);
    // The control: once the box is blurred the page runs its own keys again, so the stillness above was the capture.
    await in_page(`view.document.querySelector('[aria-label="Filter bindings"]').focus(); view.document.activeElement.blur(); view.document.body.focus(); view.scrollTo(0, 0);`);
    await poll_until("the page body to hold the focus", () => in_page(`return view.document.hasFocus() && view.document.activeElement === view.document.body;`));
    await press_keys("G");
    await poll_until("G to scroll the page once the box is blurred", async () => (await in_page(`return view.scrollY;`)) > 0);
    await close_settings_tabs();
  });

  await run_case("keys section: a rebound J runs in an open tab at once, Remove and Reset undo edits", async () => {
    await open_page("page", "p36_j", { new_tab: true });
    const test_tab = await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab.id)`);
    expect((await scroll_delta_by_press("p36_j", ["j"])) > 0, "j did not scroll the test page, so the page cannot show a rebound J");
    await open_settings();
    await in_page(`${row_of("normal", "J")}.click();`);
    await poll_until("the editor to open on J", () => in_page(`return view.document.querySelector('.desertfox-keys-command')?.value === "tab.next";`).catch(() => false));
    await in_page(`const input = view.document.querySelector('.desertfox-keys-command'); input.value = "scroll.pixels --dy=300"; input.dispatchEvent(new view.Event("input"));`);
    await poll_until("the check to allow the save", () => in_page(`return ![...view.document.querySelectorAll(".desertfox-keys-editor button")].find((button) => button.textContent === "Save").disabled && view.document.querySelector('.desertfox-keys-check').textContent.includes("saves");`).catch(() => false));
    await in_page(`[...view.document.querySelectorAll(".desertfox-keys-editor button")].find((button) => button.textContent === "Save").click();`);
    await poll_until("the edit to be stored", async () => (await layer()).normal?.J === "scroll.pixels --dy=300");

    await in_background(`browser.tabs.update(${test_tab}, { active: true }).then(() => true)`);
    await wait_active_tab("p36_j");
    expect((await scroll_delta_by_press("p36_j", ["J"])) > 0, "the rebound J did not scroll the open tab");

    await in_background(`browser.tabs.query({ url: "*://*/*" }).then(() => true)`);
    const settings_tab = await in_background(`browser.tabs.query({}).then((tabs) => tabs.find((tab) => tab.url.includes("/home.html")).id)`);
    await in_background(`browser.tabs.update(${settings_tab}, { active: true }).then(() => true)`);
    await poll_until("the saved row to show its origin", () => in_page(`return ${row_of("normal", "J")}?.closest("tr").textContent.includes("saved");`).catch(() => false));
    await in_page(`${row_of("normal", "J")}.click();`);
    await poll_until("Reset to be offered", () => in_page(`const reset = [...view.document.querySelectorAll(".desertfox-keys-editor button")].find((button) => button.textContent === "Reset"); return !!reset && !reset.hidden && !reset.disabled;`).catch(() => false));
    await in_page(`[...view.document.querySelectorAll(".desertfox-keys-editor button")].find((button) => button.textContent === "Reset").click();`);
    await poll_until("Reset to drop the edit", async () => (await layer()).normal?.J === undefined);

    // Remove unbinds a shipped key with an empty edit, and Reset brings it back.
    await in_page(`${row_of("normal", "K")}.click();`);
    await poll_until("the editor to open on K", () => in_page(`return view.document.querySelector('.desertfox-keys-command')?.value === "tab.prev";`).catch(() => false));
    await in_page(`[...view.document.querySelectorAll(".desertfox-keys-editor button")].find((button) => button.textContent === "Remove").click();`);
    await poll_until("Remove to store the unbind", async () => (await layer()).normal?.K === "");
    await poll_until("Reset to be offered on the unbound row", () => in_page(`const reset = [...view.document.querySelectorAll(".desertfox-keys-editor button")].find((button) => button.textContent === "Reset"); return !!reset && !reset.hidden && !reset.disabled;`).catch(() => false));
    await in_page(`[...view.document.querySelectorAll(".desertfox-keys-editor button")].find((button) => button.textContent === "Reset").click();`);
    await poll_until("Reset to bring K back", async () => (await layer()).normal?.K === undefined);
    await close_settings_tabs();
  });

  await run_case("keys section: a save on other keys moves the binding, Tab leaves the box, Enter saves", async () => {
    await open_settings();
    await in_page(`${row_of("normal", "K")}.click();`);
    await poll_until("the capture box to take the focus on its own when the editor opens", capture_focused);
    // The row's own keys are shown, and the first press replaces them.
    expect(JSON.stringify(await shown_keys()) === JSON.stringify(["K"]), `shown ${JSON.stringify(await shown_keys())}`);
    await press_keys("Q");
    await poll_until("the new key to replace the old", async () => JSON.stringify(await shown_keys()) === JSON.stringify(["Q"]));
    await press_keys("-k", "Tab");
    await poll_until("Tab to leave the box and not be captured", async () => !(await capture_focused()) && (await shown_keys()).length === 1);
    await in_page(`view.document.querySelector('.desertfox-keys-capture').focus();`);
    await poll_until("the box to take the focus again", capture_focused);
    await press_keys("-k", "Return");
    await poll_until("Enter to store the move", async () => (await layer()).normal?.Q === "tab.prev" && (await layer()).normal?.K === "");
    await close_settings_tabs();
  });

  await run_case("keys section: Ctrl+Alt+D and a slot chord are captured and the Firefox shortcut does not fire", async () => {
    // Alt+K is tab.prev: with the test page before the settings tab, a fired chord shows as the active tab leaving the settings page.
    await open_page("page", "p36_chord", { new_tab: true });
    await open_settings();
    const on_settings_tab = () => in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab.url.includes("/home.html"))`);
    const disabled = () => in_background(`browser.storage.local.get("desertfox_disabled").then((got) => got.desertfox_disabled === true)`);
    await focus_capture("browser");
    await press_keys("-M", "ctrl", "-M", "alt", "d", "-m", "alt", "-m", "ctrl");
    await poll_until("Ctrl+Alt+D to be captured", async () => (await shown_keys()).length === 1);
    await press_keys(...ALT("k"));
    await poll_until("the slot chord to be captured", async () => (await shown_keys()).length === 2);
    expect(JSON.stringify(await shown_keys()) === JSON.stringify(["<AC-d>", "<A-k>"]), `captured ${JSON.stringify(await shown_keys())}`);
    await sleep(500);
    expect(await on_settings_tab(), "the captured Alt+K switched tabs");
    expect(!(await disabled()), "the captured Ctrl+Alt+D switched the add-on off");

    // The control: with the filter box focused the same chord is not captured and does fire, so the result above means something.
    await in_page(`view.document.querySelector('[aria-label="Filter bindings"]').focus();`);
    await poll_until("the filter box to hold the focus", () => in_page(`return view.document.hasFocus() && view.document.activeElement === view.document.querySelector('[aria-label="Filter bindings"]');`));
    await press_keys(...ALT("k"));
    await poll_until("Alt+K to switch tabs once the box is not focused", async () => !(await on_settings_tab()));
    await close_settings_tabs();
  });

  await run_case("keys section: the export holds keymap.d/zz-saved-edits.toml with a saved edit", async () => {
    await open_settings();
    await in_page(`return view.browser.runtime.sendMessage({ type: "change_keymap", mode: "normal", keys: "J", action: "set", text: "tab.close" });`);
    await poll_until("the edit to be stored", async () => (await layer()).normal?.J === "tab.close");
    const exported = await in_page(`return view.browser.runtime.sendMessage({ type: "export_config" }).then((answer) => ({ ok: answer.ok, text: answer.config_files?.["keymap.d/zz-saved-edits.toml"] }));`);
    expect(exported.ok && /J\s*=\s*"tab\.close"/.test(exported.text ?? ""), `the export held ${JSON.stringify(exported)}`);
    await close_settings_tabs();
  });
}
