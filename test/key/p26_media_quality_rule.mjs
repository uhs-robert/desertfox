// The media_quality rule: a fake site player (the /quality fixture) starts at 720p, and the rule takes it to its level on a fresh load and after an in-site navigation. The config sets the global max, because the shipped default auto leaves players alone. Site rows override it, off leaves the page alone, and a manual `media quality` choice stands.
// The rows live in a config copy, so no other piece sees them. The fixture reports each range call the extension makes as a quality_set event.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["media", "config"];

const ROWS = `
[[site_rules]]
site = "*://127.0.0.1/quality?id=p26_yt_min*"
media_quality = "min"

[[site_rules]]
site = "*://127.0.0.1/quality?id=p26_yt_height*"
media_quality = 480

[[site_rules]]
site = "*://127.0.0.1/quality?id=p26_frame_yt_inner*"
media_quality = "min"

[[site_rules]]
site = "*://127.0.0.1/quality?id=p26_yt_off*"
media_quality = "off"
`;

// Longer than the rule's give-up and hold times together would be needed for a full wait, so absence checks use the hold time of the rule (3 s) plus a margin.
const QUIET_MS = 3500;

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, in_active_tab, wait_event, expect_absent, events, poll_until, run_line, sleep, expect }) {
  await setup("load a config with media_quality rows for the p26_ pages", async () => {
    const dir = config_copy();
    // The global key goes first: after a table header it would belong to that table.
    const settings_path = join(dir, "settings.toml");
    writeFileSync(settings_path, `media_quality = "max"\n${readFileSync(settings_path, "utf8")}`);
    appendFileSync(settings_path, ROWS);
    await load_config_dir(dir);
  });

  const on_set = (page_id, check = () => true) => (event) => event.page_id === page_id && event.type === "quality_set" && check(event);
  const read_toast = () =>
    in_active_tab(`(() => {
      const host = [...document.documentElement.children].find((child) => child.style.zIndex === "2147483645");
      return host ? host.openOrClosedShadowRoot.querySelector(".desertfox-toast")?.textContent ?? "" : "";
    })()`);
  const navigate = () => in_active_tab('document.getElementById("navigate").click(); 0');

  await run_case("the global max takes a fresh load to the top level, and an in-site navigation to the top again", async () => {
    let mark = events.length;
    await open_page("quality", "p26_yt", { new_tab: true });
    await wait_event(mark, on_set("p26_yt", (event) => event.low === "hd1080" && event.high === "hd1080"), "the fresh load at 1080p");
    // The player reaches its level and the rule goes quiet. The navigation starts the next video at 720p 800 ms later.
    await sleep(500);
    mark = events.length;
    await navigate();
    await wait_event(mark, on_set("p26_yt", (event) => event.low === "hd1080"), "the navigation to 1080p");
    const level = await in_active_tab("document.documentElement.dataset.level");
    expect(level === "hd1080", `the new video plays at ${level}`);
  });

  await run_case("a site value overrides the global value: min and a height", async () => {
    let mark = events.length;
    await open_page("quality", "p26_yt_min", { new_tab: true });
    await wait_event(mark, on_set("p26_yt_min", (event) => event.low === "large"), "the min row at 480p");
    mark = events.length;
    await open_page("quality", "p26_yt_height", { new_tab: true });
    await wait_event(mark, on_set("p26_yt_height", (event) => event.low === "large"), "the 480 row at 480p");
  });

  await run_case("off leaves the site alone, on load and on navigation", async () => {
    const mark = events.length;
    await open_page("quality", "p26_yt_off", { new_tab: true });
    await navigate();
    await sleep(QUIET_MS);
    expect(!events.slice(mark).some(on_set("p26_yt_off")), `the rule set a level: ${JSON.stringify(events.slice(mark).filter(on_set("p26_yt_off")))}`);
  });

  await run_case("a manual media quality choice stands over the running rule, and the next navigation applies the rule again", async () => {
    let mark = events.length;
    await open_page("quality", "p26_yt_manual", { new_tab: true });
    await wait_event(mark, on_set("p26_yt_manual", (event) => event.low === "hd1080"), "the rule at 1080p");
    // Inside the rule's watch time, so the choice races a poll that is still running.
    await run_line("media quality 480p");
    await wait_event(mark, on_set("p26_yt_manual", (event) => event.low === "large"), "the manual 480p");
    mark = events.length;
    await sleep(QUIET_MS);
    expect(!events.slice(mark).some(on_set("p26_yt_manual")), `the rule fought the manual choice: ${JSON.stringify(events.slice(mark).filter(on_set("p26_yt_manual")))}`);
    mark = events.length;
    await navigate();
    await wait_event(mark, on_set("p26_yt_manual", (event) => event.low === "hd1080"), "the rule again after the navigation");
  });

  await run_case("a player that answers unknown until it plays gets the level once it plays, and a refused manual choice does not end the rule", async () => {
    const mark = events.length;
    await open_page("quality", "p26_slow", { new_tab: true });
    // The player stays silent until the test sets its ready flag. A manual choice now is refused.
    await run_line("media quality min");
    await poll_until("the refusal", async () => (await read_toast()) === "The player has no quality levels yet");
    // The rule stops looking for the player 10 s after page load (RULE_GIVE_UP_MS, src/content/quality/rule.ts), so the flag must be set inside that window.
    await in_active_tab('document.documentElement.dataset.ready = "1"; 0');
    await wait_event(mark, on_set("p26_slow", (event) => event.low === "hd1080"), "the rule at 1080p once the player plays", 8000);
    expect(!events.slice(mark).some(on_set("p26_slow", (event) => event.low === "large")), "the refused choice set a level");
  });

  await run_case("a player in a frame gets the rule of the frame's own address, not the top page's", async () => {
    const mark = events.length;
    await open_page("quality_frame", "p26_frame", { new_tab: true });
    await wait_event(mark, on_set("p26_frame_yt_inner", (event) => event.low === "large"), "the framed player at the min row's 480p");
    expect(!events.slice(mark).some(on_set("p26_frame_yt_inner", (event) => event.low === "hd1080")), "the framed player got the global max");
  });

  await run_case("a video and player that appear 4 s after the load still reach the level, on a plain page and in a frame", async () => {
    let mark = events.length;
    await open_page("quality", "p26_lazy_yt", { new_tab: true });
    await wait_event(mark, on_set("p26_lazy_yt", (event) => event.low === "hd1080"), "the late player at 1080p", 9000);
    mark = events.length;
    await open_page("quality_frame", "p26_lazyframe", { new_tab: true });
    await wait_event(mark, on_set("p26_lazyframe_yt_inner", (event) => event.low === "hd1080"), "the late framed player at 1080p", 9000);
  });

  await run_case("a video inside an open shadow root, found by the look-again check, gets the rule", async () => {
    const mark = events.length;
    await open_page("quality", "p26_lazyshadow", { new_tab: true });
    await wait_event(mark, on_set("p26_lazyshadow", (event) => event.low === "hd1080"), "the player beside the shadow-root video at 1080p", 17000);
  });

  await run_case("a navigation's watch outlasts the second injection: a reset 6 s after the navigation is still caught", async () => {
    let mark = events.length;
    await open_page("quality", "p26_late", { new_tab: true });
    await wait_event(mark, on_set("p26_late", (event) => event.low === "hd1080"), "the fresh load at 1080p");
    mark = events.length;
    await navigate();
    await wait_event(mark, on_set("p26_late", (event) => event.low === "hd1080"), "the level again after the late reset", 9000);
  });

  await run_case("a player in an about:blank frame gets the rule", async () => {
    const mark = events.length;
    await open_page("quality", "p26_blank", { new_tab: true });
    await wait_event(mark, on_set("p26_blank", (event) => event.low === "hd1080"), "the player of the about:blank frame at 1080p", 8000);
  });

  await run_case("an hls.js player is taken to its top level", async () => {
    const mark = events.length;
    await open_page("quality", "p26_hls", { new_tab: true });
    await wait_event(mark, on_set("p26_hls", (event) => event.next === 2), "the next level at the top");
    await sleep(1000);
    const writes = events.slice(mark).filter(on_set("p26_hls"));
    expect(writes.length === 1 && writes[0].next === 2, `the poll wrote ${JSON.stringify(writes)}, not one next level`);
  });
}
