// Key cases for the mode of the focused frame: the badge and the background's tab mode follow the frame that holds the focus, not only the top frame.
// /hidden_input_frame stands in for Google Docs: on load it focuses a contenteditable in an offscreen same-origin frame.
export const areas = ["ui", "keys"];

export async function run_cases({ run_case, press_keys, open_page, expect, poll_until, in_background, in_active_tab, wait_takes_keys, events, wait_event }) {
  const page_id = "p15_hidden_input";
  const frame_page_id = `${page_id}_frame`;
  const active_tab = (read) => in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => (${read})(tab))`);
  // The record shape is TabModeRecord in src/background/tab_modes.ts, read by the rule of `mode_of_record` there. Null means the background holds no mode for the tab.
  const stored_tab_mode = () =>
    active_tab(`async (tab) => {
      const key = "desertfox_tab_mode_" + tab.id;
      const record = (await browser.storage.local.get(key))[key];
      return (record?.top_mode === "ignore" ? undefined : record?.focused_child?.mode) ?? record?.top_mode ?? null;
    }`);
  // The badge is read from the page, not from the page's indicator reports: two reports sent 1 ms apart can reach the server out of order.
  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  async function expect_badge_and_mode(label) {
    let seen;
    await poll_until(`the ${label} badge and stored tab mode`, async () => (seen = [await badge(), await stored_tab_mode()]).join() === [label, label.toLowerCase()].join(), { timeout_ms: 3000, expected_timeout: true }).catch(() =>
      expect(false, `the badge and the stored tab mode are ${seen}, expected ${label}`),
    );
  }
  const SHIFT_ESCAPE = ["-M", "shift", "-k", "Escape", "-m", "shift"];
  const focus_editor = `document.getElementById("input_frame").contentDocument.getElementById("editor").focus()`;
  const blur_frame = `document.activeElement.blur()`;

  await run_case("the background keeps the tab mode a page reports at load", async () => {
    for (let load = 0; load < 5; load++) {
      await open_page("page", `p15_load_${load}`, { new_tab: load === 0 });
      expect((await stored_tab_mode()) === "normal", `the stored tab mode after load ${load} is ${await stored_tab_mode()}`);
    }
  });

  await run_case("a reloaded page keeps its stored tab mode through its next address change", async () => {
    const mark = events.length;
    await active_tab(`(tab) => browser.tabs.reload(tab.id)`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p15_load_4", "the reloaded page to start");
    await poll_until("the reload to complete", async () => (await active_tab(`(tab) => tab.status`)) === "complete");
    await in_active_tab(`history.replaceState(null, "", location.href + "&replaced=1")`);
    await poll_until("the page to change its address", () => active_tab(`(tab) => tab.url.endsWith("replaced=1")`));
    expect((await stored_tab_mode()) === "normal", `the stored tab mode after the address change is ${await stored_tab_mode()}`);
  });

  await run_case("a page that changes its own address while it loads keeps its stored tab mode", async () => {
    await open_page("replaces_address", "p15_replaces", { new_tab: false });
    await poll_until("the page to change its address", () => active_tab(`(tab) => tab.url.endsWith("replaced=1")`));
    // The slow image keeps the page loading, so the report at the end of the load has not come yet to put a lost mode back.
    expect((await active_tab(`(tab) => tab.status`)) === "loading", "the page finished loading before the check, so the case proves nothing");
    expect((await stored_tab_mode()) === "normal", `the stored tab mode after the address change is ${await stored_tab_mode()}`);
  });

  let home_tab_id;
  await run_case("a hidden input frame focused at load shows INSERT, and still does after the tab was hidden and shown", async () => {
    home_tab_id = await active_tab(`(tab) => tab.id`);
    await open_page("hidden_input_frame", page_id, { new_tab: true, keys_page_id: frame_page_id });
    await expect_badge_and_mode("INSERT");
    const frame_tab_id = await active_tab(`(tab) => tab.id`);
    await in_background(`browser.tabs.update(${home_tab_id}, { active: true })`);
    await poll_until("the first tab to show", async () => (await active_tab(`(tab) => tab.id`)) === home_tab_id);
    await in_background(`browser.tabs.update(${frame_tab_id}, { active: true })`);
    // Showing the tab fires focus on the top window as well, which must not take the badge from the frame.
    await wait_takes_keys(frame_page_id);
    await expect_badge_and_mode("INSERT");
  });

  await run_case("Escape in the hidden frame shows NORMAL", async () => {
    await press_keys("-k", "Escape");
    await expect_badge_and_mode("NORMAL");
  });

  await run_case("focus moving to the top page and back to the hidden frame moves the badge with it", async () => {
    await in_active_tab(focus_editor);
    await expect_badge_and_mode("INSERT");
    await in_active_tab(blur_frame);
    await expect_badge_and_mode("NORMAL");
    await in_active_tab(focus_editor);
    await expect_badge_and_mode("INSERT");
    await in_active_tab(blur_frame);
    await expect_badge_and_mode("NORMAL");
  });

  await run_case("ignore mode in the top page stays on the badge while the hidden frame holds the focus", async () => {
    await wait_takes_keys(page_id);
    await press_keys(...SHIFT_ESCAPE);
    await expect_badge_and_mode("IGNORE");
    await in_active_tab(focus_editor);
    const focused_child_mode = () => active_tab(`async (tab) => (await browser.storage.local.get("desertfox_tab_mode_" + tab.id))["desertfox_tab_mode_" + tab.id]?.focused_child?.mode ?? null`);
    await poll_until("the hidden frame to report insert mode with the focus", async () => (await focused_child_mode()) === "insert");
    await expect_badge_and_mode("IGNORE");
    await in_active_tab(blur_frame);
    await wait_takes_keys(page_id);
    await press_keys(...SHIFT_ESCAPE);
    await expect_badge_and_mode("NORMAL");
  });

  await run_case("a focused hidden frame that is removed gives the badge back to the top page", async () => {
    await in_active_tab(focus_editor);
    await expect_badge_and_mode("INSERT");
    await in_active_tab(`document.getElementById("input_frame").remove()`);
    await expect_badge_and_mode("NORMAL");
  });

  await run_case("a field focused in a frame of another site shows INSERT, from the script that starts on that focus", async () => {
    await open_page("frames", "p15_frames", { new_tab: false });
    await expect_badge_and_mode("NORMAL");
    await in_active_tab(`document.getElementById("cross").focus()`);
    // The top page cannot reach into the other site's frame, so the field is added from the extension.
    const focus_field_in_cross_frame = `if (location.search.includes("p15_frames_cross")) { const field = document.querySelector("input") ?? document.body.insertBefore(document.createElement("input"), document.body.firstChild); field.focus(); }`;
    await active_tab(`(tab) => browser.tabs.executeScript(tab.id, { allFrames: true, code: ${JSON.stringify(focus_field_in_cross_frame)} }).then(() => true)`);
    await expect_badge_and_mode("INSERT");
    await in_active_tab(blur_frame);
    await expect_badge_and_mode("NORMAL");
  });
}
