// The a group and A: the media keys reach a video in another frame, inside a closed shadow root, with the key pressed in the top frame. The page /media_frames also holds a sandboxed frame and an about:blank frame, where the background's script injection may be refused.
// Each case reads what the page's video reports, so a second listener from a second injection shows as a double step.

export const areas = ["media", "keys"];

export async function run_cases({ run_case, setup, open_page, press_keys, wait_event, expect_absent, wait_cmdline, type_in_line, events, expect, in_active_tab, poll_until, settle_focus }) {
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
    await wait_event(mark, report(top, "volumechange", (event) => event.volume === 0.9), "the top video at 90%");
    await wait_toast("Volume 90%");
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
    await poll_until("the info line", async () => /^0:\d\d of 0:30, 2x, volume 90%, paused$/.test(await read_toast()));
  });

  await run_case("media seek end and percent move the video, percent reading the count", async () => {
    let mark = events.length;
    await run_line("seek percent");
    await wait_event(mark, report(top, "seeked", (event) => event.time > 0.2 && event.time < 0.4), "the top video at 1 percent");
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
  await run_case("af fullscreens the player box with its overlay, and a second af leaves", async () => {
    await open_page("media", "p23_full", { new_tab: true });
    const on_page = (type) => (event) => event.page_id === "p23_full" && event.type === type;
    let mark = events.length;
    await press_keys("a", "f");
    const entered = await wait_event(mark, on_page("media_fullscreen"), "fullscreen to start");
    expect(entered.element === "player", `the fullscreen element is "${entered.element}"`);
    mark = events.length;
    await press_keys("a", "f");
    const left = await wait_event(mark, on_page("media_fullscreen"), "fullscreen to end");
    expect(left.element === "", `the fullscreen element is "${left.element}"`);
  });

  await run_case("a page with no media refuses with a notice", async () => {
    await open_page("page", "p23_none", { new_tab: true });
    await press_keys("a", "s");
    await wait_toast("No video or audio on this page");
  });
}
