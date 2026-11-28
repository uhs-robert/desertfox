// The which-key panel the browser module draws in chrome (browser_module/desertfox-whichkey.js) on pages where no DesertFox page code runs: about:preferences in the parent process, about:support, about:protections in its own process, an error page, a restricted site, and the PDF viewer and Reader View with browser_module_pages off.
// Also that it leaves with the keys (a leaf, Escape, a tab switch), that a panel up follows the next prefix key at once, that a window closed with a panel up leaves no error, and that with browser_module_pages on the page code's own panel is the only one.
// Set DESERTFOX_SHOT_DIR to also save screenshots of the panel.
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { make_article, make_pdf, module_steps, NO_EFFECT_MS } from "./browser_module_steps.mjs";

export const areas = ["whichkey", "keys", "ui"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const STATE_KEY = "desertfox_browser_module_state";
const CONFIG_SNAPSHOT_KEY = "desertfox_browser_module_snapshot_config";
// The panel in the newest window, read through its closed shadow root, or null while none is up.
const PANEL_NOW = `(async () => {
  const host = [...${W}.document.documentElement.children].find((child) => child.className === "desertfox-whichkey-host");
  const root = host?.openOrClosedShadowRoot;
  if (!root) return null;
  const box = root.querySelector(".frame")?.getBoundingClientRect();
  return { title: root.querySelector(".chip")?.textContent ?? "", rows: [...root.querySelectorAll(".row")].map((row) => row.textContent), footer: root.querySelector(".footer")?.textContent ?? "", width: box?.width ?? 0, height: box?.height ?? 0 };
})()`;
// The page code's own panel. The key-test build marks its host.
const PAGE_PANEL = `(win) => [...win.document.documentElement.children].some((child) => child.hasAttribute("data-desertfox-whichkey") && child.isConnected)`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, run_line, on_teardown, take_shot, url_of, which_key_delay_ms } = context;
  const steps = module_steps(context);
  const { chrome, session_value, open_tab, focus_page, in_selected_page, close_selected_tab, home } = steps;
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  const shot = async (name) => {
    if (!shot_dir) return;
    await sleep(300);
    await take_shot(join(shot_dir, `whichkey-${name}.png`));
  };
  const files_dir = mkdtempSync(join(tmpdir(), "desertfox-module-whichkey-"));
  writeFileSync(join(files_dir, "long.pdf"), make_pdf(6), "latin1");
  const pdf_url = pathToFileURL(join(files_dir, "long.pdf")).href;
  const server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(make_article()));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  on_teardown(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const reader_url = `about:reader?url=${encodeURIComponent(`${origin}/article`)}`;

  const panel_now = () => chrome(PANEL_NOW);
  let g_rows = 0;
  const shows_g = async (where) => {
    await press_keys("g");
    await poll_until(`the which-key panel for g on ${where}`, async () => (await panel_now())?.rows.length === g_rows, { timeout_ms: 3000 });
    const panel = await panel_now();
    expect(panel.title === "+Go", `the title on ${where} is ${panel.title}`);
    expect(panel.footer === "ESCclose", `the footer on ${where} is ${panel.footer}`);
  };
  const gone = (what) => poll_until(`the panel to go: ${what}`, async () => (await panel_now()) === null, { timeout_ms: 2000 });
  const pages_setting_on = async () => (await session_value(CONFIG_SNAPSHOT_KEY))?.value?.settings?.browser_module_pages === true;
  const pages_setting = async (on) => {
    await home(`wk_pages_${on}`);
    await run_line(`:set browser_module_pages ${on}`);
    await poll_until(`the config snapshot with the setting ${on ? "on" : "off"}`, async () => (await pages_setting_on()) === on);
  };
  const ready = async (what) => {
    // An error page has little text, and its open already waited for it.
    if (what === "an error page") return focus_page();
    await poll_until(`${what} to draw`, () => in_selected_page(`(win) => win.document.readyState === "complete" && (win.document.body?.textContent?.length ?? 0) > 20`), { timeout_ms: 10000 });
    await focus_page();
  };

  await setup("turn the module on, with the which-key table in its state", async () => {
    await steps.turn_on_module();
    await poll_until("the state to hold the which-key table", async () => !!(await session_value(STATE_KEY))?.which_key?.panels?.g);
    g_rows = (await session_value(STATE_KEY)).which_key.panels.g.rows.length;
    const status = await steps.module_status();
    expect(status.features.includes("desertfox-commands.js"), `the module loaded ${status.features.join(", ")}`);
  });

  await run_case("on about:preferences g shows the panel, gg runs and hides it, and Escape and a tab switch hide it", async () => {
    await home("wk_prefs");
    await open_tab("about:preferences");
    await ready("about:preferences");
    await shows_g("about:preferences");
    await shot("about-preferences");
    await press_keys("g");
    await gone("gg ran");
    await shows_g("about:preferences");
    await press_keys("-k", "Escape");
    await gone("Escape");
    await shows_g("about:preferences");
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; })()`);
    await gone("a tab switch");
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs.at(-1); })()`);
    await focus_page();
    await sleep(NO_EFFECT_MS);
    expect((await panel_now()) === null, "the panel came back with the tab");
    await close_selected_tab();
  });

  await run_case("on about:preferences alt+? shows the root list, and Escape and a next key hide it", async () => {
    await home("wk_root");
    await open_tab("about:preferences");
    await ready("about:preferences");
    const root_rows = (await session_value(STATE_KEY)).which_key.root.rows.length;
    for (const ending of [["-k", "Escape"], ["j"]]) {
      await press_keys("-M", "alt", "?", "-m", "alt");
      await poll_until("the root list", async () => (await panel_now())?.rows.length === root_rows, { timeout_ms: 3000 });
      const panel = await panel_now();
      expect(panel.title === "keys" && panel.footer === "ESCclose", `the root list reads ${panel.title} / ${panel.footer}`);
      await shot("about-preferences-root");
      await press_keys(...ending);
      await gone(`the root list after ${ending.join(" ")}`);
    }
    await close_selected_tab();
  });

  await run_case("a panel that is up follows the next prefix key at once", async () => {
    await home("wk_instant");
    await open_tab("about:preferences");
    await ready("about:preferences");
    await shows_g("about:preferences");
    await press_keys("o");
    await poll_until("the panel for g o", async () => (await panel_now())?.title.endsWith("+Open quickmark"), { timeout_ms: Math.max(300, which_key_delay_ms) });
    await shot("about-preferences-deeper");
    await press_keys("-k", "Escape");
    await gone("Escape");
    await close_selected_tab();
  });

  for (const [page, open] of [
    ["about:support", () => open_tab("about:support")],
    ["about:protections", () => open_tab("about:protections")],
    ["the PDF viewer with browser_module_pages off", () => open_tab(pdf_url)],
    ["Reader View with browser_module_pages off", () => open_tab(reader_url)],
    ["a restricted site", async () => {
      const PREF = "extensions.webextensions.restrictedDomains";
      const before = await chrome(`(async () => Services.prefs.getStringPref("${PREF}", ""))()`);
      on_teardown(() => chrome(`(async () => Services.prefs.setStringPref("${PREF}", ${JSON.stringify(before)}))()`));
      await chrome(`(async () => Services.prefs.setStringPref("${PREF}", ${JSON.stringify(`${before},localhost`)}))()`);
      await open_tab(url_of("page", "wk_restricted").replace("127.0.0.1", "localhost"), { loaded: (spec) => spec.includes("wk_restricted") });
    }],
    ["an error page", async () => {
      const probe = createServer();
      await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
      const closed_port = probe.address().port;
      await new Promise((resolve) => probe.close(resolve));
      await open_tab(`http://127.0.0.1:${closed_port}/`, { loaded: (spec) => spec.includes(String(closed_port)) });
      await poll_until("the error page", () => in_selected_page(`(win) => win.document.documentURI.startsWith("about:neterror")`));
    }],
  ]) {
    const id = page.replace(/\W+/g, "-").toLowerCase();
    await run_case(`on ${page} g shows the panel and Escape hides it`, async () => {
      const pages_off = page.includes("browser_module_pages off");
      if (pages_off) {
        await pages_setting(false);
        on_teardown(async () => {
          if (await pages_setting_on()) return;
          await pages_setting(true);
        });
      } else await home(`wk_${id}`);
      await open();
      await ready(page);
      await shows_g(page);
      await shot(id);
      await press_keys("-k", "Escape");
      await gone(`Escape on ${page}`);
      await close_selected_tab();
      if (pages_off) await pages_setting(true);
    });
  }

  for (const [page, url] of [
    ["the PDF viewer", pdf_url],
    ["Reader View", reader_url],
  ]) {
    await run_case(`with browser_module_pages on, ${page} shows only the page code's panel`, async () => {
      await home(`wk_pages_on_${page.replace(/\W+/g, "_")}`);
      expect(await pages_setting_on(), "browser_module_pages is off, so this case tests nothing");
      await open_tab(url);
      await ready(page);
      await poll_until(`the page code on ${page}`, () => in_selected_page(`(win) => win.document.documentElement.hasAttribute("data-desertfox-tree-read-ms")`), { timeout_ms: 8000 });
      await focus_page();
      await press_keys("g");
      await poll_until(`the page code's panel on ${page}`, () => in_selected_page(PAGE_PANEL), { timeout_ms: 3000 });
      await sleep(NO_EFFECT_MS);
      expect((await panel_now()) === null, `the module drew a second panel on ${page}`);
      await shot(`${page.replace(/\W+/g, "-").toLowerCase()}-pages-on`);
      await press_keys("-k", "Escape");
      await close_selected_tab();
    });
  }

  await run_case("a window closed with its panel up leaves no error, and the panel still shows in the window left", async () => {
    await home("wk_close");
    const errors_before = (await steps.module_status()).errors.length;
    await chrome(`(async () => { Services.desertfox_key_test_first_window = ${W}; })()`);
    on_teardown(() => chrome(`(async () => { delete Services.desertfox_key_test_first_window; })()`));
    await chrome(`(async () => { ${W}.OpenBrowserWindow(); })()`);
    await poll_until("the new window", async () => (await chrome(`(async () => ${W} !== Services.desertfox_key_test_first_window && ${W}.document.readyState === "complete")()`)) === true, { timeout_ms: 8000 });
    await sleep(500);
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedBrowser.fixupAndLoadURIString("about:preferences", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); })()`);
    await steps.wait_loaded((spec) => spec === "about:preferences");
    await ready("about:preferences in the new window");
    await shows_g("the new window");
    // The tiling session gives each of the two windows half the screen, so this is the narrow window's shot.
    await shot("half-width-window");
    await chrome(`(async () => { ${W}.close(); Services.desertfox_key_test_first_window.focus(); })()`);
    await poll_until("the new window to close", async () => (await chrome(`(async () => [...Services.wm.getEnumerator("navigator:browser")].length)()`)) === 1);
    await sleep(300);
    const errors = (await steps.module_status()).errors;
    expect(errors.length === errors_before, `the module logged ${errors.slice(errors_before).join(" | ")}`);
    await open_tab("about:preferences");
    await ready("about:preferences");
    await shows_g("the window left");
    await press_keys("-k", "Escape");
    await gone("Escape");
    await close_selected_tab();
  });

  if (shot_dir) {
    await run_case("shots of the panel: dark theme, no status bar", async () => {
      await home("wk_shots");
      on_teardown(() => chrome(`(async () => Services.prefs.clearUserPref("ui.systemUsesDarkTheme"))()`));
      await chrome(`(async () => Services.prefs.setIntPref("ui.systemUsesDarkTheme", 1))()`);
      await open_tab("about:preferences");
      await ready("about:preferences");
      await shows_g("about:preferences in the dark theme");
      await shot("about-preferences-dark");
      await press_keys("-k", "Escape");
      await chrome(`(async () => Services.prefs.clearUserPref("ui.systemUsesDarkTheme"))()`);
      await close_selected_tab();

      // The harness's closing :unset all brings the bar back if the case stops early.
      await run_line(":set browser_bar false");
      await sleep(300);
      await open_tab("about:preferences");
      await ready("about:preferences");
      await shows_g("about:preferences with no status bar");
      await shot("about-preferences-no-bar");
      await press_keys("-k", "Escape");
      await close_selected_tab();
      await run_line(":unset browser_bar");
    });
  }
}
