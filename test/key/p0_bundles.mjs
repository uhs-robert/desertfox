// Bundles load on first use: once per tab, with no key lost during the load, plus the cost of a 20 KB executeScript.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["bundles"];

export async function run_cases({ run_case, expect, open_page, press_keys, poll_until, barrier, events, wait_event, rdp, extension_id, scroll_delta_by_press, scroll_of, last_scroll_y, in_background, injections_of, record, sleep }) {
  await run_case("a bundle loads on the first key, once, and no key typed during the load is lost", async () => {
    await open_page("page", "bundle_a", { new_tab: true });
    // The log keeps the last 20 loads, so after a hints piece on this shard its length stays put. Only this new tab's entries count.
    const tab_id = await in_background(`browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]?.id)`);
    expect(Number.isInteger(tab_id), `no active tab id: ${tab_id}`);
    const hint_loads_of_tab = async () => (await injections_of("hints.js")).filter((entry) => entry.tab_id === tab_id);
    // f starts the load. The three keys behind it arrive within a few milliseconds, before the injection can finish.
    // Held in order they scroll to the bottom. Reversed or dropped they would end at the top.
    const mark = events.length;
    await press_keys("fggG");
    await wait_event(mark, (event) => event.type === "scroll" && event.page_id === "bundle_a" && event.y > 0 && event.y >= event.max_y - 2, "the page to end at the bottom after fggG");
    await poll_until("the hints.js injection log entry of this tab", async () => (await hint_loads_of_tab()).length > 0, { timeout_ms: 1500 }).catch(() => undefined);
    const hint_loads = await hint_loads_of_tab();
    expect(hint_loads.length === 1, `expected one hints.js injection, saw ${hint_loads.length}`);
    record("stub_bundle_inject_ms", hint_loads.at(-1).ms);
    const again = events.length;
    await press_keys("gg");
    await wait_event(again, scroll_of("bundle_a"), "gg to scroll after the load");
    expect(last_scroll_y("bundle_a") === 0, "keys did not work after the load");
    await press_keys("f");
    await barrier("bundle_a");
    await sleep(300);
    expect((await hint_loads_of_tab()).length === 1, "a second f injected the bundle again");
  });

  await run_case("a count typed during the load keeps its meaning", async () => {
    await open_page("page", "bundle_b", { new_tab: true });
    const single = await scroll_delta_by_press("bundle_b", ["j"]);
    await scroll_delta_by_press("bundle_b", ["gg"]);
    const mark = events.length;
    await press_keys("f3j");
    const reported = await wait_event(mark, scroll_of("bundle_b"), "scroll after f3j");
    expect(Math.abs(reported.y - 3 * single) <= 3, `f3j moved ${reported.y}px, j moves ${single}px`);
  });

  await run_case("V loads the padded caret bundle and enters caret mode, Escape leaves it", async () => {
    await open_page("page", "bundle_c", { new_tab: true });
    const tab_id = await in_background(`browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]?.id)`);
    expect(Number.isInteger(tab_id), `no active tab id: ${tab_id}`);
    const is_label = (label) => (event) => event.type === "indicator" && event.page_id === "bundle_c" && event.label === label;
    const mark = events.length;
    await press_keys("gV");
    await wait_event(mark, is_label("CARET"), "the CARET badge");
    // Only this tab's entries count, so a caret load from another piece or an evicted log entry cannot decide the case.
    const caret_loads_of_tab = async () => (await injections_of("caret.js")).filter((entry) => entry.tab_id === tab_id);
    await poll_until("the caret.js injection log entry of this tab", async () => (await caret_loads_of_tab()).length > 0, { timeout_ms: 1500 }).catch(() => undefined);
    const caret_loads = await caret_loads_of_tab();
    expect(caret_loads.length >= 1 && caret_loads.at(-1).ok, "caret.js was not injected into the new tab");
    record("padded_bundle_inject_ms", caret_loads.at(-1).ms);
    await press_keys("-k", "Escape");
    await wait_event(mark, is_label("NORMAL"), "the NORMAL badge after Escape");
    expect(await scroll_delta_by_press("bundle_c", ["j"]) > 0, "the page stopped taking keys after V and Escape");
  });

  await run_case("executeScript of a 20 KB file takes this long", async () => {
    const run_ms = await evaluate_in_background(rdp, extension_id, `(async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const ms = [];
      for (let run = 0; run < 15; run++) {
        const started = performance.now();
        await browser.tabs.executeScript(tab.id, { file: "caret.js", runAt: "document_start" });
        ms.push(performance.now() - started);
      }
      return ms;
    })()`);
    const sorted_ms = [...run_ms].sort((left, right) => left - right);
    record("execute_script_20kb_ms", { runs: sorted_ms.length, min: sorted_ms[0], median: sorted_ms[sorted_ms.length >> 1], max: sorted_ms.at(-1) });
  });
}
