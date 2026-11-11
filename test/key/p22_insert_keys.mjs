// i enters insert mode with no field focused, in every frame of the tab, so the page gets every unbound key until Escape. I focuses the first field like gi.
// The mode badge shows on the top frame only, so a child frame's mode shows in whether j scrolls it.

import { CTRL } from "./harness.mjs";

export const areas = ["keys"];

export async function run_cases({ run_case, open_page, press_keys, wait_event, wait_takes_keys, events, expect, expect_no_scroll, poll_until, hint_label_count, scroll_delta_by_press, scroll_of, in_active_tab, in_background }) {
  const wait_badge = (mark, page_id, label) => wait_event(mark, (event) => event.type === "indicator" && event.page_id === page_id && event.label === label, `${label} on ${page_id}`);
  const page_sees = (mark, page_id, key) => wait_event(mark, (event) => event.type === "keydown" && event.key === key && event.page_id === page_id, `${page_id} to see ${key}`);
  const focus_frame = async (mark, frame_id, element_id) => {
    await in_active_tab(`document.getElementById("${element_id}").contentWindow.focus(); 0`);
    await wait_event(mark, (event) => event.type === "window_focus" && event.page_id === frame_id, `${frame_id} to take the focus`);
    await wait_takes_keys(frame_id);
  };
  // j scrolls a frame in normal mode, so a frame in insert mode shows no scroll while the page still sees the key.
  const frame_passes_j = async (frame_id) => {
    const mark = events.length;
    await press_keys("j");
    await page_sees(mark, frame_id, "j");
    await expect_no_scroll(mark, frame_id);
  };
  const frame_scrolls_on_j = async (frame_id) => {
    const mark = events.length;
    await press_keys("j");
    await wait_event(mark, scroll_of(frame_id), `j to scroll ${frame_id}`);
  };

  await run_case("i switches to insert mode with no field, the page sees j and G, and Escape returns to normal", async () => {
    await open_page("page", "p22_insert", { new_tab: true });
    let mark = events.length;
    await press_keys("i");
    await wait_badge(mark, "p22_insert", "INSERT");
    await wait_takes_keys("p22_insert");
    mark = events.length;
    await press_keys("j", "G");
    await page_sees(mark, "p22_insert", "j");
    await page_sees(mark, "p22_insert", "G");
    await expect_no_scroll(mark, "p22_insert");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, "p22_insert", "NORMAL");
    expect((await scroll_delta_by_press("p22_insert", ["G"])) > 0, "G did not scroll after Escape left insert mode");
  });

  await run_case("insert from i outlasts a field gaining and losing focus", async () => {
    await open_page("page", "p22_stays", { new_tab: true });
    await in_active_tab(`document.body.insertAdjacentHTML("afterbegin", '<input id="p22_stays_input">'); 0`);
    const mark = events.length;
    await press_keys("i");
    await wait_badge(mark, "p22_stays", "INSERT");
    await in_active_tab(`document.getElementById("p22_stays_input").focus(); document.getElementById("p22_stays_input").blur(); 0`);
    // A page that sees j and does not scroll is still in insert mode, whatever the badge reports late.
    await wait_takes_keys("p22_stays");
    const mark_j = events.length;
    await press_keys("j");
    await page_sees(mark_j, "p22_stays", "j");
    await expect_no_scroll(mark_j, "p22_stays");
  });

  // A page with no content script reports no mode, so only the navigation clear can end the hold there.
  // Only this tab's hold counts: the tab of an earlier case stays open and keeps its own.
  const holds = () => in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.storage.local.get("desertfox_tab_mode_insert_" + tab.id)).then((stored) => Object.keys(stored).length)`);
  await run_case("a navigation to a page without a content script ends the hold of i", async () => {
    await open_page("page", "p22_nav", { new_tab: true });
    const mark = events.length;
    await press_keys("i");
    await wait_badge(mark, "p22_nav", "INSERT");
    await poll_until("the hold to be stored", async () => (await holds()) === 1);
    await in_active_tab(`location.href = "about:blank"; 0`);
    await poll_until("the navigation to clear the hold", async () => (await holds()) === 0);
  });

  await run_case("I focuses the first field and enters insert mode", async () => {
    await open_page("page", "p22_field", { new_tab: true });
    await in_active_tab(`document.body.insertAdjacentHTML("afterbegin", '<input id="p22_input">'); 0`);
    const mark = events.length;
    await press_keys("I");
    await wait_badge(mark, "p22_field", "INSERT");
    expect((await in_active_tab(`document.activeElement.id`)) === "p22_input", "I did not focus the first field");
  });

  await run_case("i in a child frame shows INSERT on the badge and Escape in the frame returns every frame to normal", async () => {
    await open_page("frames", "p22_frames", { new_tab: true });
    let mark = events.length;
    await press_keys(";f");
    await poll_until("the hint labels", async () => (await hint_label_count()) > 0);
    await press_keys("a");
    await wait_event(mark, (event) => event.type === "window_focus" && event.page_id === "p22_frames_same", "the frame to take the focus");
    await wait_takes_keys("p22_frames_same");
    mark = events.length;
    await press_keys("i");
    await wait_badge(mark, "p22_frames", "INSERT");
    await wait_takes_keys("p22_frames_same");
    await frame_passes_j("p22_frames_same");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, "p22_frames", "NORMAL");
    await frame_scrolls_on_j("p22_frames_same");
  });

  await run_case("i on the top page, then keys in a frame and Escape from that frame", async () => {
    await open_page("frames", "p22_top", { new_tab: true });
    let mark = events.length;
    await press_keys("i");
    await wait_badge(mark, "p22_top", "INSERT");
    await focus_frame(mark, "p22_top_same", "same");
    await frame_passes_j("p22_top_same");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, "p22_top", "NORMAL");
    await frame_scrolls_on_j("p22_top_same");
  });

  await run_case("i and Escape on the top page return a frame to normal", async () => {
    await open_page("frames", "p22_top_esc", { new_tab: true });
    let mark = events.length;
    await press_keys("i");
    await wait_badge(mark, "p22_top_esc", "INSERT");
    await focus_frame(mark, "p22_top_esc_same", "same");
    await frame_passes_j("p22_top_esc_same");
    await in_active_tab(`document.getElementById("same").blur(); window.focus(); 0`);
    await wait_takes_keys("p22_top_esc");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, "p22_top_esc", "NORMAL");
    await focus_frame(mark, "p22_top_esc_same", "same");
    await frame_scrolls_on_j("p22_top_esc_same");
  });

  await run_case("Ctrl+R in a field in an open shadow root pastes a register and does not reload", async () => {
    await open_page("page", "p22_shadow", { new_tab: true });
    await in_active_tab(`browser.runtime.sendMessage({ type: "register_write", name: "c", text: "from c" })`);
    const mark = events.length;
    await in_active_tab(`const host = document.createElement("div"); document.body.prepend(host); host.attachShadow({ mode: "open" }).innerHTML = '<input id="p22_shadow_input">'; host.shadowRoot.getElementById("p22_shadow_input").focus(); 0`);
    await wait_badge(mark, "p22_shadow", "INSERT");
    await wait_takes_keys("p22_shadow");
    await press_keys(...CTRL("r"), "c");
    await poll_until("the shadow field to hold the register text", async () => (await in_active_tab(`document.body.firstElementChild.shadowRoot?.getElementById("p22_shadow_input")?.value ?? ""`)) === "from c");
  });

  await run_case("a frame that loads after i joins insert mode", async () => {
    await open_page("frames", "p22_late", { new_tab: true });
    let mark = events.length;
    await press_keys("i");
    await wait_badge(mark, "p22_late", "INSERT");
    mark = events.length;
    await in_active_tab(`document.body.insertAdjacentHTML("afterbegin", '<iframe id="late" src="/frame_inner?id=p22_late_new" style="display:block;width:300px;height:200px"></iframe>'); 0`);
    await poll_until("the late frame to load", async () => await in_active_tab(`document.getElementById("late").contentDocument.URL.endsWith("p22_late_new") && document.getElementById("late").contentDocument.readyState === "complete"`));
    await focus_frame(mark, "p22_late_new", "late");
    await frame_passes_j("p22_late_new");
  });

  await run_case("i leaves a frame under an all-off rule in ignore mode, and Escape keeps it there", async () => {
    await open_page("frames", "p22_off", { new_tab: true });
    // The frame holds the focus once so it has started when i reaches the tab, which then reaches it by the set_mode broadcast.
    await focus_frame(0, "p22_off_same", "same");
    await in_active_tab(`document.getElementById("same").blur(); window.focus(); 0`);
    await wait_takes_keys("p22_off");
    let mark = events.length;
    await press_keys("i");
    await wait_badge(mark, "p22_off", "INSERT");
    // Another frame took the hold, so the hold reached the tab and skipped only the all-off one.
    await focus_frame(mark, "p22_off_same", "same");
    await frame_passes_j("p22_off_same");
    await focus_frame(mark, "p22_off_cross", "cross");
    await frame_passes_j("p22_off_cross");
    await in_active_tab(`document.getElementById("cross").blur(); window.focus(); 0`);
    await wait_takes_keys("p22_off");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, "p22_off", "NORMAL");
    await focus_frame(mark, "p22_off_cross", "cross");
    await frame_scrolls_on_j("p22_off_cross");
    // The all-off frame is still in ignore mode, so j still reaches its page and scrolls nothing.
    await focus_frame(mark, "p22_off_same", "same");
    await frame_passes_j("p22_off_same");
  });
}
