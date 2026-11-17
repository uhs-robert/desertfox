// The lists that rank the history (`open`, `history`, the finder) over a seeded history. The rows come ranked from the background's rank Worker, keys typed in one burst
// land on the newest word's rows, and the keys that act on the list wait for them. A probe in the line's frame records how long a key takes to draw while ranks run.
import { evaluate_in_background, evaluate_in_page_frames } from "./rdp.mjs";

export const areas = ["cmdline"];

const SEEDED = 2000;
// Old enough that no other piece's visits fall in the range the teardown deletes.
const SEED_START = Date.UTC(2001, 0, 1);
const TARGET_TITLE = "Xylophone target page";
const SEED_CHUNK = 250;
// Below the harness's 30 s cap on a setup, so a slow intake fails with this piece's own message.
const SEED_INTAKE_LIMIT_MS = 27_000;

// Runs in the line's frame and holds no outer variable. Each keydown gets its time to the next frame (the typed key drawn) and the list's redraws are timed, with the line's text and whether the note still read "loading".
// The text ties a draw to its query: the page ranks the text the line shows, so a draw of that text that is not loading shows its rows.
const install_probe = (frame_window) => {
  const document = frame_window.document;
  const keys = [];
  const draws = [];
  const publish = () => document.documentElement.setAttribute("data-latency-probe", JSON.stringify({ keys, draws }));
  frame_window.addEventListener(
    "keydown",
    (event) => {
      const entry = { key: event.key, at: event.timeStamp, frame_ms: null };
      keys.push(entry);
      frame_window.requestAnimationFrame(() => {
        entry.frame_ms = frame_window.performance.now() - entry.at;
        publish();
      });
    },
    true,
  );
  new frame_window.MutationObserver(() => {
    draws.push({ at: frame_window.performance.now(), text: document.getElementById("line").value, loading: document.getElementById("note").textContent === "loading", rows: document.querySelectorAll(".desertfox-cmdline-item").length });
    publish();
  }).observe(document.getElementById("list"), { childList: true, subtree: true });
  publish();
  return true;
};
const read_probe = (frame_window) => JSON.parse(frame_window.document.documentElement.getAttribute("data-latency-probe") ?? "null");

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export async function run_cases({ rdp, extension_id, run_case, setup, on_teardown, expect, press_keys, settle_focus, wait_cmdline, close_cmdline, open_cmdline, url_of, events, wait_event }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);
  const target = url_of("page", "p42_target");
  const shows_target_only = (line) => line.rows === 1 && line.row_texts[0].includes(TARGET_TITLE) && line.note !== "loading";

  await setup("seed the history", async () => {
    on_teardown(() => background(`browser.history.deleteRange({ startTime: ${SEED_START}, endTime: ${SEED_START + (SEEDED + 2) * 1000} })`));
    // In chunks, each its own call: one call for all of them can outlast the harness's 5 s limit on a background call when the machine is busy.
    for (let first = 0; first < SEEDED; first += SEED_CHUNK)
      await background(`(async () => {
        const visits = [];
        for (let index = ${first}; index < ${Math.min(SEEDED, first + SEED_CHUNK)}; index++) visits.push(browser.history.addUrl({ url: "https://seed" + index + ".example.test/zebra/" + (index % 37) + "/page", title: "zebra seed page " + index + " about quartz", visitTime: ${SEED_START} + index * 1000 }));
        await Promise.all(visits);
      })()`);
    await background(`browser.history.addUrl({ url: ${JSON.stringify(target)}, title: ${JSON.stringify(TARGET_TITLE)}, visitTime: ${SEED_START + SEEDED * 1000} })`);
  });

  // A setup of its own, so the wait gets the whole 30 s cap of a setup.
  await setup("the rank Worker lists the seeded history", async () => {
    // The Worker takes a new address after a one-row search lists it, one at a time, so the target lands last. Each line ranks a snapshot of its own, so each try opens a new line.
    // The intake slows with the machine's load: 7 s alone, 15 s or more beside the other shards.
    const started = Date.now();
    for (;;) {
      await open_cmdline();
      await press_keys("history xylophone");
      const found = await wait_cmdline(shows_target_only, "the seeded target in the history list", 2000).then(() => true, () => false);
      await close_cmdline();
      if (found) break;
      expect(Date.now() - started < SEED_INTAKE_LIMIT_MS, "the rank Worker never listed the seeded history");
    }
    console.log(`p42: the Worker took ${SEEDED + 1} new addresses in ${Date.now() - started} ms`);
  });

  await run_case("open typed in one burst shows the newest word's rows: the target only", async () => {
    await open_cmdline();
    await press_keys("open xylophone");
    await wait_cmdline((line) => line.value === "open xylophone" && shows_target_only(line), "the target as the only open row");
    await close_cmdline();
  });

  await run_case("Tab typed at once after the word waits for its rows and puts the target in the line", async () => {
    await open_cmdline();
    await press_keys("open xylophone", "-k", "Tab");
    await wait_cmdline((line) => line.value === `open ${target} `, "the target's address in the line");
    await close_cmdline();
  });

  await run_case("keydown to draw while ranks of 2000 rows run: the typed key draws at once and the rows of the last word follow", async () => {
    await open_cmdline();
    await press_keys("open ");
    await wait_cmdline((line) => line.value === "open " && line.note !== "loading", "the open list for an empty word");
    const [installed] = await evaluate_in_page_frames(rdp, "cmdline.html", install_probe.toString());
    expect(installed === true, "the latency probe did not install in the line's frame");
    // An unselective word: every key ranks all the seeded rows, and most of them hit.
    const burst = "zebra seed quartz";
    await press_keys(burst);
    await wait_cmdline((line) => line.value === `open ${burst}` && line.note !== "loading" && line.rows > 0, "the rows of the whole word");
    const [probe] = await evaluate_in_page_frames(rdp, "cmdline.html", read_probe.toString());
    const frames = probe.keys.map((key) => key.frame_ms).filter((ms) => ms !== null);
    const last_key = probe.keys.at(-1).at;
    const landed = probe.draws.find((draw) => draw.at > last_key && draw.text === `open ${burst}` && !draw.loading && draw.rows > 0);
    expect(frames.length === burst.length && landed, `the probe missed keys or the final draw: ${JSON.stringify(probe)}`);
    const rows_ms = landed.at - last_key;
    console.log(`p42 latency: ${frames.length} keys, keydown to next frame median ${median(frames).toFixed(1)} ms, max ${Math.max(...frames).toFixed(1)} ms; last keydown to its rows drawn ${rows_ms.toFixed(1)} ms; ${probe.draws.length} list draws`);
    // The bounds scale with the typical key of this very run, so a slow machine lifts them and a stalled thread or a lost answer still breaks them. The floors keep a fast run from a tiny bound.
    const typical_ms = median(frames);
    const frame_bound_ms = Math.max(250, typical_ms * 8);
    const rows_bound_ms = Math.max(1000, typical_ms * 40);
    expect(Math.max(...frames) < frame_bound_ms, `a key took ${Math.max(...frames)} ms to draw, bound ${frame_bound_ms} ms`);
    expect(rows_ms < rows_bound_ms, `the last word's rows took ${rows_ms} ms, bound ${rows_bound_ms} ms`);
    await close_cmdline();
  });

  // Last: Enter opens the target, which adds a visit of its own.
  await run_case("the finder: the word and Enter typed at once open the row that landed", async () => {
    await settle_focus();
    await press_keys(",", ",");
    await wait_cmdline((line) => line.ready && line.focused, "the finder to open");
    const mark = events.length;
    await press_keys("xylophone", "-k", "Return");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p42_target", "the target page after Enter in the finder");
  });
}
