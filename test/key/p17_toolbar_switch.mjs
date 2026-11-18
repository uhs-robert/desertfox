// The toolbar on/off switch: the Ctrl+Alt+D shortcut, the popup's messages, and what turning off does to open modes and to a restarted background.
// Every case ends with DesertFox on again, because later pieces on the same Firefox need its keys.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["toolbar"];

const TOGGLE = ["-M", "ctrl", "-M", "alt", "d", "-m", "alt", "-m", "ctrl"];

export async function run_cases({ take_shot, rdp, extension_id, run_case, press_keys, poll_until, open_page, url_of, wait_event, events, expect, sleep, scroll_delta_by_press, expect_no_scroll, hint_label_count, open_cmdline, wait_cmdline, wait_reinject_report, badge_is, in_active_tab }) {
  const in_background = (code) => evaluate_in_background(rdp, extension_id, code);
  const flag = () => in_background(`browser.storage.local.get("desertfox_disabled").then((got) => got.desertfox_disabled === true)`);
  const title = () => in_background(`browser.browserAction.getTitle({})`);
  const keymap_is_empty = () => in_background(`browser.storage.local.get("desertfox_compiled_keymap").then((got) => Object.keys(got.desertfox_compiled_keymap?.modes ?? {}).length === 0)`);
  const wait_state = (disabled, what) => poll_until(what, async () => (await flag()) === disabled && (await title()) === (disabled ? "DesertFox (off)" : "DesertFox") && (await keymap_is_empty()) === disabled, { timeout_ms: 8000 });

  // The popup page in a background tab is an extension page, so its messages pass the background's sender check.
  const ask = async (request) => {
    await in_background(`(async () => { if (!browser.extension.getViews({ type: "tab" }).some((view) => view.location.pathname === "/popup.html")) await browser.tabs.create({ url: browser.runtime.getURL("popup.html"), active: false }); })()`);
    await poll_until("the popup page to load", () => in_background(`browser.extension.getViews({ type: "tab" }).some((view) => view.location.pathname === "/popup.html" && view.document.readyState === "complete")`).catch(() => false));
    return in_background(`browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/popup.html").browser.runtime.sendMessage(${JSON.stringify(request)})`);
  };
  const close_popup = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.endsWith("/popup.html")) await browser.tabs.remove(tab.id); })()`);
  const turn_on = async () => {
    if (await flag()) await ask({ type: "toolbar_set_disabled", disabled: false });
    await wait_state(false, "DesertFox to be on");
  };
  const POPUP_VIEW = `browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/popup.html")`;
  const press_toggle = () => press_keys(...TOGGLE);

  await run_case("the shortcut turns DesertFox off: the flag, title and keymap say off, keys reach the page, the badge goes", async () => {
    await open_page("page", "sw", { new_tab: true });
    try {
      let mark = events.length;
      await press_toggle();
      await wait_state(true, "the shortcut to turn DesertFox off");
      await wait_event(mark, badge_is("sw", ""), "the mode badge to go");
      mark = events.length;
      await press_keys("j");
      await wait_event(mark, (event) => event.type === "keydown" && event.key === "j", "the page to see j while off");
      await expect_no_scroll(mark, "sw");
    } finally {
      await turn_on();
    }
  });

  await run_case("the shortcut works while off, and only the shortcut: it turns DesertFox on and keys scroll again", async () => {
    await open_page("page", "sw_back", { new_tab: true });
    await press_toggle();
    await wait_state(true, "off");
    await press_toggle();
    await wait_state(false, "on again");
    expect((await scroll_delta_by_press("sw_back", ["j"])) > 0, "j did not scroll after the shortcut turned DesertFox on");
  });

  await run_case("turning off ends hint mode and the command line", async () => {
    await open_page("hints", "sw_modes", { new_tab: true });
    try {
      await press_keys("f");
      await poll_until("the hint labels", async () => (await hint_label_count()) > 0);
      await press_toggle();
      await wait_state(true, "off during hints");
      await poll_until("the hint labels to go", async () => (await hint_label_count()) === 0);
      await turn_on();

      await open_cmdline();
      await press_toggle();
      await wait_state(true, "off with the command line open");
      await wait_cmdline((line) => !line.open, "the command line to close");
    } finally {
      await turn_on();
    }
  });

  await run_case("turning off ends insert mode", async () => {
    await open_page("field", "sw_field", { new_tab: true });
    try {
      // The page focuses its field on load, so the badge already read INSERT when the page opened.
      await poll_until("INSERT in the focused field", async () => events.filter((event) => event.type === "indicator" && event.page_id === "sw_field").at(-1)?.label === "INSERT");
      const mark = events.length;
      await press_toggle();
      await wait_state(true, "off in a field");
      await wait_event(mark, badge_is("sw_field", ""), "the INSERT badge to go");
    } finally {
      await turn_on();
    }
  });

  await run_case("the popup switch and the shortcut racing end in one consistent state", async () => {
    await open_page("page", "sw_race", { new_tab: true });
    try {
      const popup_answer = ask({ type: "toolbar_set_disabled", disabled: true });
      await press_toggle();
      await popup_answer;
      await sleep(500);
      // Either order is a valid history. The flag, title and keymap must agree.
      const disabled = await flag();
      await wait_state(disabled, "the flag, title and keymap to agree");
    } finally {
      await turn_on();
    }
    expect((await scroll_delta_by_press("sw_race", ["j"])) > 0, "j did not scroll after the race");
  });

  await run_case("a restarted background with the flag set comes back off: title, keymap and keys", async () => {
    await open_page("page", "sw_restart", { new_tab: true });
    try {
      await ask({ type: "toolbar_set_disabled", disabled: true });
      await wait_state(true, "off before the restart");
      await close_popup();
      await in_background(`browser.storage.local.remove("desertfox_reinject_report").then(() => browser.storage.local.set({ desertfox_reload_pending: Date.now() })).then(() => setTimeout(() => browser.runtime.reload(), 50))`);
      await wait_reinject_report();
      await wait_state(true, "off after the restart");
      const mark = events.length;
      await press_keys("j");
      await wait_event(mark, (event) => event.type === "keydown" && event.key === "j", "the page to see j after the restart");
      await expect_no_scroll(mark, "sw_restart");
    } finally {
      await turn_on();
      await close_popup();
    }
  });

  const slot_chord = () => in_background(`browser.commands.getAll().then((all) => all.find((command) => command.name === "slot_1")?.shortcut ?? "")`);
  const click_power = () => in_background(`browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/popup.html").document.querySelector('input[name=power]:not(:checked)').click()`);
  const power_label = () => in_background(`browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/popup.html")?.document.querySelector('input[name=power]:checked')?.parentElement.textContent ?? ""`);

  await run_case("clicking the popup switch turns DesertFox off and on, and Firefox releases the slot chords while off", async () => {
    try {
      await ask({ type: "toolbar_set_disabled", disabled: false });
      await poll_until("the popup to show on", async () => (await power_label()) === "On");
      const chord_when_on = await slot_chord();
      expect(chord_when_on !== "", "no slot chord was assigned while on");
      await click_power();
      await wait_state(true, "the switch click to turn DesertFox off");
      await poll_until("the slot chord to be released", async () => (await slot_chord()) === "");
      await poll_until("the popup to show off", async () => (await power_label()) === "Off");
      await click_power();
      await wait_state(false, "the switch click to turn DesertFox on");
      await poll_until("the slot chord to return", async () => (await slot_chord()) === chord_when_on);
    } finally {
      await turn_on();
      await close_popup();
    }
  });

  await run_case("typing in a field after an off and on cycle goes to the field", async () => {
    await open_page("field", "sw_cycle", { new_tab: true });
    try {
      await poll_until("INSERT in the focused field", async () => events.filter((event) => event.type === "indicator" && event.page_id === "sw_cycle").at(-1)?.label === "INSERT");
      await press_toggle();
      await wait_state(true, "off in a field");
      await press_toggle();
      await wait_state(false, "on again in a field");
      await poll_until("INSERT after the cycle", async () => events.filter((event) => event.type === "indicator" && event.page_id === "sw_cycle").at(-1)?.label === "INSERT");
      const mark = events.length;
      await press_keys("j");
      await wait_event(mark, (event) => event.type === "input" && event.value === "j", "the field to hold j");
      await expect_no_scroll(mark, "sw_cycle");
    } finally {
      await turn_on();
    }
  });

  await run_case("a field inside a shadow root is still in insert mode after an off and on cycle", async () => {
    await open_page("caret_editable_shadow", "sw_shadow", { new_tab: true });
    try {
      await in_active_tab(`document.getElementById("host").shadowRoot.getElementById("editable").focus()`);
      const label = () => events.filter((event) => event.type === "indicator" && event.page_id === "sw_shadow").at(-1)?.label;
      await poll_until("INSERT in the shadow field", async () => label() === "INSERT");
      let mark = events.length;
      await press_toggle();
      await wait_state(true, "off with a shadow field focused");
      await wait_event(mark, badge_is("sw_shadow", ""), "the badge to go while off");
      mark = events.length;
      await press_toggle();
      await wait_state(false, "on again with a shadow field focused");
      await wait_event(mark, badge_is("sw_shadow", "INSERT"), "INSERT after the cycle");
    } finally {
      await turn_on();
    }
  });

  // The theme sheet applies its light set under a prefers-color-scheme media rule, and the test Firefox reports light. The shots set that rule's media list on the parsed sheets, never the machine's scheme.
  const popup_scheme = (target) => in_background(`(() => { const doc = ${POPUP_VIEW}.document; for (const sheet of doc.styleSheets) for (const rule of sheet.cssRules) if (rule instanceof ${POPUP_VIEW}.CSSMediaRule && (rule.media.mediaText.includes("prefers-color-scheme") || rule.media.mediaText === "all" || rule.media.mediaText === "not all")) rule.media.mediaText = ${JSON.stringify(target)}; })()`);
  // The code text runs in the background with the popup's `document` and `popup_browser` in scope, because the pages' CSP blocks eval.
  const popup_eval = (code) => in_background(`(() => { const view = ${POPUP_VIEW}; const document = view.document; const popup_browser = view.browser; return (${code}); })()`);

  await run_case("the popup draws the header, one On/Off radio group moved by the arrow keys, and the site card with its rule line, with shots under DESERTFOX_SHOT_DIR", async () => {
    await open_page("page", "rule_pass_look", { new_tab: true });
    const page_url = url_of("page", "rule_pass_look");
    try {
      await close_popup();
      await in_background(`browser.tabs.create({ url: browser.runtime.getURL("popup.html"), active: true })`);
      await poll_until("the popup page to draw", () => in_background(`${POPUP_VIEW}?.document.querySelector(".desertfox-popup-card") !== null`).catch(() => false));
      // The popup reads the active tab, which here is the popup itself, so the test hands it the rule page's address.
      await popup_eval(`(popup_browser.tabs.query = async () => [{ id: 1, url: ${JSON.stringify(page_url)} }], true)`);
      const checked = () => popup_eval(`document.querySelector("input[name=power]:checked").parentElement.textContent`);
      const group_names = () => popup_eval(`[...document.querySelectorAll("input[type=radio]")].map((input) => input.name).join()`);
      const names = await group_names(); expect(names === "power,power", `the On and Off radios share one name, got ${JSON.stringify(names)}`);
      expect((await popup_eval(`document.querySelector(".desertfox-popup-segments legend").textContent`)) === "DesertFox", "the group label is neutral");
      // An arrow key on the focused radio moves the selection to Off, which a redraw then shows with the host.
      await popup_eval(`document.querySelector("input[name=power]:checked").focus()`);
      // The first key after the tab opens can land before the page takes keys.
      await sleep(500);
      await press_keys("-k", "Right");
      await wait_state(true, "the arrow key to turn DesertFox off");
      await poll_until("Off to be checked", async () => (await checked()) === "Off");
      await poll_until("the site card to name the host and the rule", async () => (await popup_eval(`document.querySelector(".desertfox-popup-host")?.textContent === "127.0.0.1" && document.querySelector(".desertfox-popup-rule .desertfox-popup-detail")?.textContent === "pass 2 keys"`)) === true);
      const shot_dir = process.env.DESERTFOX_SHOT_DIR;
      const shoot = async (name) => {
        if (!shot_dir) return;
        for (const [scheme, target] of [["dark", "not all"], ["light", "all"]]) {
          await popup_scheme(target);
          await sleep(700);
          await take_shot(`${shot_dir}/popup-${name}-${scheme}.png`);
        }
      };
      await shoot("off");
      await ask({ type: "toolbar_set_disabled", disabled: false });
      await wait_state(false, "DesertFox to be on");
      await popup_eval(`document.querySelector("input[name=power]:not(:checked)").click()`);
      await wait_state(false, "the clicks to leave DesertFox on");
      await poll_until("On to be checked", async () => (await checked()) === "On");
      await poll_until("the state line to read enabled", async () => (await popup_eval(`document.querySelector(".desertfox-popup-state")?.textContent`)) === "Enabled on this site");
      await shoot("on");
    } finally {
      await turn_on();
      await close_popup();
    }
  });
}
