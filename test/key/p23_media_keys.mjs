// The a group and A: the media keys reach a video in another frame, inside a closed shadow root, with the key pressed in the top frame. The page /media_frames also holds a sandboxed frame and an about:blank frame, where the background's script injection may be refused.
// Each case reads what the page's video reports, so a second listener from a second injection shows as a double step.

export const areas = ["media", "keys"];

export async function run_cases({ run_case, setup, open_page, press_keys, wait_event, expect_absent, wait_cmdline, type_in_line, events, expect, in_active_tab, poll_until, settle_focus, close_cmdline }) {
  const top = "p23_media";
  const inner = "p23_media_inner";
  const report = (page_id, type, check = () => true) => (event) => event.page_id === page_id && event.type === `media_${type}` && check(event);
  // The toast text sits in a closed shadow root. The extension's own world reads it with openOrClosedShadowRoot.
  const read_toast = () =>
    in_active_tab(`(() => {
      const host = [...document.documentElement.children].find((child) => child.style.zIndex === "2147483645");
      return host ? host.openOrClosedShadowRoot.querySelector(".desertfox-toast")?.textContent ?? "" : "";
    })()`);
  const wait_toast = (text) => poll_until(`the notice "${text}"`, async () => (await read_toast()) === text);

  await setup("open the media page and wait for the framed video to play", async () => {
    const mark = events.length;
    await open_page("media_frames", top, { new_tab: true });
    await wait_event(mark, report(inner, "play"), "the framed video to start");
  });

  await run_case("as speeds up the video that plays in the other frame, not the larger idle one on top", async () => {
    const mark = events.length;
    await press_keys("a", "s");
    await wait_event(mark, report(inner, "ratechange", (event) => event.rate === 1.25), "the framed video at 1.25x");
    await wait_toast("Speed 1.25x");
    await expect_absent(mark, top, report(top, "ratechange"), "the idle top video changed speed");
  });

  await run_case("3as moves three steps in one press, and ar resets to 1x", async () => {
    let mark = events.length;
    await press_keys("3", "a", "s");
    await wait_event(mark, report(inner, "ratechange", (event) => event.rate === 2), "the framed video at 2x");
    mark = events.length;
    await press_keys("a", "r");
    await wait_event(mark, report(inner, "ratechange", (event) => event.rate === 1), "the framed video back at 1x");
    await wait_toast("Speed 1x");
  });

  await run_case("a count on ap is refused and plays or pauses nothing", async () => {
    const mark = events.length;
    await press_keys("2", "a", "p");
    await poll_until("the count refusal", async () => (await read_toast()).includes("times needs value"));
    await expect_absent(mark, top, report(inner, "pause"), "2ap paused the framed video");
  });

  await run_case("ap pauses the video in the other frame while the top frame holds the focus", async () => {
    const mark = events.length;
    await press_keys("a", "p");
    await wait_event(mark, report(inner, "pause"), "the framed video to pause");
    await wait_toast("Paused");
  });

  await run_case("with nothing playing, the keys act on the largest visible video", async () => {
    let mark = events.length;
    await press_keys("a", "s");
    await wait_event(mark, report(top, "ratechange", (event) => event.rate === 1.25), "the top video at 1.25x");
    mark = events.length;
    await press_keys("a", "V");
    await wait_event(mark, report(top, "volumechange", (event) => event.volume === 0.95), "the top video at 95%");
    await wait_toast("Volume 95%");
    mark = events.length;
    await press_keys("a", "l");
    await wait_event(mark, report(top, "seeked", (event) => Math.round(event.time) === 10), "the top video at 10 s");
    await wait_toast("0:10 of 0:30");
    await expect_absent(mark, top, (event) => event.page_id === inner && event.type.startsWith("media_"), "the framed video changed");
  });

  await run_case("A opens the line with media typed, and speed 2 sets the largest video to 2x", async () => {
    await press_keys("A");
    await wait_cmdline((line) => line.open && line.value === "media ", 'the line to open with "media "');
    await type_in_line("speed 2");
    const mark = events.length;
    await press_keys("-k", "Return");
    await wait_event(mark, report(top, "ratechange", (event) => event.rate === 2), "the top video at 2x");
  });

  const run_line = async (text) => {
    await press_keys("A");
    await wait_cmdline((line) => line.open && line.value === "media ", 'the line to open with "media "');
    await type_in_line(text);
    await press_keys("-k", "Return");
  };

  await run_case("media mute toggles the video, not the tab, and media loop toggles loop", async () => {
    let mark = events.length;
    await run_line("mute");
    await wait_event(mark, report(top, "volumechange", (event) => event.muted === true), "the top video muted");
    await wait_toast("Muted");
    mark = events.length;
    await run_line("mute");
    await wait_event(mark, report(top, "volumechange", (event) => event.muted === false), "the top video unmuted");
    await run_line("loop");
    await wait_toast("Loop off");
    await run_line("info");
    await poll_until("the info line", async () => /^0:\d\d of 0:30, 2x, volume 95%, paused$/.test(await read_toast()));
  });

  await run_case("media seek end and percent move the video, percent reading the count", async () => {
    let mark = events.length;
    // press_keys reads a leading "--" as one of its own options, so the count goes in as the args the validator checks.
    await in_active_tab('browser.runtime.sendMessage({ type: "run", invocations: [{ id: "media.act", args: { action: "seek", value: "percent", times: 1 } }], mode: "normal" }); 0');
    await wait_event(mark, report(top, "seeked", (event) => event.time > 0.2 && event.time < 0.4), "the top video at 1 percent");
    // A percent seek with no count is refused by the schema, so no video moves.
    mark = events.length;
    await in_active_tab('browser.runtime.sendMessage({ type: "run", invocations: [{ id: "media.act", args: { action: "seek", value: "percent" } }], mode: "normal" }); 0');
    await poll_until("the refusal of a percent seek with no count", async () => (await read_toast()) === "Type a number first");
    await expect_absent(mark, top, report(top, "seeked"), "a percent seek with no count moved the video");
    mark = events.length;
    await run_line("seek end");
    await wait_event(mark, report(top, "seeked", (event) => event.time > 29 || event.time < 1), "the top video at the end");
  });

  await run_case("ap plays the largest video when none plays", async () => {
    const mark = events.length;
    await press_keys("a", "p");
    await wait_event(mark, report(top, "play"), "the top video to play");
    await wait_toast("Playing");
  });

  await run_case("aP opens picture-in-picture on the playing video, and a second aP closes it", async () => {
    let mark = events.length;
    await press_keys("a", "P");
    await wait_event(mark, report(top, "enterpictureinpicture"), "picture-in-picture to open");
    await wait_toast("Picture-in-picture on");
    // In the nested session the picture-in-picture window takes the focus, so the next key needs the page focused again.
    await settle_focus();
    mark = events.length;
    await press_keys("a", "P");
    await wait_event(mark, report(top, "leavepictureinpicture"), "picture-in-picture to close");
  });

  // Firefox lets a frame play sound once the top page has had a key press, so the key's activation reaches play() through the background.
  await run_case("ap in the top frame plays a framed video with sound from another origin", async () => {
    const audible_inner = "p23_audible_inner";
    await open_page("media_frames", "p23_audible", { new_tab: true });
    const mark = events.length;
    await press_keys("a", "p");
    await wait_event(mark, report(audible_inner, "play", (event) => event.muted === false), "the framed video to play with sound");
  });

  // The key's transient activation stays in the top frame, so a frame from another origin refuses picture-in-picture.
  await run_case("aP on a video in a frame from another origin refuses in words", async () => {
    await open_page("media_frames", "p23_clip", { new_tab: true });
    const mark = events.length;
    await press_keys("a", "P");
    await wait_toast("This frame allows picture-in-picture only from a click in it");
    await expect_absent(mark, "p23_clip", report("p23_clip_inner", "enterpictureinpicture"), "picture-in-picture opened");
  });

  // The page's own fullscreenchange report is the proof that a key press through the background round trip still counts as the user gesture.
  await run_case("af fullscreens the player box with its overlay, and F in the media mode it starts leaves", async () => {
    await open_page("media", "p23_full", { new_tab: true });
    const on_page = (type) => (event) => event.page_id === "p23_full" && event.type === type;
    let mark = events.length;
    await press_keys("a", "f");
    const entered = await wait_event(mark, on_page("media_fullscreen"), "fullscreen to start");
    expect(entered.element === "player", `the fullscreen element is "${entered.element}"`);
    mark = events.length;
    // The fullscreen started the media mode, where F toggles it and a is a plain key.
    await press_keys("F");
    const left = await wait_event(mark, on_page("media_fullscreen"), "fullscreen to end");
    expect(left.element === "", `the fullscreen element is "${left.element}"`);
  });

  await run_case("af on a video in a frame fullscreens it, and F leaves although the top page is fullscreen too", async () => {
    await open_page("media_host", "p23_host", { new_tab: true });
    const on_frame = (event) => event.page_id === "p23_host_inner" && event.type === "media_fullscreen";
    let mark = events.length;
    await press_keys("a", "f");
    const entered = await wait_event(mark, on_frame, "fullscreen to start in the frame");
    expect(entered.element === "player", `the fullscreen element is "${entered.element}"`);
    mark = events.length;
    await press_keys("F");
    const left = await wait_event(mark, on_frame, "fullscreen to end in the frame");
    expect(left.element === "", `the fullscreen element is "${left.element}"`);
  });

  // The fixture /quality defines a fake site player on the page's own objects, so the bundle crosses from the content-script world to the page world as it does on the real sites.
  const on_quality = (page_id, check = () => true) => (event) => event.page_id === page_id && event.type === "quality_set" && check(event);

  await run_case("media quality lists the levels of a YouTube-style player and the line completes them", async () => {
    await open_page("quality", "p23_quality_yt", { new_tab: true });
    await run_line("quality");
    await poll_until("the level list", async () => (await read_toast()) === "Quality: 1080p60, 720p (now), 480p");
    await press_keys("A");
    await wait_cmdline((line) => line.open && line.value === "media ", 'the line to open with "media "');
    const line = await type_in_line("quality ", { until: (state) => state.row_texts.some((text) => text.includes("1080p")), what: "the live levels in the list" });
    // The row is named by the height the schema takes, with the site's label beside it.
    expect(line.row_texts.some((text) => text.startsWith("max")) && line.row_texts.some((text) => text.startsWith("480p")) && line.row_texts.some((text) => text.startsWith("1080p") && text.includes("1080p60")), `the rows are ${JSON.stringify(line.row_texts)}`);
    await close_cmdline();
  });

  await run_case("media quality max, a height, down and auto call the player's own range and name the level", async () => {
    let mark = events.length;
    await run_line("quality max");
    await wait_event(mark, on_quality("p23_quality_yt", (event) => event.low === "hd1080" && event.high === "hd1080"), "the player at 1080p");
    await wait_toast("Quality 1080p60");
    mark = events.length;
    await run_line("quality 480p");
    await wait_event(mark, on_quality("p23_quality_yt", (event) => event.low === "large"), "the player at 480p");
    mark = events.length;
    await run_line("quality up");
    await wait_event(mark, on_quality("p23_quality_yt", (event) => event.low === "hd720"), "the player one level up");
    mark = events.length;
    await run_line("quality auto");
    await wait_event(mark, on_quality("p23_quality_yt", (event) => event.low === "large" && event.high === "hd1080"), "the player handed back to the site");
    await wait_toast("Quality auto");
  });

  await run_case("media info names the playing level, and media skip calls the player's next and previous video", async () => {
    await run_line("info");
    await poll_until("the info line with the level", async () => /^0:\d\d of 0:30, 1x, \d+p, volume 100%/.test(await read_toast()));
    let mark = events.length;
    await run_line("skip");
    await wait_event(mark, (event) => event.page_id === "p23_quality_yt" && event.type === "quality_skip" && event.to === "next", "the next video call");
    await wait_toast("Next video");
    mark = events.length;
    await run_line("skip previous");
    await wait_event(mark, (event) => event.page_id === "p23_quality_yt" && event.type === "quality_skip" && event.to === "previous", "the previous video call");
  });

  await run_case("a player that replaces itself in place is found again, with its own levels", async () => {
    await in_active_tab('document.getElementById("replace").click(); 0');
    const mark = events.length;
    await run_line("quality max");
    await wait_event(mark, on_quality("p23_quality_yt", (event) => event.low === "hd2160"), "the new player at 2160p");
    await wait_toast("Quality 2160p");
  });

  await run_case("a player that is not ready refuses, and the same command works once it answers", async () => {
    await open_page("quality", "p23_quality_slow", { new_tab: true });
    await run_line("quality max");
    await wait_toast("The player has no quality levels yet");
    await in_active_tab('document.documentElement.dataset.ready = "1"; 0');
    await poll_until("the player to be ready", async () => {
      await run_line("quality");
      return (await read_toast()).startsWith("Quality: ");
    });
    const mark = events.length;
    await run_line("quality min");
    await wait_event(mark, on_quality("p23_quality_slow", (event) => event.low === "large"), "the player at its lowest level");
  });

  await run_case("an hls.js player takes the next level only, auto is -1, and skip refuses", async () => {
    await open_page("quality", "p23_quality_hls", { new_tab: true });
    let mark = events.length;
    await run_line("quality max");
    await wait_event(mark, on_quality("p23_quality_hls", (event) => event.next === 2), "the next level set to 2");
    await wait_toast("Quality 720p");
    mark = events.length;
    await run_line("quality auto");
    await wait_event(mark, on_quality("p23_quality_hls", (event) => event.next === -1), "the next level back to auto");
    expect(!events.some(on_quality("p23_quality_hls", (event) => event.current !== undefined)), "a write to the current level flushes the buffer");
    await run_line("skip");
    await wait_toast("No next video");
  });

  await run_case("a page with no site player refuses quality and skip in words", async () => {
    await open_page("quality", "p23_quality_none", { new_tab: true });
    await run_line("quality max");
    await wait_toast("No quality control on this page");
    await run_line("skip previous");
    await wait_toast("No previous video");
  });

  await run_case("a page with no media refuses with a notice", async () => {
    await open_page("page", "p23_none", { new_tab: true });
    await press_keys("a", "s");
    await wait_toast("No video or audio on this page");
  });
}
