// The new tab page loads content.js by tag and every other bundle on first use, through a script tag the page adds on the background's request, since executeScript cannot reach an extension page.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["newtab"];

export async function run_cases({ run_case, expect, press_keys, poll_until, wait_tab_quiet, rdp, extension_id, injections_of, extension_view }) {
  const evaluate = (code) => evaluate_in_background(rdp, extension_id, code);

  await run_case("the new tab page takes : and f without asking executeScript", async () => {
    const tab_id = await evaluate(`browser.tabs.create({ url: browser.runtime.getURL("newtab.html") }).then((tab) => tab.id)`);
    expect(Number.isInteger(tab_id), `no new tab id: ${tab_id}`);
    await poll_until("the new tab page to render and take focus", async () => await evaluate(`(() => { const view = ${extension_view("newtab.html")}; return !!view?.document.querySelector(".desertfox-newtab") && view.document.hasFocus(); })()`).catch(() => false), { timeout_ms: 10000 });
    await wait_tab_quiet(tab_id);
    const mode = () => evaluate(`${extension_view("newtab.html")}?.desertfox_host?.get_mode() ?? null`);
    const wait_mode = (wanted) => poll_until(`the mode to be ${wanted}`, async () => (await mode()) === wanted).catch(async (error) => { throw new Error(`${error.message} (it is ${await mode()})`); });
    await press_keys(":");
    await wait_mode("cmdline");
    // The first Escape closes the completion list, the second closes the line.
    await press_keys("-k", "Escape", "-k", "Escape");
    await wait_mode("normal");
    await evaluate(`(() => { const view = ${extension_view("newtab.html")}; const link = view.document.createElement("a"); link.href = "https://example.com/"; link.textContent = "link"; link.style.cssText = "position:fixed;top:20px;left:20px;color:white;"; view.document.body.append(link); })()`);
    await press_keys("f");
    await wait_mode("hint");
    await press_keys("-k", "Escape");
    await wait_mode("normal");
    // Only this tab's entries count, so an evicted entry in the bounded log cannot hide an injection.
    for (const bundle of ["hints.js", "cmdline.js"]) {
      expect((await injections_of(bundle)).every((entry) => entry.tab_id !== tab_id), `${bundle} went through executeScript`);
    }
  });

  await run_case("typing in an input on the new tab page loads the text bundle without a failure message", async () => {
    // The page the first case opened is still the focused tab.
    await poll_until("the new tab page to hold the focus", async () => await evaluate(`${extension_view("newtab.html")}?.document.hasFocus() ?? false`).catch(() => false), { timeout_ms: 10000 });
    await evaluate(`(() => { const view = ${extension_view("newtab.html")}; view.desertfox_test_roots = []; const attach = view.Element.prototype.attachShadow; view.Element.prototype.attachShadow = function (init) { const root = attach.call(this, { ...init, mode: "open" }); view.desertfox_test_roots.push(root); return root; }; const input = view.document.createElement("input"); input.id = "desertfox-test-input"; view.document.body.prepend(input); input.focus(); })()`);
    await press_keys("x", "y");
    await poll_until("the input to hold xy and the text bundle to be ready", async () => await evaluate(`(() => { const view = ${extension_view("newtab.html")}; return view.document.getElementById("desertfox-test-input").value === "xy" && view.desertfox_text_ready === true; })()`).catch(() => false));
    const messages = await evaluate(`${extension_view("newtab.html")}.desertfox_test_roots.map((root) => root.textContent).join(" | ")`);
    expect(!/could not load/.test(messages), `a load failure showed on the new tab page: ${messages}`);
  });
}
