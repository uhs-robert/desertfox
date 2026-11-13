// Key cases of the frames hint filter (#134). A subframe starts its content script on its first focus, and gF returns the keys to the top page.
// The fixture page /frames holds a same-origin frame (a), a cross-origin frame (s) and a 10 px frame that gets no label.
// The command line, which-key, the page search input and the toasts draw in the top page for a focused frame, and the keys and commands still act in the frame (#619).

export const areas = ["hints", "cmdline", "whichkey", "ui"];

export async function run_cases({ in_background, sleep, badge_is, open_cmdline, type_in_line, run_line, wait_cmdline, close_cmdline, run_case, press_keys, poll_until, barrier, expect_absent, hint_label_count, open_page, wait_event, find_event, events, expect, wait_takes_keys, scroll_of, last_scroll_y, in_active_tab }) {
  const page_id = "p6_frames";
  const on_page = (id, type) => (event) => event.page_id === id && event.type === type;
  const script_starts = (id) => events.filter(on_page(id, "tree_read")).length;
  const press_hint_start = async (keys) => {
    await press_keys(keys);
    await poll_until(`the hint labels after ${keys}`, async () => (await hint_label_count()) > 0);
  };
  // gF hands the keys back to the top page, which reports the focus it takes.
  const press_gF_on = async (id) => {
    const mark = events.length;
    await press_keys("gF");
    await wait_event(mark, on_page(id, "window_focus"), "the top page to take the focus after gF");
  };
  const press_gF = () => press_gF_on(page_id);

  const frame_loaded = (id, name) => poll_until(`the ${name} frame to load`, async () => await in_active_tab(`document.getElementById("same").contentDocument.URL.endsWith("id=${id}_same") && document.getElementById("same").contentDocument.readyState === "complete"`));
  await run_case("an unfocused same-origin frame has no script", async () => {
    await open_page("frames", "p6_frames_idle", { new_tab: true });
    await frame_loaded("p6_frames_idle", "same-origin");
    // The barrier reaches the top page, which starts at load, so a same-origin frame that starts at load has started by now.
    await barrier("p6_frames_idle");
    expect(script_starts("p6_frames_idle_same") === 0, `the unfocused same-origin frame started ${script_starts("p6_frames_idle_same")} times`);
  });

  await run_case(";f a focuses the same-origin frame, and j then scrolls that frame", async () => {
    await open_page("frames", page_id, { new_tab: true });
    const before_top = last_scroll_y(page_id);
    const mark = events.length;
    await press_hint_start(";f");
    await press_keys("a");
    await wait_event(mark, on_page(`${page_id}_same`, "window_focus"), "the frame to take the focus");
    await wait_takes_keys(`${page_id}_same`);
    await press_keys("j");
    await wait_event(mark, scroll_of(`${page_id}_same`), "j to scroll the frame");
    expect(last_scroll_y(page_id) === before_top, "j scrolled the top page");
  });

  await run_case("a cross-origin frame has no script until its first focus, then starts once", async () => {
    expect(script_starts(`${page_id}_cross`) === 0, "the cross-origin frame started before any focus");
    expect(script_starts(`${page_id}_tiny`) === 0, "the unfocused 10 px frame started");
    await press_keys("-k", "Escape");
    await press_gF();
    const mark = events.length;
    await press_hint_start(";f");
    await press_keys("s");
    await wait_event(mark, on_page(`${page_id}_cross`, "tree_read"), "the cross-origin frame to start on focus");
    // The barrier reaches the frame that holds the keys, so a second start would have shown by the time it reports.
    await barrier(`${page_id}_cross`);
    expect(script_starts(`${page_id}_cross`) === 1, `the cross-origin frame started ${script_starts(`${page_id}_cross`)} times`);
  });

  await run_case("j scrolls the cross-origin frame, and gF returns the keys to the top page", async () => {
    let mark = events.length;
    await press_keys("j");
    await wait_event(mark, scroll_of(`${page_id}_cross`), "j to scroll the cross-origin frame");
    const before_top = last_scroll_y(page_id);
    mark = events.length;
    await press_gF();
    await press_keys("j");
    await wait_event(mark, scroll_of(page_id), "j to scroll the top page after gF");
    expect(last_scroll_y(page_id) > before_top, "the top page did not scroll after gF");
  });

  await run_case("gF on the top page does nothing", async () => {
    const mark = events.length;
    await press_keys("gF");
    await press_keys("j");
    await wait_event(mark, scroll_of(page_id), "j to scroll the top page after gF on the top page");
  });

  await run_case("the 10 px frame gets no label", async () => {
    const mark = events.length;
    await press_hint_start(";f");
    await press_keys("d");
    await press_keys("-k", "Escape");
    await poll_until("the labels to go after Escape", async () => (await hint_label_count()) === 0);
    await expect_absent(mark, page_id, on_page(`${page_id}_tiny`, "window_focus"), "the 10 px frame took the focus");
  });

  // Tab walks the frames in page order: the same-origin one, the cross-origin one, then the 10 px one, which nothing has focused yet.
  await run_case("Tab into a cross-origin frame starts its script", async () => {
    const mark = events.length;
    for (let presses = 0; presses < 4 && !find_event(mark, on_page(`${page_id}_tiny`, "window_focus")); presses++) {
      const press_mark = events.length;
      await press_keys("-k", "Tab");
      await wait_event(press_mark, (event) => event.type === "window_focus" && event.page_id.startsWith(`${page_id}_`), "a frame to take the focus after Tab");
    }
    await wait_event(mark, on_page(`${page_id}_tiny`, "tree_read"), "the 10 px frame to start on its Tab focus");
    await press_gF();
  });

  await run_case("a focused cross-origin frame that navigates keeps the keys, and once removed the top page takes them", async () => {
    let mark = events.length;
    await press_hint_start(";f");
    await press_keys("s");
    await wait_event(mark, on_page(`${page_id}_cross`, "window_focus"), "the cross-origin frame to take the focus");
    mark = events.length;
    await in_active_tab(`document.getElementById("cross").src = "http://localhost:" + location.port + "/frame_inner?id=${page_id}_moved"`);
    await wait_event(mark, on_page(`${page_id}_moved`, "tree_read"), "the navigated frame to start at once, still focused");
    // The frame gets its focus back a moment after its script starts, and j sooner is lost. Its window_focus report comes too early to wait on (tried: j was still lost), so the key probe waits for a key to reach it.
    await wait_takes_keys(`${page_id}_moved`);
    await press_keys("j");
    await wait_event(mark, scroll_of(`${page_id}_moved`), "j to scroll the navigated frame");
    const before_top = last_scroll_y(page_id);
    mark = events.length;
    await in_active_tab(`document.getElementById("cross").remove()`);
    await wait_takes_keys(page_id);
    await press_keys("j");
    await wait_event(mark, scroll_of(page_id), "j to scroll the top page after the focused frame left");
    expect(last_scroll_y(page_id) > before_top, "the top page did not scroll after the frame left");
  });

  await run_case("f follows a link inside a same-origin frame that has not started", async () => {
    await open_page("frames", "p6_frames_link", { new_tab: true });
    await frame_loaded("p6_frames_link", "same-origin");
    await in_active_tab(`document.getElementById("same").contentDocument.body.insertAdjacentHTML("afterbegin", '<a href="/frame_inner?id=p6_frames_link_followed">framed link</a>'); 0`);
    await barrier("p6_frames_link");
    expect(script_starts("p6_frames_link_same") === 0, "the same-origin frame started before the pick");
    await press_hint_start("f");
    await press_keys("a");
    await poll_until("the frame to follow the link", async () => (await in_active_tab(`document.getElementById("same").contentDocument.URL`)).endsWith("/frame_inner?id=p6_frames_link_followed"));
  });

  // A pick from the top page mounts the line in the top page, whichever frame holds the element. A pick made inside a focused frame mounts it in that frame. Either way the one line is open and takes the keys.
  await run_case(";:f a from the top page opens the line with the address of the same-origin frame", async () => {
    await open_page("frames", "p6_frames_prompt", { new_tab: true });
    await press_hint_start(";:f");
    await press_keys("a");
    await wait_cmdline((line) => line.open && line.value.startsWith("open ") && line.value.endsWith("/frame_inner?id=p6_frames_prompt_same"), "the line to hold the frame address");
    expect(await in_active_tab(`!!document.documentElement.querySelector(":scope > [popover][data-desertfox-layer]")`), "the line holder is not in the top page");
    await close_cmdline();
  });

  // The line's holder is a popover on the page's root.
  const LINE_IN_TOP = `!!document.documentElement.querySelector(":scope > [popover][data-desertfox-layer]")`;
  await run_case(";:l inside a focused same-origin frame opens the line in the top page with the address of its link", async () => {
    await open_page("frames", "p6_frames_prompt_in", { new_tab: true });
    await frame_loaded("p6_frames_prompt_in", "same-origin");
    await in_active_tab(`document.getElementById("same").contentDocument.body.insertAdjacentHTML("afterbegin", '<a href="/page?id=framed_link">framed link</a>'); 0`);
    const mark = events.length;
    await press_hint_start(";f");
    await press_keys("a");
    await wait_event(mark, on_page("p6_frames_prompt_in_same", "window_focus"), "the frame to take the focus");
    await wait_takes_keys("p6_frames_prompt_in_same");
    await press_keys(";:l");
    // The labels sit in the frame's own document, which the top-page count cannot see.
    await poll_until("the label of the framed link", async () => await in_active_tab(`[...document.getElementById("same").contentDocument.documentElement.children].some((child) => child.openOrClosedShadowRoot?.querySelector(".desertfox-hint"))`));
    await press_keys("a");
    await wait_cmdline((line) => line.open && line.value.startsWith("open ") && line.value.endsWith("/page?id=framed_link"), "the line to hold the address of the framed link");
    expect(await in_active_tab(LINE_IN_TOP), "the line holder is not in the top page");
    expect(!(await in_active_tab(`!!document.getElementById("same").contentDocument.documentElement.querySelector(":scope > [popover][data-desertfox-layer]")`)), "the line holder is in the frame");
    await close_cmdline();
  });

  // The cross-origin frame (s) on its own page. Its document is not readable from the top page, so these read it with a script in every frame.
  const top_id = "p6_frames_top";
  const cross_id = `${top_id}_cross`;
  const in_cross_frame = (code) =>
    in_background(`(async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const answers = await browser.tabs.executeScript(tab.id, { allFrames: true, code: ${JSON.stringify(`location.href.includes("id=${cross_id}") ? (${code}) : null`)} });
      return answers.find((answer) => answer !== null);
    })()`);
  // A top-layer host of the given layer (src/shared/layers.ts) among the root's children, where the surfaces mount.
  const surface_in = (z_index) => `[...document.documentElement.children].some((child) => child.style.zIndex === "${z_index}")`;
  const WHICH_KEY_Z = 2147483646;
  const TOAST_Z = 2147483645;
  const read_top_toast = () =>
    in_active_tab(`(() => {
      const host = [...document.documentElement.children].find((child) => child.style.zIndex === "${TOAST_Z}");
      return host ? host.openOrClosedShadowRoot.querySelector(".desertfox-toast")?.textContent ?? "" : "";
    })()`);
  const focus_cross = async () => {
    const mark = events.length;
    await press_hint_start(";f");
    await press_keys("s");
    await wait_event(mark, on_page(cross_id, "window_focus"), "the cross-origin frame to take the focus");
    // The badge shows that the top page heard of the focused frame, which also starts its watch on that frame.
    await wait_event(mark, badge_is(top_id, "FRAME"), "the badge to show FRAME");
    await wait_takes_keys(cross_id);
  };

  await run_case(";f into a cross-origin frame shows the FRAME badge and the cue toast in the top page", async () => {
    await open_page("frames", top_id, { new_tab: true });
    await focus_cross();
    await poll_until("the cue toast in the top page", async () => (await read_top_toast()) === "Keys act in this frame. gF returns to the page.");
  });

  await run_case(": in a focused cross-origin frame opens the line in the top page, and Escape gives the keys back to the frame", async () => {
    await open_cmdline();
    expect(await in_active_tab(LINE_IN_TOP), "the line holder is not in the top page");
    expect((await in_cross_frame(surface_in("2147483647"))) === false, "the line holder is in the frame");
    await close_cmdline();
    // The focus hand-back: the frame of another site calls window.focus() on itself while the top page's line had the focus.
    await wait_takes_keys(cross_id);
    const before_top = last_scroll_y(top_id);
    const mark = events.length;
    await press_keys("j");
    await wait_event(mark, scroll_of(cross_id), "j to scroll the frame after the line closed");
    expect(last_scroll_y(top_id) === before_top, "j scrolled the top page");
  });

  await run_case("a command from the top page's line acts on the focused frame", async () => {
    const before_top = last_scroll_y(top_id);
    const mark = events.length;
    await run_line(":scroll 5");
    await wait_event(mark, scroll_of(cross_id), ":scroll to scroll the frame");
    expect(last_scroll_y(top_id) === before_top, ":scroll scrolled the top page");
  });

  await run_case("a which-key prefix in a focused cross-origin frame shows the panel in the top page", async () => {
    await wait_takes_keys(cross_id);
    await press_keys("g");
    await poll_until("the which-key panel in the top page", async () => await in_active_tab(surface_in(WHICH_KEY_Z)));
    expect((await in_cross_frame(surface_in(WHICH_KEY_Z))) === false, "the panel is in the frame");
    await press_keys("-k", "Escape");
    await poll_until("the panel to go after Escape", async () => !(await in_active_tab(surface_in(WHICH_KEY_Z))));
  });

  await run_case("/ in a focused cross-origin frame searches the frame, not the top page", async () => {
    await in_cross_frame(`(document.body.insertAdjacentHTML("afterbegin", "<p>zebrafish</p>"), true)`);
    await wait_takes_keys(cross_id);
    await press_keys("/");
    await wait_cmdline((line) => line.open && line.focused, "the search line to open");
    expect(await in_active_tab(LINE_IN_TOP), "the search line is not in the top page");
    await type_in_line("zebrafish", { until: (line) => line.note.startsWith("1 of 1"), what: "the frame's match count under the line" });
    await press_keys("-k", "Return");
    await wait_cmdline((line) => !line.open, "the search line to close after Enter");
    // The highlights are the content script's, readable only in the page's own world.
    const CURRENT_MATCHES = `window.wrappedJSObject.eval('CSS.highlights.get("oasis-find-current")?.size ?? 0')`;
    await poll_until("the frame to keep the current match", async () => (await in_cross_frame(CURRENT_MATCHES)) === 1);
    expect((await in_active_tab(CURRENT_MATCHES)) === 0, "the top page holds a match");
    await wait_takes_keys(cross_id);
  });

  await run_case("a focused frame that gets display none gives the keys back to the top page", async () => {
    await in_active_tab(`document.getElementById("cross").style.display = "none"`);
    await wait_takes_keys(top_id);
    const mark = events.length;
    await press_keys("j");
    await wait_event(mark, scroll_of(top_id), "j to scroll the top page after the frame hid");
    await in_active_tab(`document.getElementById("cross").style.display = "block"`);
  });

  // Firefox itself moves the focus out of a frame that gets display none or visibility hidden. It keeps the focus in a frame that turns transparent or shrinks, and the top page's watch takes it back.
  for (const [what, hide, show] of [
    ["opacity 0", `style.opacity = "0"`, `style.opacity = ""`],
    // The frame's own border counts in its box, so the test drops it.
    ["no height", `style.height = "0"; document.getElementById("cross").style.border = "0"`, `style.height = "200px"; document.getElementById("cross").style.border = ""`],
  ]) {
    await run_case(`a focused frame that gets ${what} gives the keys back to the top page`, async () => {
      await focus_cross();
      await in_active_tab(`document.getElementById("cross").${hide}`);
      await wait_takes_keys(top_id);
      await in_active_tab(`document.getElementById("cross").${show}`);
    });
  }

  await run_case("a frame focused while hidden keeps the keys once it shows, as a panel that animates open", async () => {
    let mark = events.length;
    await in_active_tab(`document.getElementById("cross").style.opacity = "0"; document.getElementById("cross").focus()`);
    await wait_event(mark, on_page(cross_id, "window_focus"), "the hidden frame to take the focus");
    await in_active_tab(`document.getElementById("cross").style.opacity = "1"`);
    // Several checks of the top page's watch (300 ms apart) pass while the frame shows.
    await sleep(1000);
    await wait_takes_keys(cross_id);
    mark = events.length;
    await press_keys("j");
    await wait_event(mark, scroll_of(cross_id), "j to scroll the frame that showed");
    await press_gF_on(top_id);
  });
}
