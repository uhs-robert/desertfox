// Key cases of the media hint filter (#133). Firefox must give the hint keydown the user activation that play() and requestFullscreen() need.
// The fixture page /media has a video in a player box under an overlay, and a hidden audio that gets no hint.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ run_case, send_keys, open_page, wait_event, find_event, events, expect, sleep, rdp, extension_id }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);
  const in_active_tab = (code) => background(`(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }); })()`);
  const run_hint = (args) => in_active_tab(`browser.runtime.sendMessage({ type: "run", invocations: [{ id: "hint.run", args: ${JSON.stringify(args)} }], mode: "normal" }); 0`);
  const on_page = (page_id, type) => (event) => event.page_id === page_id && event.type === type;

  await run_case(";m a plays the video under the overlay, and the next pick pauses it", async () => {
    await open_page("media", "p6_media_play", { new_tab: true });
    let mark = events.length;
    await send_keys(";m");
    await send_keys("a");
    await wait_event(mark, on_page("p6_media_play", "media_play"), "the video to play");
    mark = events.length;
    await send_keys(";m");
    await send_keys("a");
    await wait_event(mark, on_page("p6_media_play", "media_pause"), "the video to pause");
  });

  await run_case("the hidden audio gets no hint", async () => {
    // One label only: "s" after ";m" would pick a second element if the audio had a hint.
    const mark = events.length;
    await send_keys(";m");
    await send_keys("s");
    await sleep(500);
    expect(!find_event(mark, (event) => event.page_id === "p6_media_play" && event.type === "media_play"), "a second hint started the video");
    await send_keys("-k", "Escape");
  });

  await run_case("hint --mute mutes and unmutes", async () => {
    await open_page("media", "p6_media_mute", { new_tab: true });
    let mark = events.length;
    await run_hint({ filter: "media", action: "mute" });
    await send_keys("a");
    const muted = await wait_event(mark, on_page("p6_media_mute", "media_volume"), "the volume change");
    expect(muted.muted === true, "the video is not muted");
    mark = events.length;
    await run_hint({ filter: "media", action: "mute" });
    await send_keys("a");
    const unmuted = await wait_event(mark, on_page("p6_media_mute", "media_volume"), "the second volume change");
    expect(unmuted.muted === false, "the video is still muted");
  });

  await run_case("hint --fullscreen shows the player box in fullscreen, and a second pick leaves it", async () => {
    await open_page("media", "p6_media_full", { new_tab: true });
    let mark = events.length;
    await run_hint({ filter: "media", action: "fullscreen" });
    await send_keys("a");
    const entered = await wait_event(mark, on_page("p6_media_full", "media_fullscreen"), "fullscreen to start");
    expect(entered.element === "player", `the fullscreen element is "${entered.element}"`);
    mark = events.length;
    await run_hint({ filter: "media", action: "fullscreen" });
    await send_keys("a");
    const left = await wait_event(mark, on_page("p6_media_full", "media_fullscreen"), "fullscreen to end");
    expect(left.element === "", `the fullscreen element is "${left.element}"`);
  });
}
