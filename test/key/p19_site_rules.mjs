// Site rules: a pass rule frees a key, an only rule frees all but the listed keys, an all-off rule starts the page in ignore mode,
// each column resolves on its own, and a rule edit reaches an open page at once. The rows sit in config/settings.toml, one pattern per page id.
import { SHIFT_ESCAPE } from "./harness.mjs";

export const areas = ["keys", "config", "toolbar"];

export async function run_cases({ run_case, open_page, press_keys, wait_event, wait_takes_keys, events, expect, expect_no_scroll, hint_label_count, scroll_delta_by_press, poll_until, in_background, url_of, sleep }) {
  const badge_of = (page_id) => events.filter((event) => event.type === "indicator" && event.page_id === page_id).at(-1)?.label;
  // A passed `/` or `'` opens Firefox's Quick Find, which takes the keys after it, so the bar is closed before the next wait.
  const page_sees = async (page_id, key, what) => {
    const mark = events.length;
    await press_keys(key);
    await wait_event(mark, (event) => event.type === "keydown" && event.key === key && event.page_id === page_id, what);
    if (key === "/" || key === "'") {
      await sleep(400);
      await press_keys("-k", "Escape");
      await sleep(200);
    }
    await expect_no_scroll(mark, page_id);
  };

  await run_case("a pass rule sends its key to the page and keeps the rest", async () => {
    await open_page("page", "rule_pass", { new_tab: true });
    await page_sees("rule_pass", "j", "the page to see the passed j");
    expect((await scroll_delta_by_press("rule_pass", ["G"])) > 0, "G did not scroll under a pass rule for j");
    // Quick Find keys are cancelled when no binding takes them, unless the rule frees them.
    await page_sees("rule_pass", "/", "the page to see the passed /");
  });

  await run_case("a cross-origin frame under a pass rule gets the rule through the tab address", async () => {
    await open_page("frames", "rule_frames", { new_tab: true });
    await press_keys(";f");
    await poll_until("the hint labels", async () => (await hint_label_count()) > 0);
    await press_keys("s");
    await wait_event(0, (event) => event.type === "tree_read" && event.page_id === "rule_frames_cross", "the cross-origin frame to start on focus");
    await wait_takes_keys("rule_frames_cross");
    await page_sees("rule_frames_cross", "j", "the frame to see the passed j");
    expect((await scroll_delta_by_press("rule_frames_cross", ["G"])) > 0, "G did not scroll the frame under a pass rule for j");
  });

  await run_case("an only rule keeps the listed key and sends the rest to the page", async () => {
    await open_page("page", "rule_only", { new_tab: true });
    await page_sees("rule_only", "j", "the page to see j under an only rule");
    await page_sees("rule_only", "5", "the page to see a digit under an only rule");
    expect((await scroll_delta_by_press("rule_only", ["G"])) > 0, "G did not scroll under an only rule for G");
  });

  await run_case("under an only rule, Escape reaches the page in normal mode and still leaves insert mode", async () => {
    await open_page("field", "rule_only_field", { new_tab: true });
    // The page focuses its field on load, so it starts in insert mode.
    await poll_until("INSERT in the focused field", async () => badge_of("rule_only_field") === "INSERT");
    const insert_mark = events.length;
    await press_keys("-k", "Escape");
    await wait_event(insert_mark, (event) => event.type === "indicator" && event.page_id === "rule_only_field" && event.label === "NORMAL", "NORMAL after Escape in insert mode");
    await open_page("page", "rule_only_escape", { new_tab: true });
    const mark = events.length;
    await press_keys("-k", "Escape");
    await wait_event(mark, (event) => event.type === "keydown" && event.key === "Escape" && event.page_id === "rule_only_escape", "the page to see Escape in normal mode");
  });

  await run_case("a rule with no keys starts the page in ignore mode, and the leaving key still works", async () => {
    await open_page("page", "rule_off", { new_tab: true });
    await poll_until("the IGNORE badge", async () => badge_of("rule_off") === "IGNORE");
    await page_sees("rule_off", "j", "the page to see j in an all-off page");
    const mark = events.length;
    await press_keys(...SHIFT_ESCAPE);
    await wait_event(mark, (event) => event.type === "indicator" && event.page_id === "rule_off" && event.label === "NORMAL", "NORMAL after <S-Escape>");
    expect((await scroll_delta_by_press("rule_off", ["j"])) > 0, "j did not scroll after leaving ignore mode");
  });

  await run_case("off = false above a bare row keeps the page on, and a pass row between them still applies", async () => {
    await open_page("page", "rule_keep", { new_tab: true });
    await poll_until("the NORMAL badge", async () => badge_of("rule_keep") === "NORMAL");
    await page_sees("rule_keep", "j", "the page to see the passed j under off = false");
    expect((await scroll_delta_by_press("rule_keep", ["G"])) > 0, "G did not scroll on a page that off = false keeps on");
    expect(badge_of("rule_keep") === "NORMAL", "the bare row below put the page in ignore mode");
  });

  // The popup page in a background tab is an extension page, so its message passes the background's sender check.
  const send_from_popup = async (request) => {
    await in_background(`(async () => { if (!browser.extension.getViews({ type: "tab" }).some((view) => view.location.pathname === "/popup.html")) await browser.tabs.create({ url: browser.runtime.getURL("popup.html"), active: false }); })()`);
    await poll_until("the popup page to load", () => in_background(`browser.extension.getViews({ type: "tab" }).some((view) => view.location.pathname === "/popup.html" && view.document.readyState === "complete")`).catch(() => false));
    return in_background(`browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/popup.html").browser.runtime.sendMessage(${JSON.stringify(request)})`);
  };

  const site_request = (page_id, action) => send_from_popup({ type: "toolbar_site", url: url_of("page", page_id), action });

  await run_case("a rule edit reaches the open page at once, the rule's ignore mode ends with it, and a manual leave stays", async () => {
    await open_page("page", "rule_live", { new_tab: true });
    try {
      await poll_until("NORMAL before the edit", async () => badge_of("rule_live") === "NORMAL");
      await site_request("rule_live", "disable");
      await poll_until("IGNORE after the rule is added", async () => badge_of("rule_live") === "IGNORE");
      const answer = await site_request("rule_live", "enable");
      expect(answer.ok, `enable answered ${JSON.stringify(answer)}`);
      await poll_until("the rule to leave", async () => (await in_background(`browser.storage.local.get("desertfox_compiled_keymap").then((got) => got.desertfox_compiled_keymap?.site_rules?.length ?? 0)`)) === 8);
      await poll_until("NORMAL once the rule that turned the page off is gone", async () => badge_of("rule_live") === "NORMAL");
      expect((await scroll_delta_by_press("rule_live", ["j"])) > 0, "j did not scroll after the all-off rule left");
      await site_request("rule_live", "disable");
      await poll_until("IGNORE again after the page turns all-off", async () => badge_of("rule_live") === "IGNORE");
      // A manual leave survives an edit that does not touch the page's rule.
      const mark = events.length;
      await press_keys(...SHIFT_ESCAPE);
      await wait_event(mark, (event) => event.type === "indicator" && event.page_id === "rule_live" && event.label === "NORMAL", "NORMAL after <S-Escape>");
      await send_from_popup({ type: "change_setting", name: "newtab_date", action: "set", value: false });
      await sleep(300);
      expect(badge_of("rule_live") === "NORMAL", "an unrelated change put the page back in ignore mode");
    } finally {
      await send_from_popup({ type: "change_setting", name: "newtab_date", action: "reset" });
      await site_request("rule_live", "enable");
      // The popup's edits save a whole site_rules list, which would hide the file rows from later pieces on this shard.
      await send_from_popup({ type: "change_setting", name: "site_rules", action: "reset" });
      await in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.endsWith("/popup.html")) await browser.tabs.remove(tab.id); })()`);
    }
  });

  await run_case("the popup turns off a page under a key rule, a page loaded meanwhile starts off, and enable gives the key rule back", async () => {
    await open_page("page", "rule_pass_live", { new_tab: true });
    try {
      await poll_until("NORMAL before the edit", async () => badge_of("rule_pass_live") === "NORMAL");
      const answer = await site_request("rule_pass_live", "disable");
      expect(answer.ok, `disable answered ${JSON.stringify(answer)}`);
      await poll_until("IGNORE once the off row decides the column", async () => badge_of("rule_pass_live") === "IGNORE");
      await open_page("page", "rule_pass_fresh", { new_tab: true });
      await poll_until("IGNORE on a page loaded after the edit", async () => badge_of("rule_pass_fresh") === "IGNORE");
      await site_request("rule_pass_fresh", "enable");
      await poll_until("NORMAL once the off row is gone", async () => badge_of("rule_pass_fresh") === "NORMAL");
      await page_sees("rule_pass_fresh", "j", "the page to see the passed j once the key rule applies again");
      expect((await scroll_delta_by_press("rule_pass_fresh", ["G"])) > 0, "G did not scroll after the off row left");
    } finally {
      await site_request("rule_pass_live", "enable");
      await send_from_popup({ type: "change_setting", name: "site_rules", action: "reset" });
      await in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.endsWith("/popup.html")) await browser.tabs.remove(tab.id); })()`);
    }
  });

  await run_case("turning DesertFox off and on again puts an all-off page back in ignore mode", async () => {
    await open_page("page", "rule_off_switch", { new_tab: true });
    try {
      await poll_until("the IGNORE badge", async () => badge_of("rule_off_switch") === "IGNORE");
      await send_from_popup({ type: "toolbar_set_disabled", disabled: true });
      await poll_until("the badge to go while off", async () => badge_of("rule_off_switch") === "");
      await send_from_popup({ type: "toolbar_set_disabled", disabled: false });
      await poll_until("IGNORE after turning on", async () => badge_of("rule_off_switch") === "IGNORE");
      await page_sees("rule_off_switch", "j", "the page to see j after turning on");
    } finally {
      await send_from_popup({ type: "toolbar_set_disabled", disabled: false });
    }
  });
}
