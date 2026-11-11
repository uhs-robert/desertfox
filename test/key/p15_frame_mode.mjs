// Key cases for the mode of the focused frame: the badge and the background's tab mode follow the frame that holds the focus, not only the top frame.
// /hidden_input_frame stands in for Google Docs: on load it focuses a contenteditable in an offscreen same-origin frame.
// Such a frame hands the focus to the top page whenever it is in normal mode, so normal-mode keys act on the page the user sees.
export const areas = ["ui", "keys"];

export async function run_cases({ run_case, press_keys, open_page, expect, poll_until, in_background, in_active_tab, wait_takes_keys, events, wait_event, scroll_of, last_scroll_y, sleep, settle_focus }) {
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
  const focused_child = () => active_tab(`async (tab) => (await browser.storage.local.get("desertfox_tab_mode_" + tab.id))["desertfox_tab_mode_" + tab.id]?.focused_child ?? null`);
  // NORMAL on the badge passes while a child frame keeps a stale claim in normal mode, so the record is read too.
  async function expect_top_frame_holds_the_tab(label = "NORMAL") {
    await expect_badge_and_mode(label);
    let child;
    await poll_until("the stored record to name no focused child frame", async () => (child = await focused_child()) === null, { timeout_ms: 3000, expected_timeout: true }).catch(() =>
      expect(false, `the stored record still names a focused child frame: ${JSON.stringify(child)}`),
    );
  }
  const top_document_has_focus = () => in_active_tab(`document.hasFocus() && !document.activeElement.contentWindow`);
  async function expect_handed_off(label = "NORMAL") {
    await poll_until("the top document to hold the focus", top_document_has_focus, { timeout_ms: 3000, expected_timeout: true }).catch(() => expect(false, "the hidden frame kept the focus"));
    await expect_top_frame_holds_the_tab(label);
  }
  const frame_page_id_of = (id) => `${id}_frame`;
  const frame_scroll_y = () => in_active_tab(`document.getElementById("input_frame").contentWindow.scrollY`);
  const frame_focus_count = () => in_active_tab(`Number(document.body.dataset.frameFocuses ?? 0)`);
  // Focusing the editor scrolls the frame's own document and pulls the top page back to its start, so both are read just before the keys.
  async function expect_key_scrolls_top_page(keys, id = page_id) {
    const top_before = await in_active_tab(`scrollY`);
    const frame_before = await frame_scroll_y();
    const mark = events.length;
    await press_keys(...keys);
    await wait_event(mark, (event) => scroll_of(id)(event) && event.y > top_before, `the top page to scroll down from ${top_before} after ${keys.join(" ")}`);
    expect((await frame_scroll_y()) === frame_before, `the hidden frame scrolled from ${frame_before} to ${await frame_scroll_y()}`);
  }
  // The frame reports each key it gets, and the top page must stay where it is.
  async function expect_key_reaches_frame(key, id = page_id) {
    const top_before = await in_active_tab(`scrollY`);
    const mark = events.length;
    await press_keys(key);
    await wait_event(mark, (event) => event.page_id === `${id}_frame` && event.type === "keydown" && event.key === key, `the hidden frame to get the key ${key}`);
    await sleep(300);
    expect((await in_active_tab(`scrollY`)) === top_before, `the top page scrolled on a key typed into the editor`);
  }

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

  await run_case("Escape in the hidden frame hands the focus to the top page, and a j typed right behind it scrolls that page", async () => {
    // One call, so the j arrives with no wait for the hand-off.
    await expect_key_scrolls_top_page(["-k", "Escape", "j"]);
    await expect_handed_off();
    await expect_key_scrolls_top_page(["j"]);
  });

  await run_case("after the hand-off nothing gives the focus back to the hidden frame", async () => {
    const before = await frame_focus_count();
    await sleep(500);
    expect((await frame_focus_count()) === before, `the hidden frame took the focus ${(await frame_focus_count()) - before} more times with no input`);
    expect(await top_document_has_focus(), "the top document lost the focus");
  });

  await run_case("a mouse press in the document, which focuses the editor as Docs does, returns to INSERT", async () => {
    await in_active_tab(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
    await expect_badge_and_mode("INSERT");
    await expect_key_reaches_frame("j");
    await expect_badge_and_mode("INSERT");
  });

  await run_case("gi returns from the top page into the hidden frame's editor", async () => {
    await press_keys("-k", "Escape");
    await expect_handed_off();
    await press_keys("gi");
    await expect_badge_and_mode("INSERT");
    expect((await in_active_tab(`document.getElementById("input_frame").contentDocument.activeElement.id`)) === "editor", "gi did not focus the editor in the hidden frame");
    await expect_key_reaches_frame("j");
  });

  await run_case("a hidden frame that the page itself leaves in normal mode hands the focus off", async () => {
    await in_active_tab(`document.getElementById("input_frame").contentDocument.getElementById("editor").blur()`);
    await expect_handed_off();
    await expect_key_scrolls_top_page(["j"]);
  });

  await run_case("a command that sets normal mode in the hidden frame while its field has the focus hands the focus off", async () => {
    await in_active_tab(focus_editor);
    await expect_badge_and_mode("INSERT");
    // The message the router sends for a content command. Every frame gets it, and the top frame is in normal mode already.
    await active_tab(`(tab) => browser.tabs.sendMessage(tab.id, { type: "run_in_content", invocations: [{ id: "mode.set", args: { mode: "normal" } }] }).then(() => true)`);
    await expect_handed_off();
    await expect_key_scrolls_top_page(["j"]);
  });

  await run_case("a hidden frame that gains the focus while in normal mode hands it off once", async () => {
    for (const focus_frame of [`document.getElementById("input_frame").focus()`, `document.getElementById("input_frame").contentWindow.focus()`]) {
      // A focus within half a second of the last hand-off counts as a page that fights for the focus, and stays in the frame.
      await sleep(600);
      const before = await frame_focus_count();
      await in_active_tab(focus_frame);
      await poll_until("the hidden frame to take the focus", async () => (await frame_focus_count()) > before);
      await expect_handed_off();
      await sleep(300);
      expect((await frame_focus_count()) === before + 1, `the hidden frame took the focus ${(await frame_focus_count()) - before} times for one focus call`);
      await expect_key_scrolls_top_page(["j"]);
    }
  });

  await run_case("focus moving to the top page and back to the hidden frame moves the badge with it", async () => {
    await in_active_tab(focus_editor);
    await expect_badge_and_mode("INSERT");
    await in_active_tab(blur_frame);
    await expect_top_frame_holds_the_tab();
    await in_active_tab(focus_editor);
    await expect_badge_and_mode("INSERT");
    await in_active_tab(blur_frame);
    await expect_top_frame_holds_the_tab();
  });

  await run_case("ignore mode in the top page stays on the badge and keeps its keys off through a hand-off", async () => {
    await wait_takes_keys(page_id);
    await press_keys(...SHIFT_ESCAPE);
    await expect_badge_and_mode("IGNORE");
    await in_active_tab(focus_editor);
    await poll_until("the hidden frame to report insert mode with the focus", async () => (await focused_child())?.mode === "insert");
    await expect_badge_and_mode("IGNORE");
    // Escape goes to the frame, which leaves insert mode and hands the focus to a top page in ignore mode.
    await wait_takes_keys(frame_page_id);
    await press_keys("-k", "Escape");
    await expect_handed_off("IGNORE");
    const top_before = await in_active_tab(`scrollY`);
    const frame_before = await frame_scroll_y();
    await press_keys("j");
    await wait_takes_keys(page_id);
    expect((await in_active_tab(`scrollY`)) === top_before, "j scrolled a top page in ignore mode");
    expect((await frame_scroll_y()) === frame_before, "j scrolled the hidden frame");
    await press_keys(...SHIFT_ESCAPE);
    await expect_top_frame_holds_the_tab();
  });

  await run_case("a focused hidden frame that is removed gives the badge back to the top page", async () => {
    await in_active_tab(focus_editor);
    await expect_badge_and_mode("INSERT");
    await in_active_tab(`document.getElementById("input_frame").remove()`);
    await expect_top_frame_holds_the_tab();
  });

  await run_case("an editor that takes the focus back after the hand-off returns to INSERT and stays there", async () => {
    const id = "p15_refocus_field";
    await open_page("hidden_input_frame", id, { new_tab: false, keys_page_id: `${id}_frame` });
    await expect_badge_and_mode("INSERT");
    await press_keys("-k", "Escape");
    await poll_until("the page to focus its editor again", async () => (await frame_focus_count()) >= 2);
    await expect_badge_and_mode("INSERT");
    await sleep(500);
    expect((await frame_focus_count()) === 2, `the frame took the focus ${await frame_focus_count()} times, expected 2: at load and once after the hand-off`);
    await expect_key_reaches_frame("j", id);
  });

  await run_case("a page that focuses the hidden frame again after each hand-off keeps the focus there, with no loop", async () => {
    const id = "p15_refocus_frame";
    await open_page("hidden_input_frame", id, { new_tab: false, keys_page_id: `${id}_frame` });
    await expect_badge_and_mode("INSERT");
    await press_keys("-k", "Escape");
    await poll_until("the page to focus its frame again", async () => (await frame_focus_count()) >= 2);
    await sleep(700);
    expect((await frame_focus_count()) === 2, `the frame took the focus ${await frame_focus_count()} times, expected 2: at load and once after the hand-off`);
    expect((await in_active_tab(`document.activeElement.id`)) === "input_frame", "the hidden frame does not hold the focus the page gave it");
    await expect_badge_and_mode("NORMAL");
    // The next Escape hands off once more, and the page answers once more.
    await press_keys("-k", "Escape");
    await poll_until("the page to focus its frame a third time", async () => (await frame_focus_count()) >= 3);
    await sleep(700);
    expect((await frame_focus_count()) === 3, `the frame took the focus ${await frame_focus_count()} times after the second Escape, expected 3`);
  });

  await run_case("a page that focuses its editor again on the Escape keyup, as Docs does, stays in NORMAL after Escape", async () => {
    const id = "p15_keyup_refocus";
    await open_page("hidden_input_frame", id, { new_tab: false, keys_page_id: `${id}_frame` });
    await expect_badge_and_mode("INSERT");
    const focuses_before = await frame_focus_count();
    const mark = events.length;
    // The keydown hands the focus to the top page, so the keyup of the same press lands there.
    await press_keys("-k", "Escape");
    await expect_handed_off();
    await sleep(500);
    expect(!events.slice(mark).some((event) => event.page_id === id && event.type === "keyup" && event.key === "Escape"), "the top page got the keyup of an Escape whose keydown went to the hidden frame");
    expect((await frame_focus_count()) === focuses_before, `the hidden frame took the focus ${(await frame_focus_count()) - focuses_before} more times after Escape`);
    expect(await top_document_has_focus(), "the top document lost the focus after Escape");
    await expect_badge_and_mode("NORMAL");
    await expect_key_scrolls_top_page(["j"], id);
    // An Escape typed whole in the top page is DesertFox's own key there, and the page gets neither half.
    await press_keys("-k", "Escape");
    await sleep(300);
    expect(await top_document_has_focus(), "an Escape in the top page gave the focus back to the hidden frame");
  });

  await run_case("a Shift press split between the hidden frame and a field of the top page leaves that field's keys whole", async () => {
    const id = "p15_title_input_shift_moves_focus";
    const top_got = (type, key) => (event) => event.page_id === id && event.type === type && event.key === key;
    await open_page("hidden_input_frame", id, { new_tab: false, keys_page_id: `${id}_frame` });
    await expect_badge_and_mode("INSERT");
    const split = events.length;
    // The frame moves the focus to the title field on the Shift keydown, so the Shift keyup lands in the top page.
    await press_keys("-M", "shift", "-m", "shift");
    await wait_event(split, (event) => event.page_id === `${id}_frame` && event.type === "keydown" && event.key === "Shift", "the hidden frame to get the Shift keydown");
    await poll_until("the title field to take the focus", async () => (await in_active_tab(`document.activeElement.id`)) === "title");
    await expect_top_frame_holds_the_tab("INSERT");
    // The next letter is not shifted, and the page gets both halves of it.
    const letter = events.length;
    await press_keys("a");
    await wait_event(letter, (event) => event.page_id === id && event.type === "input" && event.value === "a", "the title field to hold a lower-case a");
    await wait_event(letter, top_got("keyup", "a"), "the top page to get the keyup of the a");
    expect(!events.slice(split).some(top_got("keyup", "Shift")), "the top page got the keyup of a Shift whose keydown went to the hidden frame");
    // A Shift press that starts and ends in the top page reaches the page whole, so the page never holds a Shift it saw go down.
    const whole = events.length;
    await press_keys("-M", "shift", "a", "-m", "shift");
    await wait_event(whole, top_got("keydown", "Shift"), "the top page to get the Shift keydown");
    await wait_event(whole, top_got("keyup", "Shift"), "the top page to get the Shift keyup");
    await wait_event(whole, (event) => event.page_id === id && event.type === "input" && event.value === "aA", "the title field to hold aA");
  });

  await run_case("gi picks the hidden frame's editor ahead of a visible field of the page", async () => {
    const id = "p15_title_input";
    await open_page("hidden_input_frame", id, { new_tab: false, keys_page_id: `${id}_frame` });
    await expect_badge_and_mode("INSERT");
    await press_keys("-k", "Escape");
    await expect_handed_off();
    await press_keys("gi");
    await expect_badge_and_mode("INSERT");
    expect((await in_active_tab(`document.activeElement.id`)) === "input_frame", `gi focused ${await in_active_tab(`document.activeElement.id`)} in the top page`);
    expect((await in_active_tab(`document.getElementById("input_frame").contentDocument.activeElement.id`)) === "editor", "gi did not focus the editor in the hidden frame");
    await expect_key_reaches_frame("j", id);
  });

  await run_case("focus that moves from the hidden frame's editor to a field of the top page lands in that field", async () => {
    // The page is still p15_title_input, with the editor focused. Docs moves the focus this way for its title, its find box and its comment box.
    await expect_badge_and_mode("INSERT");
    await in_active_tab(`document.getElementById("title").focus()`);
    await sleep(300);
    // On the unfixed code the hand-off ran inside the editor's focusout and cancelled the move.
    expect((await in_active_tab(`document.activeElement.id`)) === "title", `the top page's focused element is ${await in_active_tab(`document.activeElement.tagName + "#" + document.activeElement.id`)}, expected the title field`);
    await expect_top_frame_holds_the_tab("INSERT");
  });

  await run_case("a visible frame with a field keeps the focus and its keys after Escape", async () => {
    const id = "p15_visible_frame";
    await open_page("frames", id, { new_tab: false });
    await in_active_tab(`{ const inner = document.getElementById("same").contentDocument; inner.body.insertBefore(inner.createElement("input"), inner.body.firstChild).focus(); }`);
    await expect_badge_and_mode("INSERT");
    await press_keys("-k", "Escape");
    await expect_badge_and_mode("NORMAL");
    const same_frame_scroll_y = () => in_active_tab(`document.getElementById("same").contentWindow.scrollY`);
    await press_keys("j");
    await poll_until("j to scroll the visible frame", async () => (await same_frame_scroll_y()) > 0);
    expect((await in_active_tab(`document.activeElement.id`)) === "same", "the visible frame lost the focus");
    expect((await focused_child())?.mode === "normal", `the stored record does not name the visible frame as the focused child: ${JSON.stringify(await focused_child())}`);
    expect((await in_active_tab(`scrollY`)) === 0, "j scrolled the top page while a visible frame held the focus");
  });

  await run_case("gi picks a field in view ahead of an editor in a full-size frame that is scrolled out of view", async () => {
    // Still on p15_visible_frame. The 300 by 200 frame holds an input and stands for an editor frame.
    await in_active_tab(blur_frame);
    await in_active_tab(`{ const field = document.body.appendChild(document.createElement("input")); field.id = "in_view"; field.style.cssText = "position:fixed;top:10px;left:10px"; scrollTo(0, 3000); }`);
    await poll_until("the frame to leave the view", () => in_active_tab(`document.getElementById("same").getBoundingClientRect().bottom < 0`));
    await wait_takes_keys("p15_visible_frame");
    await press_keys("gi");
    await poll_until("gi to focus the field in view", async () => (await in_active_tab(`document.activeElement.id`)) === "in_view", { timeout_ms: 3000, expected_timeout: true }).catch(async () =>
      expect(false, `gi focused ${await in_active_tab(`document.activeElement.tagName + "#" + document.activeElement.id`)}, expected the field in view`),
    );
    await in_active_tab(blur_frame);
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

  // A frame that Docs focuses in a background tab gets no focus event until the tab is shown. Its script starts on that event, and the hand-off needs it.
  await run_case("a hidden input frame focused in a background tab starts when the tab is shown, and keys then reach it and hand off", async () => {
    const id = "p15_background_frame";
    const origin = await in_active_tab(`location.origin`);
    const mark = events.length;
    const background_tab_id = await in_background(`browser.tabs.create({ url: ${JSON.stringify(`${origin}/hidden_input_frame?id=${id}`)}, active: false }).then((tab) => tab.id)`);
    await wait_event(mark, (event) => event.page_id === id && event.type === "tree_read", "the background tab's top page to start");
    await wait_event(mark, (event) => event.page_id === id && event.type === "visibility", "the background tab to report that it is hidden");
    // The written frame reports no page id of its own, so its start shows in the attribute the content script sets on its document element.
    const frame_started = () => in_background(`browser.tabs.executeScript(${background_tab_id}, { code: 'document.getElementById("input_frame").contentDocument.documentElement.hasAttribute("data-desertfox-tree-read-ms")' }).then((results) => results[0])`);
    expect((await frame_started()) === false, "the hidden frame started while its tab was in the background");
    await in_background(`browser.tabs.update(${background_tab_id}, { active: true })`);
    await poll_until("the hidden frame to start when the tab is shown", async () => (await frame_started()) === true);
    await wait_takes_keys(frame_page_id_of(id));
    await expect_badge_and_mode("INSERT");
    await expect_key_reaches_frame("j", id);
    await press_keys("-k", "Escape");
    await expect_handed_off();
    await expect_key_scrolls_top_page(["j"], id);
  });
}
