// The new tab page loads every key script by tag, since executeScript cannot reach an extension page.
import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ run_case, expect, send_keys, sleep, rdp, extension_id, settled_injection_count, injections_of, extension_view }) {
  const evaluate = (code) => evaluate_in_background(rdp, extension_id, code);

  await run_case("the new tab page takes : and f without asking executeScript", async () => {
    const hints_before = await settled_injection_count("hints.js");
    const cmdline_before = await settled_injection_count("cmdline.js");
    await evaluate(`browser.tabs.create({ url: browser.runtime.getURL("newtab.html") })`);
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt++) {
      await sleep(250);
      ready = await evaluate(`!!${extension_view("newtab.html")}?.document.querySelector(".desertfox-newtab")`).catch(() => false);
    }
    expect(ready, "the new tab page never rendered");
    await sleep(800);
    const mode = () => evaluate(`${extension_view("newtab.html")}?.desertfox_host?.get_mode() ?? null`);
    await send_keys(":");
    await sleep(800);
    expect(await mode() === "cmdline", `the mode after : was ${await mode()}`);
    // The first Escape closes the completion list, the second closes the line.
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await sleep(500);
    expect(await mode() === "normal", `the mode after Escape was ${await mode()}`);
    await evaluate(`(() => { const view = ${extension_view("newtab.html")}; const link = view.document.createElement("a"); link.href = "https://example.com/"; link.textContent = "link"; link.style.cssText = "position:fixed;top:20px;left:20px;color:white;"; view.document.body.append(link); })()`);
    await send_keys("f");
    await sleep(1500);
    expect(await mode() === "hint", `the mode after f was ${await mode()}`);
    await send_keys("-k", "Escape");
    await sleep(500);
    expect((await injections_of("hints.js")).length === hints_before, "hints.js went through executeScript");
    expect((await injections_of("cmdline.js")).length === cmdline_before, "cmdline.js went through executeScript");
  });
}
