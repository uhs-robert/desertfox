// Key cases of piece P6 (hint extras): copy, rapid mode and the text filter. run.mjs calls run_cases with its helpers.
// The fixture page /hints has a hidden link and a covered link before the visible links "one" and "two", labelled "a" and "s".
// There is no key for the text filter yet, so the cases send the same `run` message a key sends, from the active tab.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, find_event, events, expect, sleep, scroll_delta_after, became_visible, take_shot }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);
  const tab_count = () => background(`(async () => (await browser.tabs.query({})).length)()`);
  const close_tabs_with = (text) => background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes(${JSON.stringify(text)})) await browser.tabs.remove(tab.id); })()`);
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;
  const paste_ctrl_v = ["-M", "ctrl", "v", "-m", "ctrl"];

  // Runs code in the active tab's content script world.
  const in_active_tab = (code) => background(`(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }); })()`);
  const run_hint = (args) => in_active_tab(`browser.runtime.sendMessage({ type: "run", invocations: [{ id: "hint.run", args: ${JSON.stringify(args)} }], mode: "normal" }); 0`);
  const link_count = async () => (await in_active_tab(`document.querySelectorAll("a[href]").length`))[0];

  await run_case(";y a copies the link address", async () => {
    await open_page("hints", "p6_copy", { new_tab: true });
    await send_keys(";y");
    await send_keys("a");
    await sleep(500);
    await open_page("field", "p6_paste", { new_tab: true });
    await sleep(300);
    const mark = events.length;
    await send_keys(...paste_ctrl_v);
    const pasted = await wait_event(mark, (event) => event.type === "input" && event.page_id === "p6_paste", "the pasted address");
    expect(pasted.value.endsWith("/page?id=hint_one"), `;y copied "${pasted.value}"`);
  });

  await run_case(";r opens each pick in a background tab and keeps picking until Escape", async () => {
    await open_page("hints", "p6_rapid", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    await send_keys(";r");
    await send_keys("a");
    await send_keys("s");
    await wait_event(mark, loaded("hint_two"), "the second link to load after two picks");
    await sleep(500);
    expect((await tab_count()) === tabs_before + 2, "two picks did not open two tabs");
    expect(!find_event(mark, became_visible("hint_one")) && !find_event(mark, became_visible("hint_two")), "a background tab came to the front");
    await send_keys("-k", "Escape");
    await send_keys("a");
    await sleep(800);
    expect((await tab_count()) === tabs_before + 2, "a opened a link after Escape");
    expect((await scroll_delta_after("p6_rapid", ["j"])) > 0, "keys did not work again after Escape");
    await close_tabs_with("hint_one");
    await close_tabs_with("hint_two");
    await sleep(300);
  });

  await run_case("rapid delete labels the page again after each pick, and ends when nothing is left", async () => {
    await open_page("hints", "p6_delete", { new_tab: true });
    expect((await link_count()) === 4, "the fixture does not hold four links");
    await run_hint({ action: "delete", filter: "links", rapid: true });
    await sleep(600);
    await send_keys("a");
    await sleep(400);
    expect((await link_count()) === 3, "the first pick did not delete a link");
    await send_keys("a");
    await sleep(400);
    expect((await link_count()) === 2, "the second pick did not delete the next link");
    // Only the hidden and the covered link are left, so the rebuild finds nothing and hint mode ends.
    expect((await scroll_delta_after("p6_delete", ["j"])) > 0, "hint mode did not end when no link was left");
  });

  await run_case("rapid here follows a click that removes the link", async () => {
    await open_page("hints", "p6_here", { new_tab: true });
    await in_active_tab(`for (const link of document.querySelectorAll("a[href]")) link.addEventListener("click", (event) => { event.preventDefault(); link.remove(); }); 0`);
    await run_hint({ action: "here", filter: "links", rapid: true });
    await sleep(600);
    await send_keys("a");
    await sleep(400);
    await send_keys("a");
    await sleep(400);
    expect((await link_count()) === 2, "two picks did not remove two links");
    expect((await scroll_delta_after("p6_here", ["j"])) > 0, "hint mode did not end when no link was left");
  });

  await run_case("text with one match opens it at once and leaves hint mode", async () => {
    await open_page("hints", "p6_one_match", { new_tab: true });
    const tabs_before = await tab_count();
    const mark = events.length;
    await run_hint({ action: "background", filter: "links", text: "TWO", rapid: true });
    await wait_event(mark, loaded("hint_two"), "the matching link to load");
    await sleep(300);
    expect((await tab_count()) === tabs_before + 1, "the match did not open exactly one tab");
    expect((await scroll_delta_after("p6_one_match", ["j"])) > 0, "hint mode did not end after the one match");
    await close_tabs_with("hint_two");
    await sleep(300);
  });

  await run_case("text with no match shows a notice and leaves keys alone", async () => {
    await open_page("hints", "p6_no_match", { new_tab: true });
    await run_hint({ filter: "links", text: "zzz" });
    await sleep(500);
    expect((await scroll_delta_after("p6_no_match", ["j"])) > 0, "keys did not work after a text with no match");
  });

  // Set OASISFOX_SHOT_DIR to also save the two screenshots.
  const shot_dir = process.env.OASISFOX_SHOT_DIR;
  if (shot_dir) {
    await run_case("screenshot of rapid mode after a pick", async () => {
      await open_page("hints", "p6_shot_rapid", { new_tab: true });
      await send_keys(";r");
      await send_keys("a");
      await sleep(800);
      await take_shot(`${shot_dir}/p6_rapid_after_pick.png`);
      await send_keys("-k", "Escape");
      await close_tabs_with("hint_one");
      await sleep(300);
    });

    await run_case("screenshot of the no-match notice", async () => {
      await open_page("hints", "p6_shot_notice", { new_tab: true });
      await run_hint({ filter: "links", text: "zzz" });
      await sleep(400);
      await take_shot(`${shot_dir}/p6_no_match_notice.png`);
      await sleep(1500);
    });
  }
}
