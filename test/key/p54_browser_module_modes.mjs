// The browser module's modes on pages with no DesertFox page code (browser_module/sources/commands.js): `i` starts insert mode and Escape leaves it, Escape in a field blurs it, <A-Escape> sends the page an Escape, a remapped Escape follows the keymap, and the status bar shows the mode.
// The module reads the mode from the attribute `desertfox-module-mode` of the tab's <browser>, which the bar draws and this piece reads.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["keys", "tabs"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const STATE_KEY = "desertfox_browser_module_state";
const MODE_ATTRIBUTE = "desertfox-module-mode";
const ALT_ESCAPE = ["-M", "alt", "-k", "Escape", "-m", "alt"];
const CTRL_BRACKET = ["-M", "ctrl", "[", "-m", "ctrl"];
const CTRL_V = ["-M", "ctrl", "v", "-m", "ctrl"];
const SHIFT_INSERT = ["-M", "shift", "-k", "Insert", "-m", "shift"];

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, on_teardown, run_line, sleep, config_copy, config_dir, load_config_dir } = context;
  const steps = module_steps(context);
  const { chrome, session_value, open_tab, focus_page, in_selected_page, close_selected_tab, home, switches_none, switches_one } = steps;

  const module_mode = () => chrome(`(async () => ${W}.gBrowser.selectedBrowser.getAttribute(${JSON.stringify(MODE_ATTRIBUTE)}))()`);
  const bar_mode = () =>
    chrome(`(async () => {
      const bar = ${W}.document.getElementById("desertfox-statusbar");
      return bar?.hasAttribute("data-on") ? bar.querySelector(".dfx-left")?.firstElementChild?.textContent ?? null : null;
    })()`);
  const field_focused = () => chrome(`(async () => ${W}.windowUtils.IMEStatus === Components.interfaces.nsIDOMWindowUtils.IME_STATUS_ENABLED)()`);
  // The keys the page's own listener sees, as "key:trusted", so a key the module took shows nothing.
  const watch_page_keys = () => in_selected_page(`(win) => { win.document.documentElement.dataset.seen = ""; win.addEventListener("keydown", (event) => { win.document.documentElement.dataset.seen += event.key + ":" + event.isTrusted + ":" + event.altKey + " "; }, true); return true; }`);
  const seen_keys = () => in_selected_page(`(win) => win.document.documentElement.dataset.seen`);
  const focus_search_box = async (selector) => {
    await in_selected_page(`(win) => { win.document.querySelector(${JSON.stringify(selector)})?.focus(); return true; }`);
    await poll_until("the search box to take the focus", field_focused);
  };
  const page_ready = async (page) => {
    await poll_until(`${page} to draw its content`, () => in_selected_page(`(win) => win.document.readyState === "complete" && (win.document.body?.textContent?.length ?? 0) > 20`), { timeout_ms: 8000 });
    await focus_page();
  };

  await setup("turn the module on, with the mode keys in its tree", async () => {
    await steps.turn_on_module();
    await poll_until("the tree to hold the mode keys and the state to hold the insert table", async () => {
      const state = await session_value(STATE_KEY);
      return state?.tree?.children?.i?.native === "mode.insert" && state.insert_keys?.some((row) => row.key === "<Escape>" && row.id === "mode.escape");
    }, { timeout_ms: 8000 });
    const hello = await session_value("desertfox_browser_module_hello");
    expect(hello?.mode_keys === true, `the hello says ${JSON.stringify(hello)}`);
  });
  on_teardown(() => run_line(":unset browser_bar"));
  await run_line(":set browser_bar true");

  for (const page of ["about:preferences", "about:addons"]) {
    await run_case(`on ${page}: i gives j to the page, the badge shows INSERT, and Escape leaves it`, async () => {
      await home(`bmm_${page.replace(/\W+/g, "_")}`);
      await open_tab(page);
      await page_ready(page);
      await watch_page_keys();
      await press_keys("j");
      await sleep(300);
      expect(!(await seen_keys()).includes("j:"), "the module took j before insert mode");

      await press_keys("i");
      await poll_until("the attribute to say insert", async () => (await module_mode()) === "insert");
      await poll_until("INSERT in the bar", async () => (await bar_mode()) === "INSERT", { timeout_ms: 5000 });
      await press_keys("j");
      await poll_until("j to reach the page in insert mode", async () => (await seen_keys()).includes("j:true"));
      await switches_none("J in insert mode");

      await press_keys("-k", "Escape");
      await poll_until("the attribute to go", async () => (await module_mode()) === null);
      await poll_until("NORMAL in the bar", async () => (await bar_mode()) === "NORMAL", { timeout_ms: 5000 });
      expect(!(await seen_keys()).includes("Escape:"), `the page saw the Escape that left insert mode: ${await seen_keys()}`);
      await switches_one("J after insert mode ends");
      await close_selected_tab();
    });
  }

  await run_case("on about:preferences: Escape in the search box blurs it and leaves the page's Escape unrun, and <A-Escape> sends the page an Escape and keeps the focus", async () => {
    await home("bmm_field");
    await open_tab("about:preferences");
    await page_ready("about:preferences");
    await watch_page_keys();
    await focus_search_box("#searchInput");
    await press_keys("-k", "Escape");
    await poll_until("Escape to take the focus out of the search box", async () => !(await field_focused()));
    expect(!(await seen_keys()).includes("Escape:true"), `the page saw the user's Escape: ${await seen_keys()}`);

    await focus_search_box("#searchInput");
    await in_selected_page(`(win) => { win.document.documentElement.dataset.seen = ""; return true; }`);
    await press_keys(...ALT_ESCAPE);
    // This page has the system principal, so the module's sent Escape is trusted: the page gets exactly that one Escape, and the user's own <A-Escape> never reaches it.
    const escapes_seen = async () => ((await seen_keys()).match(/Escape:/g) ?? []).length;
    await poll_until("the page to get the sent Escape", async () => (await escapes_seen()) >= 1);
    await sleep(300);
    // The entry is key:trusted:alt. The sent Escape has no Alt, so an Alt one is the user's own key leaking through.
    expect((await escapes_seen()) === 1 && (await seen_keys()).includes("Escape:true:false"), `the page did not see exactly the one Escape the module sent: ${await seen_keys()}`);
    expect(await field_focused(), "<A-Escape> blurred the field");
    await close_selected_tab();
  });

  await run_case("on about:preferences: insert mode, then Escape in the search box leaves both the mode and the field", async () => {
    await home("bmm_insert_field");
    await open_tab("about:preferences");
    await page_ready("about:preferences");
    await press_keys("i");
    await poll_until("insert mode", async () => (await module_mode()) === "insert");
    await focus_search_box("#searchInput");
    await press_keys("-k", "Escape");
    await poll_until("Escape to leave insert mode", async () => (await module_mode()) === null);
    await poll_until("Escape to blur the field", async () => !(await field_focused()));
    await close_selected_tab();
  });

  await run_case("<S-Insert> and ,i give every key to the page and show IGNORE, and <C-v> passes one key and shows PASS", async () => {
    await home("bmm_ignore");
    await open_tab("about:addons");
    await page_ready("about:addons");
    await watch_page_keys();
    await press_keys(...SHIFT_INSERT);
    await poll_until("ignore mode", async () => (await module_mode()) === "ignore");
    await poll_until("IGNORE in the bar", async () => (await bar_mode()) === "IGNORE", { timeout_ms: 5000 });
    await press_keys("j");
    await poll_until("j to reach the page in ignore mode", async () => (await seen_keys()).includes("j:true"));
    await press_keys("-M", "shift", "-k", "Escape", "-m", "shift");
    await poll_until("ignore mode to end", async () => (await module_mode()) === null);

    await press_keys(",i");
    await poll_until("ignore mode from ,i", async () => (await module_mode()) === "ignore");
    await press_keys("-M", "shift", "-k", "Escape", "-m", "shift");
    await poll_until("ignore mode to end again", async () => (await module_mode()) === null);

    await press_keys(...CTRL_V);
    await poll_until("pass-next", async () => (await module_mode()) === "pass");
    await poll_until("PASS in the bar", async () => (await bar_mode()) === "PASS", { timeout_ms: 5000 });
    await press_keys("k");
    await poll_until("k to reach the page", async () => (await seen_keys()).includes("k:true"));
    await poll_until("pass-next to end", async () => (await module_mode()) === null);
    await switches_one("J after the passed key");
    await close_selected_tab();
  });

  // Last: the config stays remapped to the end of the piece.
  await run_case("a remapped Escape works: with <Escape> unbound and <C-[> bound in insert mode, Escape goes to the page and <C-[> blurs the field", async () => {
    await home("bmm_remap");
    const dir = config_copy();
    writeFileSync(join(dir, "keymap.d", "90-browser-module-modes.toml"), '[insert]\n"<Escape>" = ""\n"<C-[>" = "mode.escape"\n');
    on_teardown(() => load_config_dir(config_dir));
    await load_config_dir(dir);
    await poll_until("the insert table to hold <C-[> and not <Escape>", async () => {
      const rows = (await session_value(STATE_KEY))?.insert_keys ?? [];
      return rows.some((row) => row.key === "<C-[>" && row.id === "mode.escape") && !rows.some((row) => row.key === "<Escape>");
    }, { timeout_ms: 8000 });
    await open_tab("about:preferences");
    await page_ready("about:preferences");
    await watch_page_keys();
    await focus_search_box("#searchInput");
    await press_keys("-k", "Escape");
    await poll_until("the page to see Escape", async () => (await seen_keys()).includes("Escape:true"));
    expect(await field_focused(), "Escape blurred the field although it is unbound");
    await press_keys(...CTRL_BRACKET);
    await poll_until("<C-[> to blur the field", async () => !(await field_focused()));

    await press_keys("i");
    await poll_until("insert mode", async () => (await module_mode()) === "insert");
    await press_keys("-k", "Escape");
    await sleep(300);
    expect((await module_mode()) === null, "the unbound Escape kept insert mode");
    await press_keys("i");
    await poll_until("insert mode again", async () => (await module_mode()) === "insert");
    await press_keys(...CTRL_BRACKET);
    await poll_until("<C-[> to leave insert mode", async () => (await module_mode()) === null);
    await close_selected_tab();
  });
}
