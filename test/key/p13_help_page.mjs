// The help page and the settings page, both extension pages. They load content.js by tag and every other bundle on first use, through a script tag the page adds on the background's request.
import { SHIFT_ESCAPE } from "./harness.mjs";
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["help"];

export async function run_cases({ run_case, setup, expect, press_keys, poll_until, wait_tab_quiet, rdp, extension_id, record, settled_injection_count, injections_of, extension_view, close_tabs_with }) {
  const evaluate = (code) => evaluate_in_background(rdp, extension_id, code);
  const help_badge = () => evaluate(`${extension_view("home.html")}?.document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const wait_badge = (accepted, what) => poll_until(`the help page badge to be ${what}`, async () => accepted.includes(await help_badge()));

  await setup("open the help page on Commands", async () => {
    await press_keys(",h");
    await poll_until("the help page to render and take focus", async () => await evaluate(`(() => { const view = ${extension_view("home.html")}; return !!view && !!view.document.querySelector("h1") && view.document.hasFocus(); })()`).catch(() => false), { timeout_ms: 10000 });
    // Home is too short to scroll, so move to the long Commands page.
    await evaluate(`(() => { ${extension_view("home.html")}.location.hash = "#/commands"; })()`);
    await poll_until("the Commands page to be long enough to scroll", async () => await evaluate(`(() => { const view = ${extension_view("home.html")}; return view.document.documentElement.scrollHeight > view.innerHeight; })()`).catch(() => false));
    await wait_tab_quiet(await evaluate(`browser.tabs.query({}).then((tabs) => tabs.find((tab) => tab.url.includes("/home.html"))?.id)`));
  });

  await run_case("the help page takes j, gg and ignore mode", async () => {
    const probe = () => evaluate(`(() => { const view = ${extension_view("home.html")}; return { y: view.scrollY, badge: view.document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null }; })()`);
    await press_keys("j", "j", "j");
    await poll_until("the help page to scroll after j", async () => (await probe()).y > 0).catch(async (error) => { throw new Error(`j did not scroll the help page (${error.message}, y=${(await probe()).y})`); });
    await press_keys("gg");
    await poll_until("the help page to return to the top after gg", async () => (await probe()).y === 0);
    await press_keys(...SHIFT_ESCAPE);
    await wait_badge(["IGNORE"], "IGNORE after <S-Escape>");
    await press_keys(...SHIFT_ESCAPE);
    await wait_badge(["NORMAL"], "NORMAL after the second <S-Escape>");
  });

  // caret.js loads on the help page by script tag, so the caret keys work there. Escape must still leave the page in normal mode.
  await run_case("V on the help page enters caret mode and Escape returns to normal", async () => {
    const loads_before = await settled_injection_count("caret.js");
    await press_keys("gV");
    await wait_badge(["CARET", "VISUAL"], "CARET or VISUAL after V");
    await settled_injection_count("caret.js");
    const loads = (await injections_of("caret.js")).slice(loads_before);
    record("help_page_caret_load", loads.length === 0 ? "not requested" : loads.at(-1).ok ? "executeScript ok" : "executeScript refused");
    for (let step = 0; step < 2; step++) {
      await press_keys("-k", "Escape");
      if (await wait_badge(["NORMAL"], "NORMAL after Escape").then(() => true, () => false)) break;
    }
    expect(await help_badge() === "NORMAL", `the help page badge after Escape was ${await help_badge()}`);
  });

  await run_case("the add-on preferences open the settings page", async () => {
    // Firefox focuses an open help tab instead of opening Settings, so the help tab goes first.
    // The answer is a short summary: a whole page of text is too long to come back over RDP.
    await close_tabs_with("/home.html");
    const settings = await evaluate(`(async () => {
      await browser.runtime.openOptionsPage();
      for (let attempt = 0; attempt < 150; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const view = ${extension_view("home.html")};
        if (view?.document.querySelector("[data-setting]")) return { hash: view.location.hash, rows: view.document.querySelectorAll("[data-setting]").length };
      }
      return { hash: "", rows: 0 };
    })()`);
    expect(settings?.hash === "#/settings" && settings?.rows > 20, `settings page after openOptionsPage: ${JSON.stringify(settings)}`);
  });

  // Each bundle loads on first use. The background asks the page to add the tag, because executeScript is refused on a moz-extension page.
  await run_case("typing in a Settings field and Ctrl+O load the text and editor bundles without a failure message", async () => {
    // The toast sits in a closed shadow root. Opening roots from here on lets the test read a message that appears.
    await evaluate(`(() => { const view = ${extension_view("home.html")}; if (view.desertfox_test_roots) return; view.desertfox_test_roots = []; const attach = view.Element.prototype.attachShadow; view.Element.prototype.attachShadow = function (init) { const root = attach.call(this, { ...init, mode: "open" }); view.desertfox_test_roots.push(root); return root; }; })()`);
    const field_focused = await evaluate(`(() => { const view = ${extension_view("home.html")}; const field = view.document.querySelector("input.desertfox-settings-input[type=text], input.desertfox-settings-input:not([type])"); field?.focus(); if (field) field.value = ""; return view.document.activeElement === field && !!field; })()`);
    expect(field_focused, "a Settings text field takes the focus");
    await press_keys("x", "y");
    await poll_until("the Settings field to hold xy and the text bundle to be ready", async () => await evaluate(`(() => { const view = ${extension_view("home.html")}; return view.document.activeElement?.value === "xy" && view.desertfox_text_ready === true; })()`).catch(() => false));
    // Ctrl+O only has to reach the editor bundle. The test opens no external editor.
    await press_keys("-M", "ctrl", "o", "-m", "ctrl");
    await poll_until("the editor bundle to be ready", async () => await evaluate(`${extension_view("home.html")}.desertfox_editor_ready === true`).catch(() => false));
    const messages = await evaluate(`${extension_view("home.html")}.desertfox_test_roots.map((root) => root.textContent).join(" | ")`);
    expect(!/could not load/.test(messages), `a load failure showed on the Settings page: ${messages}`);
  });
}
