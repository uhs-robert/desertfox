// The key test: real key presses in a nested session, results read from pages that report to a local server.
// harness.mjs holds the session and the helpers. This file holds the inline cases, the order of the run and the summary.
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CTRL, SHIFT_ESCAPE, create_session, shadow_down } from "./harness.mjs";
import { evaluate_in_background } from "./rdp.mjs";
import { create_timings } from "./timings.mjs";

const key_test_dir = dirname(fileURLToPath(import.meta.url));
// shadow.sh caps names at 8 characters. "ok" plus a base-36 pid is at most 8 and unique among live runs.
const SHADOW_NAME = `ok${process.pid.toString(36)}`;
if (SHADOW_NAME.length > 8) throw new Error(`shadow name ${SHADOW_NAME} is longer than 8 characters`);
const FRESH_LOAD_COUNT = 24;

async function main() {
  const timings = create_timings();
  const session = await create_session({ name: SHADOW_NAME, timings });
  const { results, measurements } = session;
  const { run_case, expect, open_page, send_keys, sleep, events, wait_event, since, find_event, rdp, extension_id, scroll_delta_after, scroll_of, injections_of, settled_injection_count, expect_no_scroll, visible_events, extension_view } = session.context_for("run.mjs");
  const EXTENSION_ID = extension_id;

  try {
    // P9: snippets, from test/key/config/snippets
    const snippet_events = (mark, type) => since(mark).filter((event) => event.type === type);
    await open_page("page", "snip", { new_tab: true });

    await run_case("a snippet runs on a matching page, in the top frame, with its default arg", async () => {
      const mark = events.length;
      await send_keys(",s");
      const ran = await wait_event(mark, (event) => event.type === "snippet_ran" && event.page_id === "snip", "the snippet report");
      expect(ran.word === "hi" && ran.top === true, `snippet reported word=${ran.word} top=${ran.top}`);
    });

    await run_case("a snippet limited to another site does not run here", async () => {
      const mark = events.length;
      await send_keys(",x");
      await sleep(1000);
      expect(snippet_events(mark, "snippet_wrong_site").length === 0, "the snippet ran on a site its matches do not name");
      expect(find_event(mark, (event) => event.type === "toast"), "no toast for the refusal");
    });

    await run_case("an error in a snippet shows a toast and keys keep working", async () => {
      await sleep(3500);
      const mark = events.length;
      await send_keys(",e");
      await wait_event(mark, (event) => event.type === "toast", "the error toast");
      expect(await scroll_delta_after("snip", ["j"]) > 0, "j did not scroll after the snippet error");
    });

    await run_case("a snippet that calls itself stops after 5 levels with a toast", async () => {
      await sleep(3500);
      const mark = events.length;
      await send_keys(",l");
      await wait_event(mark, (event) => event.type === "toast", "the depth limit toast");
      await sleep(500);
      const levels = snippet_events(mark, "snippet_level").length;
      expect(levels === 5, `the looping snippet ran ${levels} times`);
    });

    await run_case("a snippet key pressed inside an iframe runs in the top frame only", async () => {
      const focus_mark = events.length;
      await open_page("framed", "framed", { new_tab: true });
      await wait_event(focus_mark, (event) => event.type === "window_focus" && event.page_id === "inner", "the iframe to take focus");
      const mark = events.length;
      await send_keys(",s");
      await wait_event(mark, (event) => event.type === "snippet_ran" && event.page_id === "framed", "the snippet report from the top frame");
      await sleep(500);
      const in_frame = snippet_events(mark, "snippet_ran").filter((event) => event.page_id === "inner" || event.top !== true);
      expect(in_frame.length === 0, "the snippet ran inside the iframe");
    });

    // part C: help page
    await run_case("the help page takes j, gg and ignore mode", async () => {
      await send_keys("qh");
      let state;
      for (let attempt = 0; attempt < 40 && !state?.ready; attempt++) {
        await sleep(250);
        state = await evaluate_in_background(rdp, EXTENSION_ID, `(() => { const view = ${extension_view("home.html")}; return { ready: !!view && !!view.document.querySelector("h1") }; })()`).catch(() => undefined);
      }
      expect(state?.ready, "the help page never rendered");
      // Home is too short to scroll, so move to the long Commands page.
      await evaluate_in_background(rdp, EXTENSION_ID, `(() => { ${extension_view("home.html")}.location.hash = "#/commands"; })()`);
      await sleep(800);
      const probe = () => evaluate_in_background(rdp, EXTENSION_ID, `(() => { const view = ${extension_view("home.html")}; return { y: view.scrollY, badge: view.document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null }; })()`);
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
    }, { setup: true });

    // caret.js loads on the help page by script tag, so the caret keys work there. Escape must still leave the page in normal mode.
    await run_case("V on the help page enters caret mode and Escape returns to normal", async () => {
      const badge = () => evaluate_in_background(rdp, EXTENSION_ID, `${extension_view("home.html")}?.document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
      const loads_before = await settled_injection_count("caret.js");
      await send_keys("gV");
      await sleep(1500);
      const loads = (await injections_of("caret.js")).slice(loads_before);
      measurements.help_page_caret_load = loads.length === 0 ? "not requested" : loads.at(-1).ok ? "executeScript ok" : "executeScript refused";
      const entered = await badge();
      expect(entered === "CARET" || entered === "VISUAL", `the help page badge after V was ${entered}`);
      for (let step = 0; step < 2; step++) {
        await send_keys("-k", "Escape");
        await sleep(400);
      }
      expect(await badge() === "NORMAL", `the help page badge after Escape was ${await badge()}`);
    });

    // The new tab page loads every key script by tag, since executeScript cannot reach an extension page.
    await run_case("the new tab page takes : and f without asking executeScript", async () => {
      const hints_before = await settled_injection_count("hints.js");
      const cmdline_before = await settled_injection_count("cmdline.js");
      await evaluate_in_background(rdp, EXTENSION_ID, `browser.tabs.create({ url: browser.runtime.getURL("newtab.html") })`);
      let ready = false;
      for (let attempt = 0; attempt < 40 && !ready; attempt++) {
        await sleep(250);
        ready = await evaluate_in_background(rdp, EXTENSION_ID, `!!${extension_view("newtab.html")}?.document.querySelector(".desertfox-newtab")`).catch(() => false);
      }
      expect(ready, "the new tab page never rendered");
      await sleep(800);
      const mode = () => evaluate_in_background(rdp, EXTENSION_ID, `${extension_view("newtab.html")}?.desertfox_host?.get_mode() ?? null`);
      await send_keys(":");
      await sleep(800);
      expect(await mode() === "cmdline", `the mode after : was ${await mode()}`);
      // The first Escape closes the completion list, the second closes the line.
      await send_keys("-k", "Escape");
      await send_keys("-k", "Escape");
      await sleep(500);
      expect(await mode() === "normal", `the mode after Escape was ${await mode()}`);
      await evaluate_in_background(rdp, EXTENSION_ID, `(() => { const view = ${extension_view("newtab.html")}; const link = view.document.createElement("a"); link.href = "https://example.com/"; link.textContent = "link"; link.style.cssText = "position:fixed;top:20px;left:20px;color:white;"; view.document.body.append(link); })()`);
      await send_keys("f");
      await sleep(1500);
      expect(await mode() === "hint", `the mode after f was ${await mode()}`);
      await send_keys("-k", "Escape");
      await sleep(500);
      expect((await injections_of("hints.js")).length === hints_before, "hints.js went through executeScript");
      expect((await injections_of("cmdline.js")).length === cmdline_before, "cmdline.js went through executeScript");
      await evaluate_in_background(rdp, EXTENSION_ID, `(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.endsWith("/newtab.html")) await browser.tabs.remove(tab.id); })()`);
    });

    await run_case("the add-on preferences open the settings page", async () => {
      // Firefox focuses an open help tab instead of opening Settings, so the earlier help case's tab goes first.
      // The answer is a short summary: a whole page of text is too long to come back over RDP.
      const settings = await evaluate_in_background(rdp, EXTENSION_ID, `(async () => {
        for (const tab of await browser.tabs.query({})) if (new URL(tab.url).pathname === "/home.html") await browser.tabs.remove(tab.id);
        await browser.runtime.openOptionsPage();
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const view = ${extension_view("home.html")};
          if (view?.document.querySelector("[data-setting]")) return { hash: view.location.hash, rows: view.document.querySelectorAll("[data-setting]").length };
        }
        return { hash: "", rows: 0 };
      })()`);
      expect(settings?.hash === "#/settings" && settings?.rows > 20, `settings page after openOptionsPage: ${JSON.stringify(settings)}`);
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

    await run_case("tt opens the command line for its prompt without opening a tab", async () => {
      const mark = events.length;
      await send_keys("tt");
      await sleep(1000);
      // The first Escape closes the completion list and keeps the line. The second closes the line.
      await send_keys("-k", "Escape");
      await sleep(400);
      await send_keys("-k", "Escape");
      await sleep(400);
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

    await run_case("Ctrl+A adds one to the number in the address, and 3 then Ctrl+X takes three off", async () => {
      await open_page("page", "num_5", { new_tab: true });
      let mark = events.length;
      await send_keys(...CTRL("a"));
      await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "num_6", "the page num_6 after Ctrl+A");
      mark = events.length;
      await send_keys("3", ...CTRL("x"));
      await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "num_3", "the page num_3 after 3 Ctrl+X");
    });

    await session.sample_tabs("before pieces");
    for (const file of readdirSync(key_test_dir).filter((name) => /^p\d+_.*\.mjs$/.test(name)).sort()) {
      await session.run_piece(file, await import(`./${file}`));
    }
    await session.sample_tabs("after pieces");

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
    await session.close();
  }

  const failed = results.filter((result) => !result.pass);
  const setup_ran = results.filter((result) => result.setup).length;
  if (setup_ran > 0) console.log(`${setup_ran} setup cases ran only because KEY_TEST_ONLY filtered the run`);
  console.log(`${results.length - failed.length} of ${results.length} cases passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(`key-test aborted: ${error.stack}`);
  await shadow_down(SHADOW_NAME).catch(() => undefined);
  process.exit(1);
});
