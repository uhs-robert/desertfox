// The help page and the settings page, both extension pages that load the key scripts by tag.
import { SHIFT_ESCAPE } from "./harness.mjs";
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["help"];

export async function run_cases({ run_case, setup, expect, send_keys, sleep, rdp, extension_id, record, settled_injection_count, injections_of, extension_view, close_tabs_with }) {
  const evaluate = (code) => evaluate_in_background(rdp, extension_id, code);
  const help_badge = () => evaluate(`${extension_view("home.html")}?.document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);

  await setup("open the help page on Commands", async () => {
    await send_keys("qh");
    let state;
    for (let attempt = 0; attempt < 40 && !state?.ready; attempt++) {
      await sleep(250);
      state = await evaluate(`(() => { const view = ${extension_view("home.html")}; return { ready: !!view && !!view.document.querySelector("h1") }; })()`).catch(() => undefined);
    }
    expect(state?.ready, "the help page never rendered");
    // Home is too short to scroll, so move to the long Commands page.
    await evaluate(`(() => { ${extension_view("home.html")}.location.hash = "#/commands"; })()`);
    await sleep(800);
  });

  await run_case("the help page takes j, gg and ignore mode", async () => {
    const probe = () => evaluate(`(() => { const view = ${extension_view("home.html")}; return { y: view.scrollY, badge: view.document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null }; })()`);
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

  // caret.js loads on the help page by script tag, so the caret keys work there. Escape must still leave the page in normal mode.
  await run_case("V on the help page enters caret mode and Escape returns to normal", async () => {
    const loads_before = await settled_injection_count("caret.js");
    await send_keys("gV");
    await sleep(1500);
    const loads = (await injections_of("caret.js")).slice(loads_before);
    record("help_page_caret_load", loads.length === 0 ? "not requested" : loads.at(-1).ok ? "executeScript ok" : "executeScript refused");
    const entered = await help_badge();
    expect(entered === "CARET" || entered === "VISUAL", `the help page badge after V was ${entered}`);
    for (let step = 0; step < 2; step++) {
      await send_keys("-k", "Escape");
      await sleep(400);
    }
    expect(await help_badge() === "NORMAL", `the help page badge after Escape was ${await help_badge()}`);
  });

  await run_case("the add-on preferences open the settings page", async () => {
    // Firefox focuses an open help tab instead of opening Settings, so the help tab goes first.
    // The answer is a short summary: a whole page of text is too long to come back over RDP.
    await close_tabs_with("/home.html");
    const settings = await evaluate(`(async () => {
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
}
