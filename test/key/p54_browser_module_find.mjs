// Find on locked pages (browser_module/desertfox-find.js): `/` opens a find line in the command line panel, Enter selects the first match through Firefox's Finder, and the status bar shows the place among the matches.
// The text is plain: a regular expression finds nothing. n and N repeat the search, * and # search the selected text of a parent-process about: page, and a private tab is refused.
import { module_steps, NO_EFFECT_MS, panel_steps } from "./browser_module_steps.mjs";

export const areas = ["keys", "cmdline"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const EXTENSION_ID = "desertfox@uhs-robert";
const COUNT = /^(\d+)\/(\d+)\+?(?: \(wrapped\))?$/;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, run_line, on_teardown, clear_notices } = context;
  const steps = module_steps(context);
  const panel = panel_steps(context, steps);
  const { chrome, open_tab, focus_page, in_selected_page } = steps;
  const bar_message = () => chrome(`(async () => { const bar = ${W}.document.getElementById("desertfox-statusbar"); return bar?.hasAttribute("data-on") ? bar.querySelector(".dfx-message")?.textContent ?? null : null; })()`);
  const message_matches = async (pattern, what) => {
    let seen = null;
    await poll_until(what, async () => pattern.test((seen = await bar_message()) ?? ""), { timeout_ms: 6000 }).catch((error) => {
      throw new Error(`${error.message}: the bar says ${JSON.stringify(seen)}`, { cause: error });
    });
    return seen;
  };
  const close_others = () => chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[0]; for (const tab of [...w.gBrowser.tabs].slice(1)) w.gBrowser.removeTab(tab); })()`);
  const panel_closed = (what) => poll_until(`${what} to close the panel`, async () => (await panel.state()).state === "none", { timeout_ms: 5000 });
  // A word of the tab's own text, read in the process that holds it.
  const word_of_page = async () => (await in_selected_page(`(win) => /[A-Za-z]{6,}/.exec(win.document.body.innerText)?.[0] ?? null`)) ?? "";
  // The text the Finder selected, in the page's own process.
  const selected = () => in_selected_page(`(win) => String(win.getSelection())`);
  async function find_with(open_key, text) {
    await press_keys(open_key);
    await panel.wait_open(open_key);
    await press_keys(text);
    await panel.line_holds(text);
    await press_keys("-k", "Return");
    await panel_closed("Enter");
  }

  await setup("turn the module on with the bar", async () => {
    await steps.turn_on_module();
    on_teardown(() => run_line(":unset browser_bar"));
    await run_line(":set browser_bar true");
    await poll_until("the status bar", async () => (await chrome(`(async () => ${W}.document.getElementById("desertfox-statusbar")?.hasAttribute("data-on") === true)()`)) === true, { timeout_ms: 8000 });
  });

  await run_case("on about:preferences / opens a find line, Enter selects the match and the bar shows its place, n and N step", async () => {
    await open_tab("about:preferences");
    await focus_page();
    const word = await word_of_page();
    expect(word.length > 0, "about:preferences has no word to search");
    await press_keys("/");
    await panel.wait_open("/");
    expect((await panel.in_panel(`(win) => win.document.querySelector(".desertfox-cmdline-prompt")?.textContent ?? null`))?.trim() === "/", "the line is not a find line");
    await press_keys(word);
    await panel.line_holds(word);
    await press_keys("-k", "Return");
    await panel_closed("Enter");
    const first = await message_matches(COUNT, "the match place");
    expect((await selected()).toLowerCase() === word.toLowerCase(), `the Finder selected ${JSON.stringify(await selected())}, not ${word}`);
    const [first_at, total] = COUNT.exec(first).slice(1).map(Number);
    expect(total >= 1, "no match counted");
    await focus_page();
    await press_keys("n");
    const next = await poll_until("n to move the match", async () => ((await bar_message()) ?? "") !== first && COUNT.test((await bar_message()) ?? ""), { timeout_ms: 6000 }).then(bar_message);
    const next_at = Number(COUNT.exec(next)[1]);
    expect(total === 1 || next_at !== first_at, `n stayed on match ${first_at}`);
    await press_keys("N");
    await poll_until("N to go back", async () => Number(COUNT.exec((await bar_message()) ?? "")?.[1]) === first_at, { timeout_ms: 6000 });
    await close_others();
  });

  await run_case("the text is plain: a regular expression finds nothing, and a missing word says so", async () => {
    await open_tab("about:preferences");
    await focus_page();
    await find_with("/", "[a-z]+.*");
    await message_matches(/^No match for "\[a-z\]\+\.\*"$/, "the no-match toast");
    await focus_page();
    await find_with("/", "zzzqqqxx");
    await message_matches(/^No match for "zzzqqqxx"$/, "the no-match toast");
    await close_others();
  });

  await run_case("Escape in the find line searches nothing", async () => {
    await open_tab("about:preferences");
    await focus_page();
    await press_keys("/");
    await panel.wait_open("/");
    await press_keys("setting");
    for (let press = 0; press < 3 && (await panel.state()).state !== "none"; press++) {
      await press_keys("-k", "Escape");
      await sleep(300);
    }
    await panel_closed("Escape");
    await sleep(800);
    expect((await bar_message()) === null || (await bar_message()) === "", `a message showed: ${await bar_message()}`);
    await close_others();
  });

  // No probe key here: the letters go out in the same press as `/`, while the panel is still on its way. `xx` would close the tab, and `n` would step a search.
  await run_case("keys typed right after / wait for the line and land in it", async () => {
    await open_tab("about:preferences");
    await open_tab("about:robots");
    await chrome(`(async () => { const w = ${W}; w.gBrowser.selectedTab = w.gBrowser.tabs[1]; })()`);
    await focus_page();
    const tabs = await chrome(`(async () => ${W}.gBrowser.tabs.length)()`);
    await press_keys("/xxn");
    await poll_until("the panel to open", async () => (await panel.state()).state === "open", { timeout_ms: 8000 });
    await panel.line_holds("xxn");
    expect((await chrome(`(async () => ${W}.gBrowser.tabs.length)()`)) === tabs, "a typed key ran on the page under the line");
    for (let press = 0; press < 3 && (await panel.state()).state !== "none"; press++) {
      await press_keys("-k", "Escape");
      await sleep(300);
    }
    await panel_closed("Escape");
    await close_others();
  });

  await run_case("? searches backward from the start, so the last match comes first", async () => {
    await open_tab("about:preferences");
    await focus_page();
    const word = await word_of_page();
    await find_with("?", word);
    const place = COUNT.exec(await message_matches(COUNT, "the match place")).slice(1).map(Number);
    expect(place[0] === place[1] || place[1] === 1, `? landed on ${place.join("/")}, not the last match`);
    await close_others();
  });

  await run_case("* searches the selected text of about:preferences", async () => {
    await open_tab("about:preferences");
    await focus_page();
    const word = await word_of_page();
    const picked = await in_selected_page(`(win) => { const doc = win.document; const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT); for (let node = walker.nextNode(); node; node = walker.nextNode()) { const at = node.textContent.indexOf(${JSON.stringify(word)}); if (at < 0 || !node.parentElement?.checkVisibility?.()) continue; const range = doc.createRange(); range.setStart(node, at); range.setEnd(node, at + ${word.length}); win.getSelection().removeAllRanges(); win.getSelection().addRange(range); return true; } return false; }`);
    expect(picked === true, "the word could not be selected");
    await press_keys("*");
    await message_matches(COUNT, "the match place after *");
    expect((await selected()).toLowerCase() === word.toLowerCase(), `* left ${JSON.stringify(await selected())} selected`);
    await close_others();
  });

  await run_case("* with nothing selected says so", async () => {
    await open_tab("about:preferences");
    await focus_page();
    await in_selected_page(`(win) => { win.getSelection().removeAllRanges(); return true; }`);
    await press_keys("*");
    await message_matches(/^Select a word first$/, "the refusal");
    await close_others();
  });

  await run_case("on a page of a content process / finds text and * is refused", async () => {
    await open_tab("about:privatebrowsing");
    await focus_page();
    const remote = await chrome(`(async () => ${W}.gBrowser.selectedBrowser.isRemoteBrowser)()`);
    expect(remote === true, "about:privatebrowsing runs in the parent process, so it does not test a content process");
    const word = await word_of_page();
    expect(word.length > 0, "the page has no word to search");
    await find_with("/", word);
    await message_matches(COUNT, "the match place in a content process");
    expect((await selected()).toLowerCase() === word.toLowerCase(), `the Finder selected ${JSON.stringify(await selected())}`);
    await focus_page();
    await press_keys("*");
    await message_matches(/^Only about: pages the browser module can read give a word to search for$/, "the * refusal");
    await close_others();
  });

  await run_case("in a private window / stays with Firefox and n and * are refused with a toast", async () => {
    const private_access = () => chrome(`(async () => WebExtensionPolicy.getByID("${EXTENSION_ID}").privateBrowsingAllowed)()`);
    const set_private_access = (allowed) =>
      chrome(`(async () => {
        const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
        const { extension } = WebExtensionPolicy.getByID("${EXTENSION_ID}");
        const change = { permissions: ["internal:privateBrowsingAllowed"], origins: [] };
        await (${allowed} ? ExtensionPermissions.add("${EXTENSION_ID}", change, extension) : ExtensionPermissions.remove("${EXTENSION_ID}", change, extension));
      })()`);
    const close_private_windows = () => chrome(`(async () => { const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs"); for (const w of [...Services.wm.getEnumerator("navigator:browser")]) if (PrivateBrowsingUtils.isWindowPrivate(w)) w.close(); })()`);
    const access_before = await private_access();
    on_teardown(() => set_private_access(access_before));
    on_teardown(close_private_windows);
    await set_private_access(true);
    await poll_until("DesertFox to gain private window access", async () => (await private_access()) === true);
    await chrome(`(async () => {
      const w = Services.wm.getMostRecentWindow("navigator:browser").OpenBrowserWindow({ private: true });
      await new Promise((resolve) => Services.obs.addObserver(function seen(subject) { if (subject === w) { Services.obs.removeObserver(seen, "browser-delayed-startup-finished"); resolve(); } }, "browser-delayed-startup-finished"));
    })()`);
    await poll_until("the private window to show about:privatebrowsing", async () => (await chrome(`(async () => ${W}.gBrowser.selectedBrowser.currentURI.spec)()`)) === "about:privatebrowsing", { timeout_ms: 10000 });
    await focus_page();
    await clear_notices();
    on_teardown(clear_notices);
    // Firefox's own quick find keeps `/`, so no line opens and no key is held back.
    await press_keys("/");
    await sleep(NO_EFFECT_MS);
    expect((await panel.state()).state === "none", "a find line opened over a private tab");
    expect((await bar_message()) === null || (await bar_message()) === "", "the bar showed a message for /");
    await press_keys("-k", "Escape");
    await focus_page();
    await press_keys("n");
    await message_matches(/^Find is off in private tabs$/, "the refusal");
    await close_private_windows();
  });
}
