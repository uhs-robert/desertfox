// The media mode. aa and the ;M hint start it, an element fullscreen starts it too, and it ends on Escape, on the end of the fullscreen and on a page change, in every frame of the tab.
// The page /media_mode has a large video in a player box, a small one, a field and tall filler. Its videos report each change, so a key's effect reads from the page.
// Outside fullscreen the badge reads MEDIA, in fullscreen it hides (a label of ""), and NORMAL is the way out. The mode of a frame also shows in whether j scrolls it.

export const areas = ["media", "keys", "hints"];

export async function run_cases({ run_case, open_page, press_keys, wait_event, expect_absent, wait_cmdline, type_in_line, close_cmdline, events, expect, in_active_tab, poll_until, in_background, hint_label_count, scroll_delta_by_press, scroll_of, wait_takes_keys }) {
  const indicator = (page_id, label) => (event) => event.type === "indicator" && event.page_id === page_id && event.label === label;
  const media = (page_id, type, video, check = () => true) => (event) => event.page_id === page_id && event.type === `media_${type}` && event.video === video && check(event);
  const read_toast = () =>
    in_active_tab(`(() => {
      const host = [...document.documentElement.children].find((child) => child.style.zIndex === "2147483645");
      return host ? host.openOrClosedShadowRoot.querySelector(".desertfox-toast")?.textContent ?? "" : "";
    })()`);
  // The matched toast is removed, so the next wait cannot match it again.
  const clear_toast = () => in_active_tab('[...document.documentElement.children].find((child) => child.style.zIndex === "2147483645")?.remove(); 0');
  const wait_toast = async (pattern) => {
    await poll_until(`the notice ${pattern}`, async () => pattern.test(await read_toast()));
    await clear_toast();
  };
  const hidden = (mark, page_id) => wait_event(mark, indicator(page_id, ""), `the badge of ${page_id} to hide`);
  const shown = (mark, page_id) => wait_event(mark, indicator(page_id, "MEDIA"), `the badge of ${page_id} to read MEDIA`);
  const normal = (mark, page_id) => wait_event(mark, indicator(page_id, "NORMAL"), `the badge of ${page_id} to read NORMAL`);
  // j changes the volume of the main video in the media mode and scrolls the page in normal mode.
  const j_is_media = async (page_id, volume) => {
    const mark = events.length;
    await press_keys("j");
    await wait_event(mark, media(page_id, "volumechange", "big", (event) => Math.abs(event.volume - volume) < 0.001), `the volume at ${volume}`);
  };
  const j_scrolls = async (page_id) => expect((await scroll_delta_by_press(page_id, ["j"])) > 0, `j did not scroll ${page_id}`);
  // The panel of the media keys opens by itself on entry. Waiting for it keeps a late bundle load from holding the next key.
  const panel_up = (what) => poll_until(what, async () => await in_active_tab('[...document.documentElement.children].some((c) => c.getAttribute("data-desertfox-layer") === "2147483646" && c.matches(":popover-open"))'));
  const open_media_page = async (id) => {
    await open_page("media_mode", id, { new_tab: true });
    const mark = events.length;
    await press_keys("a", "a");
    await shown(mark, id);
    await panel_up(`the media panel of ${id}`);
  };
  const focus_frame = async (host_id) => {
    const mark = events.length;
    await in_active_tab('document.getElementById("frame").contentWindow.focus(); 0');
    await wait_event(mark, (event) => event.type === "window_focus" && event.page_id === `${host_id}_inner`, `${host_id}_inner to take the focus`);
    await wait_takes_keys(`${host_id}_inner`);
  };
  const focus_top = async (host_id) => {
    const mark = events.length;
    await in_active_tab('document.getElementById("frame").blur(); window.focus(); 0');
    await wait_event(mark, (event) => event.type === "window_focus" && event.page_id === host_id, `${host_id} to take the focus`);
    await wait_takes_keys(host_id);
  };

  await run_case("aa enters the mode with no fullscreen and the badge reads MEDIA, and every key changes the main video", async () => {
    const id = "p29_keys";
    await open_page("media_mode", id, { new_tab: true });
    const start = events.length;
    await press_keys("a", "a");
    await shown(start, id);
    let mark = events.length;
    await press_keys("l");
    await wait_event(mark, media(id, "seeked", "big", (event) => Math.round(event.time) === 10), "the large video at 10 s");
    mark = events.length;
    await press_keys("3", "j");
    await wait_event(mark, media(id, "volumechange", "big", (event) => Math.abs(event.volume - 0.7) < 0.001), "three steps down, 70 percent");
    mark = events.length;
    await press_keys("k");
    await wait_event(mark, media(id, "volumechange", "big", (event) => Math.abs(event.volume - 0.8) < 0.001), "80 percent");
    mark = events.length;
    await press_keys("m");
    await wait_event(mark, media(id, "volumechange", "big", (event) => event.muted === true), "muted");
    await press_keys("m");
    await wait_event(mark, media(id, "volumechange", "big", (event) => event.muted === false), "unmuted");
    mark = events.length;
    await press_keys(">");
    await wait_event(mark, media(id, "ratechange", "big", (event) => event.rate === 1.25), "1.25x");
    mark = events.length;
    await press_keys("<");
    await wait_event(mark, media(id, "ratechange", "big", (event) => event.rate === 1), "1x");
    await press_keys(">");
    mark = events.length;
    await press_keys("=");
    await wait_event(mark, media(id, "ratechange", "big", (event) => event.rate === 1), "reset to 1x");
    mark = events.length;
    await press_keys("0");
    await wait_event(mark, media(id, "seeked", "big", (event) => event.time < 0.5), "0 goes to the start");
    mark = events.length;
    await press_keys("5", "0", "%");
    await wait_event(mark, media(id, "seeked", "big", (event) => Math.round(event.time) === 15), "50% goes to the middle");
    mark = events.length;
    await press_keys("$");
    await wait_event(mark, media(id, "seeked", "big", (event) => event.time > 29 || event.time < 1), "$ goes to the end");
    mark = events.length;
    await press_keys("^");
    await wait_event(mark, media(id, "seeked", "big", (event) => event.time < 0.5), "^ goes to the start");
    // The fixture videos start with loop on.
    await press_keys("r");
    await wait_toast(/^Loop off$/);
    await press_keys("r");
    await wait_toast(/^Loop on$/);
    await press_keys("i");
    await wait_toast(/loop/);
    await press_keys("L");
    await wait_toast(/^No next video$/);
    await press_keys("H");
    await wait_toast(/^No previous video$/);
    mark = events.length;
    await press_keys("-k", "space");
    await wait_event(mark, media(id, "play", "big"), "Space plays the video");
    await expect_absent(mark, id, (event) => event.type === "media_fullscreen", "a key fullscreened the video");
    await expect_absent(start, id, (event) => event.type === "media_fullscreen", "entering the mode fullscreened the video");
  });

  await run_case("% with no count is refused, and the keys of normal mode that the mode leaves out do nothing", async () => {
    const id = "p29_percent";
    await open_media_page(id);
    let mark = events.length;
    await press_keys("%");
    await wait_toast(/^Type a number first$/);
    await expect_absent(mark, id, (event) => event.type === "media_seeked", "a percent seek with no count moved the video");
    mark = events.length;
    // G scrolls to the bottom in normal mode.
    await press_keys("G");
    await expect_absent(mark, id, scroll_of(id), "G scrolled in the media mode");
  });

  await run_case("Escape ends the mode, j scrolls again, and the badge reads NORMAL", async () => {
    const id = "p29_escape";
    await open_media_page(id);
    const mark = events.length;
    await press_keys("-k", "Escape");
    await normal(mark, id);
    await j_scrolls(id);
  });

  await run_case("a hint opened from the mode returns to it after Escape and after a pick, and : returns to it after Escape and after a command", async () => {
    const id = "p29_return";
    await open_media_page(id);
    await press_keys("f");
    await poll_until("the hint labels", async () => (await hint_label_count()) > 0);
    await press_keys("-k", "Escape");
    await poll_until("the labels gone", async () => (await hint_label_count()) === 0);
    await j_is_media(id, 0.9);
    await press_keys(":");
    await wait_cmdline((line) => line.open, "the line to open");
    await close_cmdline();
    await j_is_media(id, 0.8);
    await press_keys(":");
    await wait_cmdline((line) => line.open, "the line to open");
    await type_in_line("media speed 2");
    const mark = events.length;
    await press_keys("-k", "Return");
    await wait_event(mark, media(id, "ratechange", "big", (event) => event.rate === 2), "the line's command at 2x");
    await j_is_media(id, 0.7);
    // A pick that clicks a button leaves the mode where it was.
    await press_keys(";b");
    await poll_until("the hint labels", async () => (await hint_label_count()) > 0);
    await press_keys("a");
    await poll_until("the labels gone", async () => (await hint_label_count()) === 0);
    await j_is_media(id, 0.6);
    await press_keys("q");
    await wait_cmdline((line) => line.open && line.value === "media quality ", 'the line to open with "media quality "');
    await close_cmdline();
    await j_is_media(id, 0.5);
  });

  await run_case(";M pins the hinted video, the keys act on it until the mode ends, and a new start drops the pin", async () => {
    const id = "p29_pin";
    await open_page("media_mode", id, { new_tab: true });
    await press_keys(";M");
    await poll_until("the hint labels", async () => (await hint_label_count()) === 2);
    await press_keys("s");
    await poll_until("the labels gone", async () => (await hint_label_count()) === 0);
    let mark = events.length;
    await press_keys("m");
    await wait_event(mark, media(id, "volumechange", "small", (event) => event.muted === true), "the small video muted");
    await expect_absent(mark, id, media(id, "volumechange", "big"), "the large video changed");
    mark = events.length;
    await press_keys("-k", "Escape");
    await normal(mark, id);
    mark = events.length;
    await press_keys("a", "a");
    await shown(mark, id);
    mark = events.length;
    await press_keys("m");
    await wait_event(mark, media(id, "volumechange", "big", (event) => event.muted === true), "the large video muted after a new start");
    await expect_absent(mark, id, media(id, "volumechange", "small"), "the small video changed after a new start");
  });

  await run_case("a pinned video that leaves the page, as an ad swapped for the main video does, falls back to the main video rule", async () => {
    const id = "p29_pin_lost";
    await open_page("media_mode", id, { new_tab: true });
    await press_keys(";M");
    await poll_until("the hint labels", async () => (await hint_label_count()) === 2);
    await press_keys("s");
    await poll_until("the labels gone", async () => (await hint_label_count()) === 0);
    await in_active_tab('{ const old = document.getElementById("small"); old.replaceWith(old.cloneNode()); } 0');
    const mark = events.length;
    await press_keys("m");
    await wait_event(mark, media(id, "volumechange", "big", (event) => event.muted === true), "the large video muted when the pinned one is gone");
  });

  await run_case("typing in a field focused while in the mode goes to the field, and the video keeps still", async () => {
    const id = "p29_field";
    await open_media_page(id);
    let mark = events.length;
    await in_active_tab('document.getElementById("typing").focus(); 0');
    await wait_event(mark, indicator(id, "INSERT"), "the badge to read INSERT");
    mark = events.length;
    await press_keys("h", "j", "k", "l");
    await wait_event(mark, (event) => event.type === "input" && event.page_id === id && event.value === "hjkl", "hjkl in the field");
    await expect_absent(mark, id, (event) => event.type === "media_volumechange" || event.type === "media_seeked", "a media key ran in the field");
  });

  await run_case("keys typed right behind aa do not break the mode", async () => {
    const id = "p29_early";
    await open_page("media_mode", id, { new_tab: true });
    const start = events.length;
    await press_keys("a", "a", "l");
    await shown(start, id);
    const mark = events.length;
    await press_keys("0");
    await wait_event(mark, media(id, "seeked", "big", (event) => event.time < 0.5), "0 goes to the start, so the mode holds");
  });

  await run_case("aa on a page with no video refuses and starts nothing", async () => {
    await open_page("page", "p29_none", { new_tab: true });
    const mark = events.length;
    await press_keys("a", "a");
    await wait_toast(/^No video on this page$/);
    await expect_absent(mark, "p29_none", indicator("p29_none", "MEDIA"), "the badge showed MEDIA");
  });

  await run_case("F fullscreens the player box and the mode stays, and F again leaves it and the mode returns to normal at once", async () => {
    const id = "p29_f";
    await open_media_page(id);
    let mark = events.length;
    await press_keys("F");
    const entered = await wait_event(mark, (event) => event.page_id === id && event.type === "media_fullscreen" && event.element === "player", "fullscreen to start");
    expect(entered.element === "player", "the player box did not go fullscreen");
    await expect_absent(mark, id, indicator(id, "NORMAL"), "the mode left when the fullscreen started");
    await j_is_media(id, 0.9);
    mark = events.length;
    await press_keys("F");
    await wait_event(mark, (event) => event.page_id === id && event.type === "media_fullscreen" && event.element === "", "fullscreen to end");
    await normal(mark, id);
    await j_scrolls(id);
  });

  await run_case("an element fullscreen the site's own key starts enters the mode, and Escape leaves both", async () => {
    const id = "p29_site_escape";
    await open_page("media_mode", id, { new_tab: true });
    let mark = events.length;
    await press_keys("e");
    await wait_event(mark, (event) => event.page_id === id && event.type === "media_fullscreen" && event.element === "player", "fullscreen to start");
    await hidden(mark, id);
    await j_is_media(id, 0.9);
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_event(mark, (event) => event.page_id === id && event.type === "media_fullscreen" && event.element === "", "fullscreen to end");
    await normal(mark, id);
    await j_scrolls(id);
  });

  await run_case("Escape on the line in fullscreen ends the fullscreen and closes the line, and the mode stays", async () => {
    const id = "p29_line_escape";
    await open_media_page(id);
    let mark = events.length;
    await press_keys("F");
    await wait_event(mark, (event) => event.page_id === id && event.type === "media_fullscreen" && event.element === "player", "fullscreen to start");
    await press_keys(":");
    await wait_cmdline((line) => line.open, "the line to open");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_event(mark, (event) => event.page_id === id && event.type === "media_fullscreen" && event.element === "", "fullscreen to end");
    await wait_cmdline((line) => !line.open, "the line to close with the fullscreen");
    await expect_absent(mark, id, indicator(id, "NORMAL"), "the mode ended with the fullscreen");
    await j_is_media(id, 0.9);
  });

  await run_case("the site's own key that leaves the fullscreen returns the mode to normal, and the key reaches the page in the mode", async () => {
    const id = "p29_site_exit";
    await open_page("media_mode", id, { new_tab: true });
    await press_keys("e");
    let mark = events.length;
    await hidden(0, id);
    await press_keys("e");
    await wait_event(mark, (event) => event.page_id === id && event.type === "media_fullscreen" && event.element === "", "the page's own exit");
    await normal(mark, id);
    await j_scrolls(id);
  });

  await run_case("aa in the top frame starts the mode in a frame that runs DesertFox, j there acts on its video, and Escape in the top frame ends it there", async () => {
    const id = "p29_host_escape";
    await open_page("media_mode_host", id, { new_tab: true });
    // The frame starts its content script on its first focus.
    await focus_frame(id);
    await focus_top(id);
    let mark = events.length;
    await press_keys("a", "a");
    await shown(mark, id);
    await focus_frame(id);
    await j_is_media(`${id}_inner`, 0.9);
    await focus_top(id);
    mark = events.length;
    await press_keys("-k", "Escape");
    await normal(mark, id);
    await j_scrolls(id);
    await focus_frame(id);
    mark = events.length;
    await press_keys("j");
    await wait_event(mark, scroll_of(`${id}_inner`), "j to scroll the frame, which the mode left");
    await expect_absent(mark, `${id}_inner`, (event) => event.page_id === `${id}_inner` && event.type === "media_volumechange", "the frame still took media keys");
  });

  await run_case("a frame first focused after aa starts in normal mode and leaves the mode of the top frame on", async () => {
    const id = "p29_host_late";
    await open_page("media_mode_host", id, { new_tab: true });
    const mark = events.length;
    await press_keys("a", "a");
    await shown(mark, id);
    await focus_frame(id);
    await j_scrolls(`${id}_inner`);
    await focus_top(id);
    await j_is_media(`${id}_inner`, 0.9);
  });

  await run_case("F in the top frame fullscreens a video in a frame, and the end of the fullscreen returns every frame to normal", async () => {
    const id = "p29_host_full";
    await open_page("media_mode_host", id, { new_tab: true });
    await focus_frame(id);
    await focus_top(id);
    let mark = events.length;
    await press_keys("a", "a");
    await shown(mark, id);
    mark = events.length;
    await press_keys("F");
    await wait_event(mark, (event) => event.page_id === `${id}_inner` && event.type === "media_fullscreen" && event.element === "player", "the framed player to go fullscreen");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_event(mark, (event) => event.page_id === `${id}_inner` && event.type === "media_fullscreen" && event.element === "", "the framed fullscreen to end");
    await normal(mark, id);
    await j_scrolls(id);
    await focus_frame(id);
    mark = events.length;
    await press_keys("j");
    await wait_event(mark, scroll_of(`${id}_inner`), "j to scroll the frame, which the mode left");
  });

  await run_case("a pushState keeps the mode and drops the pin so the keys act on the main video, and a load of another page ends it", async () => {
    const id = "p29_nav";
    await open_page("media_mode", id, { new_tab: true });
    await press_keys(";M");
    await poll_until("the hint labels", async () => (await hint_label_count()) === 2);
    await press_keys("s");
    await poll_until("the labels gone", async () => (await hint_label_count()) === 0);
    let mark = events.length;
    await press_keys("m");
    await wait_event(mark, media(id, "volumechange", "small", (event) => event.muted === true), "the pinned small video muted");
    mark = events.length;
    await in_active_tab('history.pushState({}, "", location.href + "&pushed=1"); 0');
    await expect_absent(mark, id, indicator(id, "NORMAL"), "the pushState ended the mode");
    // The background drops the pin when it sees the address change, which can be after the key below.
    const tab_id = await in_background("browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]?.id)");
    await poll_until("the pin dropped", async () => !(await in_background(`browser.storage.session.get("desertfox_tab_media_${tab_id}").then((got) => Object.values(got)[0]?.pin_frame !== undefined)`)));
    mark = events.length;
    await press_keys("m");
    await wait_event(mark, media(id, "volumechange", "big", (event) => event.muted === true), "the main video muted after the address change");
    await expect_absent(mark, id, media(id, "volumechange", "small"), "the dropped pin still acted");
    const next = "p29_nav_next";
    mark = events.length;
    await in_active_tab(`location.href = "/media_mode?id=${next}"; 0`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === next, "the next page to load");
    await wait_takes_keys(next);
    await j_scrolls(next);
  });

  await run_case(";M on a video in a frame refuses in words and starts no mode", async () => {
    const id = "p29_host_pin";
    await open_page("media_mode_host", id, { new_tab: true });
    await press_keys(";M");
    await poll_until("the hint labels", async () => (await hint_label_count()) > 0);
    await press_keys("a");
    await wait_toast(/^Start media mode in that frame first$/);
    await j_scrolls(id);
  });
}
