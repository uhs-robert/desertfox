// Bundles load on first use: once per tab, with no key lost during the load, plus the cost of a 20 KB executeScript.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ run_case, expect, open_page, send_keys, sleep, events, wait_event, since, find_event, rdp, extension_id, scroll_delta_after, scroll_of, last_scroll_y, settled_injection_count, injections_of, record }) {
  await run_case("a bundle loads on the first key, once, and no key typed during the load is lost", async () => {
    await open_page("page", "bundle_a", { new_tab: true });
    const loads_before = await settled_injection_count("hints.js");
    // f starts the load. The three keys behind it arrive within a few milliseconds, before the injection can finish.
    // Held in order they scroll to the bottom. Reversed or dropped they would end at the top.
    const mark = events.length;
    await send_keys("fggG");
    await wait_event(mark, (event) => event.type === "scroll" && event.page_id === "bundle_a" && event.y > 0 && event.y >= event.max_y - 2, "the page to end at the bottom after fggG");
    const hint_loads = await injections_of("hints.js", loads_before + 1);
    expect(hint_loads.length === loads_before + 1, `expected one hints.js injection, saw ${hint_loads.length - loads_before}`);
    record("stub_bundle_inject_ms", hint_loads.at(-1).ms);
    await sleep(500);
    const again = events.length;
    await send_keys("gg");
    await wait_event(again, scroll_of("bundle_a"), "gg to scroll after the load");
    expect(last_scroll_y("bundle_a") === 0, "keys did not work after the load");
    await send_keys("f");
    await sleep(800);
    expect((await injections_of("hints.js")).length === loads_before + 1, "a second f injected the bundle again");
  });

  await run_case("a count typed during the load keeps its meaning", async () => {
    await open_page("page", "bundle_b", { new_tab: true });
    const single = await scroll_delta_after("bundle_b", ["j"]);
    await scroll_delta_after("bundle_b", ["gg"]);
    const mark = events.length;
    await send_keys("f3j");
    const reported = await wait_event(mark, scroll_of("bundle_b"), "scroll after f3j");
    expect(Math.abs(reported.y - 3 * single) <= 3, `f3j moved ${reported.y}px, j moves ${single}px`);
  });

  await run_case("V loads the padded caret bundle and enters caret mode, Escape leaves it", async () => {
    await open_page("page", "bundle_c", { new_tab: true });
    const is_label = (label) => (event) => event.type === "indicator" && event.page_id === "bundle_c" && event.label === label;
    const mark = events.length;
    await send_keys("gV");
    await wait_event(mark, is_label("CARET"), "the CARET badge");
    const caret_loads = await injections_of("caret.js", 1);
    expect(caret_loads.length >= 1 && caret_loads.at(-1).ok, "caret.js was not injected");
    record("padded_bundle_inject_ms", caret_loads.at(-1).ms);
    await send_keys("-k", "Escape");
    await wait_event(mark, is_label("NORMAL"), "the NORMAL badge after Escape");
    expect(await scroll_delta_after("bundle_c", ["j"]) > 0, "the page stopped taking keys after V and Escape");
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
