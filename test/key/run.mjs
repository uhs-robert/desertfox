// The key test: real key presses in a nested session, results read from pages that report to a local server.
// Needs SHADOW_SH, a script with `up|spawn|keys|down <name>` subcommands for a nested, invisible compositor.
import { execFile, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { connect_rdp, evaluate_in_background, install_temporary_addon } from "./rdp.mjs";
import { start_server } from "./server.mjs";

const run_execfile = promisify(execFile);
const key_test_dir = dirname(fileURLToPath(import.meta.url));
const repo_dir = resolve(key_test_dir, "../..");
const dist_dir = join(repo_dir, "dist");
const EXTENSION_ID = "oasisfox@uhs-robert";
const SHADOW_NAME = "oasiskey";
const FRESH_LOAD_COUNT = 24;

const shadow_sh = process.env.SHADOW_SH;
if (!shadow_sh) {
  console.error("key-test: set SHADOW_SH to a script that runs `<script> {up|spawn|keys|down} <name> ...` in a nested session.");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve_sleep) => setTimeout(resolve_sleep, ms));
const shadow = (...args) => run_execfile(shadow_sh, args, { maxBuffer: 1 << 24 });
// The pause lets a switched-to tab take keyboard focus before the next press.
const KEY_SETTLE_MS = 350;
async function send_keys(...wtype_args) {
  await shadow("keys", SHADOW_NAME, ...wtype_args);
  await sleep(KEY_SETTLE_MS);
}

const ALT = (key) => ["-M", "alt", key, "-m", "alt"];
const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];
const SHIFT_ESCAPE = ["-M", "shift", "-k", "Escape", "-m", "shift"];

async function free_port() {
  const probe = net.createServer();
  await new Promise((resolve_listen) => probe.listen(0, "127.0.0.1", resolve_listen));
  const { port } = probe.address();
  await new Promise((resolve_close) => probe.close(resolve_close));
  return port;
}

function build_test_config(config_dir, out_file) {
  const result = spawnSync("node", ["tools/build-config/cli.ts", config_dir, "--out", out_file], { cwd: repo_dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`build-config failed: ${result.stderr}${result.stdout}`);
}

const results = [];
const measurements = {};

async function run_case(name, body) {
  try {
    await body();
    results.push({ name, pass: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, pass: false, reason: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const work_dir = mkdtempSync(join(tmpdir(), "oasisfox-key-"));
  const profile_dir = join(work_dir, "profile");
  const managed_dir = join(work_dir, "managed");
  const config_dir = join(work_dir, "config");
  cpSync(join(key_test_dir, "config"), config_dir, { recursive: true });
  mkdirSync(profile_dir);
  cpSync(join(key_test_dir, "user.js"), join(profile_dir, "user.js"), { recursive: true });
  const managed_file = join(managed_dir, `${EXTENSION_ID}.json`);
  build_test_config(config_dir, managed_file);

  const server = await start_server();
  const events = server.events;
  const debug_port = await free_port();
  let rdp;

  const url_of = (kind, id) => `http://127.0.0.1:${server.port}/${kind}?id=${id}`;
  const since = (mark) => events.slice(mark);
  const find_event = (mark, predicate) => since(mark).find(predicate);
  async function wait_event(mark, predicate, what, timeout_ms = 8000) {
    const deadline = Date.now() + timeout_ms;
    for (;;) {
      const found = find_event(mark, predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await sleep(50);
    }
  }
  const became_visible = (page_id) => (event) => event.type === "visibility" && event.state === "visible" && event.page_id === page_id;
  const visible_events = (mark) => since(mark).filter((event) => event.type === "visibility" && event.state === "visible");
  const scroll_of = (page_id) => (event) => event.type === "scroll" && event.page_id === page_id;
  const last_scroll_y = (page_id) => events.filter(scroll_of(page_id)).at(-1)?.y ?? 0;

  async function open_page(kind, id, { new_tab }) {
    const mark = events.length;
    if (new_tab) {
      await send_keys(...CTRL("t"));
      await sleep(500);
    }
    // A lost keystroke in the address bar leaves the page unloaded, so one retry keeps the test steady.
    for (let attempt = 0; ; attempt++) {
      await send_keys(...CTRL("l"), "-d", "5", url_of(kind, id), "-k", "Return");
      try {
        await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === id, `content script ready on ${id}`, 6000);
        break;
      } catch (error) {
        if (attempt >= 1) throw error;
        measurements.navigation_retries = (measurements.navigation_retries ?? 0) + 1;
      }
    }
    await sleep(150);
  }

  async function scroll_delta_after(page_id, keys) {
    const before = last_scroll_y(page_id);
    const mark = events.length;
    await send_keys(...keys);
    const reported = await wait_event(mark, scroll_of(page_id), `scroll on ${page_id} after ${keys.join(" ")}`);
    return reported.y - before;
  }

  async function expect_no_scroll(mark, page_id) {
    await sleep(700);
    expect(!find_event(mark, scroll_of(page_id)), `page ${page_id} scrolled`);
  }

  async function expect_exactly_one_visible(mark, expected_page_id) {
    await sleep(1500);
    const visible = visible_events(mark);
    expect(visible.length === 1 && visible[0].page_id === expected_page_id,
      `expected one switch to ${expected_page_id}, saw [${visible.map((event) => event.page_id).join(", ")}]`);
  }

  try {
    await shadow("up", SHADOW_NAME);
    await shadow("spawn", SHADOW_NAME, join(key_test_dir, "launch_firefox.sh"), work_dir, profile_dir, String(debug_port), managed_file);
    for (let attempt = 0; ; attempt++) {
      try {
        rdp = await connect_rdp(debug_port);
        break;
      } catch (error) {
        if (attempt > 60) throw new Error(`Firefox debugger never answered: ${error.message}`);
        await sleep(500);
      }
    }
    await install_temporary_addon(rdp, dist_dir);
    await sleep(1500);

    await open_page("page", "a", { new_tab: false });
    await open_page("page", "b", { new_tab: true });
    await open_page("page", "c", { new_tab: true });

    let single_j_pixels = 0;

    await run_case("J and K switch tabs", async () => {
      for (const [keys, expected] of [["K", "b"], ["K", "a"], ["J", "b"], ["J", "c"]]) {
        const mark = events.length;
        await send_keys(keys);
        await wait_event(mark, became_visible(expected), `tab ${expected} after ${keys}`);
      }
    });

    await run_case("j scrolls, 3j scrolls three times as far", async () => {
      single_j_pixels = await scroll_delta_after("c", ["j"]);
      expect(single_j_pixels > 0, "j did not scroll down");
      const triple = await scroll_delta_after("c", ["3j"]);
      expect(Math.abs(triple - 3 * single_j_pixels) <= 3, `3j moved ${triple}px, j moved ${single_j_pixels}px`);
    });

    await run_case("G jumps to the bottom and gg to the top", async () => {
      await scroll_delta_after("c", ["G"]);
      const bottom = events.filter(scroll_of("c")).at(-1);
      expect(bottom.y >= bottom.max_y - 2, `G stopped at ${bottom.y} of ${bottom.max_y}`);
      await scroll_delta_after("c", ["gg"]);
      expect(last_scroll_y("c") === 0, `gg stopped at ${last_scroll_y("c")}`);
    });

    await run_case("ignore mode passes keys to the page and leaves again", async () => {
      await send_keys(...SHIFT_ESCAPE);
      await sleep(300);
      let mark = events.length;
      await send_keys("j");
      await wait_event(mark, (event) => event.type === "keydown" && event.key === "j", "the page to see j in ignore mode");
      await expect_no_scroll(mark, "c");
      await send_keys(...SHIFT_ESCAPE);
      await sleep(300);
      mark = events.length;
      await send_keys("j");
      await wait_event(mark, scroll_of("c"), "scroll after leaving ignore mode");
      expect(!find_event(mark, (event) => event.type === "keydown" && event.key === "j"), "the page saw j in normal mode");
    });

    await run_case("the mode badge shows NORMAL, then IGNORE, then NORMAL", async () => {
      const is_label = (label) => (event) => event.type === "indicator" && event.page_id === "c" && event.label === label;
      expect(events.some(is_label("NORMAL")), "no NORMAL badge at start");
      let mark = events.length;
      await send_keys(...SHIFT_ESCAPE);
      await wait_event(mark, is_label("IGNORE"), "the IGNORE badge");
      mark = events.length;
      await send_keys(...SHIFT_ESCAPE);
      await wait_event(mark, is_label("NORMAL"), "the NORMAL badge after leaving ignore");
    });

    await open_page("field", "f", { new_tab: true });
    await run_case("typing in a field is not swallowed", async () => {
      const typed = "jkxGddqrgg 3j";
      const mark = events.length;
      await send_keys(typed);
      await sleep(800);
      const inputs = since(mark).filter((event) => event.type === "input");
      expect(inputs.at(-1)?.value === typed, `field holds "${inputs.at(-1)?.value}", typed "${typed}"`);
      expect(!find_event(mark, (event) => event.type === "visibility"), "a tab switch happened while typing");
    });

    await run_case("Escape leaves the field and keys act again", async () => {
      await send_keys("-k", "Escape");
      await sleep(300);
      const mark = events.length;
      await send_keys("K");
      await wait_event(mark, became_visible("c"), "tab c after K");
      await send_keys("J");
      await wait_event(mark, became_visible("f"), "tab f after J");
    });

    await open_page("swallow", "s", { new_tab: true });
    await run_case("J and K work on a page that cancels keys in its own capture listener", async () => {
      let mark = events.length;
      await send_keys("K");
      await wait_event(mark, became_visible("f"), "tab f after K");
      await send_keys("J");
      await wait_event(mark, became_visible("s"), "tab s after J");
    });

    await run_case("chord on a cancelling page acts exactly once", async () => {
      let mark = events.length;
      await send_keys(...ALT("j"));
      await expect_exactly_one_visible(mark, "a");
      mark = events.length;
      await send_keys(...ALT("k"));
      await expect_exactly_one_visible(mark, "s");
    });

    await run_case("chord on a normal page acts exactly once", async () => {
      await send_keys("gg");
      await send_keys("K");
      await sleep(500);
      let mark = events.length;
      await send_keys(...ALT("k"));
      await expect_exactly_one_visible(mark, "c");
      mark = events.length;
      await send_keys(...ALT("j"));
      await expect_exactly_one_visible(mark, "f");
    });

    await send_keys(...CTRL("t"));
    await send_keys(...CTRL("l"), "about:support", "-k", "Return");
    await sleep(1500);

    await run_case("Alt+J and Alt+K work on an about: page", async () => {
      let mark = events.length;
      await send_keys(...ALT("k"));
      await expect_exactly_one_visible(mark, "s");
      await send_keys(...ALT("j"));
      await sleep(500);
      mark = events.length;
      await send_keys(...ALT("j"));
      await expect_exactly_one_visible(mark, "a");
    });

    await run_case("focus_page from the address bar returns keys to the page", async () => {
      const before = last_scroll_y("a");
      const mark = events.length;
      await send_keys(...CTRL("l"));
      await sleep(300);
      await send_keys(...ALT(","));
      await sleep(700);
      await send_keys("j");
      measurements.focus_page_works = Boolean(await wait_event(mark, scroll_of("a"), "j to scroll page a after focus_page", 3000).catch(() => undefined));
      if (!measurements.focus_page_works) {
        await send_keys("-k", "Escape", "-k", "Escape");
        throw new Error(`j after the chord did not reach the page (scroll stayed at ${before})`);
      }
    });

    await run_case("config.reload keeps keys working in open tabs", async () => {
      writeFileSync(join(config_dir, "keymap.jsonc"), JSON.stringify({
        normal: { m: { id: "scroll.to", args: { percent: 50 } } },
        browser: { "<A-,>": { id: "browser.focus_page" } },
      }));
      build_test_config(config_dir, managed_file);
      const session_home = readFileSync(join(work_dir, "session_home"), "utf8").trim();
      cpSync(managed_file, join(session_home, ".mozilla", "managed-storage", `${EXTENSION_ID}.json`));

      await send_keys("gg");
      await sleep(500);
      await evaluate_in_background(rdp, EXTENSION_ID, `browser.storage.local.remove("oasisfox_reinject_report")`);
      await send_keys("qr");
      let report;
      for (let attempt = 0; attempt < 60 && !report; attempt++) {
        await sleep(500);
        report = await evaluate_in_background(rdp, EXTENSION_ID, `(await browser.storage.local.get("oasisfox_reinject_report")).oasisfox_reinject_report`).catch(() => undefined);
      }
      expect(report, "no oasisfox_reinject_report after 30 s");
      measurements.reinject_report = report;
      console.log(`reinject report ${JSON.stringify(report)}`);
      await sleep(1000);

      const one_j = await scroll_delta_after("a", ["j"]);
      expect(one_j === single_j_pixels, `after reload j moved ${one_j}px, before it moved ${single_j_pixels}px (double or missing action)`);
      const mark = events.length;
      await send_keys("m");
      const halfway = await wait_event(mark, scroll_of("a"), "scroll to 50 percent");
      expect(Math.abs(halfway.y - halfway.max_y / 2) <= 2, `m stopped at ${halfway.y} of ${halfway.max_y}`);
      const switch_mark = events.length;
      await send_keys("J");
      await expect_exactly_one_visible(switch_mark, "b");
      const other_tab_delta = await scroll_delta_after("b", ["j"]);
      expect(other_tab_delta === single_j_pixels, `in an untouched tab j moved ${other_tab_delta}px, expected ${single_j_pixels}px`);
    });

    await run_case("keys work on a fresh load after the reload", async () => {
      await open_page("page", "after_reload", { new_tab: true });
      expect((await scroll_delta_after("after_reload", ["j"])) === single_j_pixels, "j moved a different distance");
    });

    // part B: toolbar badge
    // The sampler reports each change of the active tab's badge text to the test server.
    // A no-cors text/plain POST needs no host permission.
    await evaluate_in_background(rdp, EXTENSION_ID, `(() => {
      let last;
      setInterval(async () => {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        const text = tab && (await browser.browserAction.getBadgeText({ tabId: tab.id }));
        if (text === last) return;
        last = text;
        fetch("http://127.0.0.1:${server.port}/report", { method: "POST", mode: "no-cors", body: JSON.stringify({ type: "toolbar_badge", text }) });
      }, 50);
      return "sampling";
    })()`);
    const badge_is = (text) => (event) => event.type === "toolbar_badge" && event.text === text;
    await open_page("field", "badge_field", { new_tab: true });
    await run_case("the toolbar badge follows insert, normal and ignore mode", async () => {
      // The field page focuses its input on load, so the tab starts in insert mode.
      await wait_event(0, badge_is("INS"), "INS on a focused field");
      let mark = events.length;
      await send_keys("-k", "Escape");
      await wait_event(mark, badge_is("NOR"), "NOR after Escape");
      mark = events.length;
      await send_keys(...SHIFT_ESCAPE);
      await wait_event(mark, badge_is("IGN"), "IGN after Shift+Escape");
      mark = events.length;
      await send_keys(...SHIFT_ESCAPE);
      await wait_event(mark, badge_is("NOR"), "NOR after leaving ignore");
      mark = events.length;
      await send_keys("gi");
      await wait_event(mark, badge_is("INS"), "INS after gi");
      // Leave the field so the next part's keys reach the key handler, not the input.
      await send_keys("-k", "Escape");
    });

    // part C: help and options pages
    // The pages are extension pages, so the test reads them through the background's view list.
    const extension_view = (name) => `(browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/${name}"))`;

    await run_case("the help page takes j, gg and ignore mode", async () => {
      await send_keys("qh");
      let state;
      for (let attempt = 0; attempt < 40 && !state?.ready; attempt++) {
        await sleep(250);
        state = await evaluate_in_background(rdp, EXTENSION_ID, `(() => { const view = ${extension_view("help.html")}; return { ready: !!view && !!view.document.querySelector("h1") }; })()`).catch(() => undefined);
      }
      expect(state?.ready, "the help page never rendered");
      await sleep(800);
      const probe = () => evaluate_in_background(rdp, EXTENSION_ID, `(() => { const view = ${extension_view("help.html")}; return { y: view.scrollY, badge: view.document.querySelector("[data-oasisfox-mode]")?.getAttribute("data-oasisfox-mode") ?? null }; })()`);
      await send_keys("j", "j", "j");
      await sleep(600);
      const scrolled = await probe();
      expect(scrolled.y > 0, `j did not scroll the help page (y=${scrolled.y})`);
      await send_keys("gg");
      await sleep(600);
      expect((await probe()).y === 0, "gg did not return to the top");
      await send_keys(...SHIFT_ESCAPE);
      await sleep(600);
      const ignored = await probe();
      expect(ignored.badge === "IGNORE", `badge after <S-Escape> was ${ignored.badge}`);
      await send_keys(...SHIFT_ESCAPE);
      await sleep(300);
    });

    await run_case("the options page opens and shows the config source", async () => {
      const status = { source: "managed", settings: {}, managed_file_hint: "" };
      const text = await evaluate_in_background(rdp, EXTENSION_ID, `(async () => {
        await browser.storage.local.set({ oasisfox_config_status: ${JSON.stringify(status)} });
        await browser.runtime.openOptionsPage();
        for (let attempt = 0; attempt < 40; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const view = ${extension_view("options.html")};
          const heading = view?.document.querySelector("h2");
          if (heading) return view.document.body.textContent;
        }
        return "";
      })()`);
      expect(text.includes("Config source") && text.includes("Managed storage file"), `options page text: ${String(text).slice(0, 120)}`);
    });

    // part A: scroll align
    await run_case("scroll.align puts the field just left at the top, center and bottom", async () => {
      await open_page("aligned", "align", { new_tab: true });
      const field_top_after = async (keys) => {
        const mark = events.length;
        await send_keys(...keys);
        const reported = await wait_event(mark, scroll_of("align"), `scroll after ${keys.join(" ")}`);
        await sleep(300);
        return events.filter(scroll_of("align")).at(-1).field_top ?? reported.field_top;
      };
      await field_top_after(["gi"]);
      await send_keys("-k", "Escape");
      await sleep(300);
      const top = await field_top_after(["zt"]);
      expect(Math.abs(top) <= 2, `zt left the field at ${top}`);
      const center = await field_top_after(["zz"]);
      expect(center > 100, `zz left the field at ${center}`);
      const bottom = await field_top_after(["zb"]);
      expect(bottom > center, `zb left the field at ${bottom}, zz at ${center}`);
      measurements.align_field_tops = { top, center, bottom };
    });

    await run_case("scroll.align with nothing focused leaves the scroll position alone", async () => {
      await open_page("page", "align_plain", { new_tab: true });
      const mark = events.length;
      await send_keys("zt");
      await expect_no_scroll(mark, "align_plain");
    });

    await run_case("z= resets the zoom to 100 percent", async () => {
      const active_zoom = `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.getZoom(tab.id); })()`;
      await send_keys("zI");
      await sleep(500);
      expect(await evaluate_in_background(rdp, EXTENSION_ID, active_zoom) === 3, "zI did not zoom to 300 percent");
      await send_keys("z=");
      await sleep(500);
      expect(await evaluate_in_background(rdp, EXTENSION_ID, active_zoom) === 1, "z= did not reset the zoom");
    });

    // The default t, x and r groups. Plain t, x and r are prefixes only.
    await open_page("page", "d_reload", { new_tab: true });
    await run_case("rr reloads the page", async () => {
      const mark = events.length;
      await send_keys("rr");
      await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "d_reload", "d_reload to load again after rr");
    });

    await run_case("tt refuses its prompt without opening a tab", async () => {
      const mark = events.length;
      await send_keys("tt");
      await sleep(1000);
      expect(visible_events(mark).length === 0, "tt switched tabs");
      expect(!find_event(mark, (event) => event.type === "tree_read"), "tt loaded a page");
    });

    await run_case("x alone does nothing", async () => {
      const mark = events.length;
      await send_keys("x");
      await sleep(1000);
      expect(visible_events(mark).length === 0, "x closed or switched a tab");
      await send_keys("-k", "Escape");
      expect(await scroll_delta_after("d_reload", ["j"]) > 0, "the page stopped taking keys after x");
    });

    await run_case("xx closes the tab", async () => {
      await open_page("page", "d_close", { new_tab: true });
      const mark = events.length;
      await send_keys("xx");
      const shown = await wait_event(mark, (event) => event.type === "visibility" && event.state === "visible" && event.page_id !== "d_close", "another tab after xx");
      expect(shown.page_id !== "d_close", "d_close is still the visible tab");
      expect(await scroll_delta_after(shown.page_id, ["j"]) > 0, "the tab left after xx does not take keys");
    });

    const tree_read_ms = [];
    for (let index = 0; index < FRESH_LOAD_COUNT; index++) {
      const id = `fresh_${String(index).padStart(2, "0")}`;
      const mark = events.length;
      await open_page("page", id, { new_tab: false });
      tree_read_ms.push(find_event(mark, (event) => event.type === "tree_read" && event.page_id === id).ms);
    }
    measurements.tree_read_ms = tree_read_ms;
    const sorted = [...tree_read_ms].sort((left, right) => left - right);
    measurements.tree_read_summary = { loads: sorted.length, min: sorted[0], median: (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2, max: sorted.at(-1) };
  } finally {
    rdp?.close();
    await shadow("down", SHADOW_NAME).catch((error) => console.error(`shadow down failed: ${error.message}`));
    server.close();
    rmSync(work_dir, { recursive: true, force: true });
    console.log(JSON.stringify(measurements));
  }

  const failed = results.filter((result) => !result.pass);
  console.log(`${results.length - failed.length} of ${results.length} cases passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(`key-test aborted: ${error.stack}`);
  await shadow("down", SHADOW_NAME).catch(() => undefined);
  process.exit(1);
});
