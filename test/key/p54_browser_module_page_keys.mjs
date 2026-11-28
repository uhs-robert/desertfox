// The page keys of the browser module (browser_module/desertfox-page-keys.js) on pages with no DesertFox page code: a host of Firefox's restricted list (a localhost name, offline) and about:preferences in the parent process.
// ]h [h ]H [H } { move between headings and blocks, zt zz zb align the heading a jump reached, ]i [i ]l [l walk controls and links, gi and ,b focus and blur, and sh lists the headings in the command line and scrolls to the pick.
// The page's own listener records each key it sees, so a key the module took shows nothing there.
import { createServer } from "node:http";
import { module_steps, panel_steps } from "./browser_module_steps.mjs";

export const areas = ["keys", "tabs", "cmdline"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const HOST = "pagekeys.desertfox.test";
const RESTRICTED_PREF = "extensions.webextensions.restrictedDomains";
const TEST_PREFS = [RESTRICTED_PREF, "network.dns.localDomains", "dom.security.https_first"];
const STATE_KEY = "desertfox_browser_module_state";

// Known stops far apart, so a jump is a clear scroll: a nav with a link and a paragraph that the block walk skips, then headings with a long gap between them.
const keys_page = `<!doctype html><html><head><meta charset="utf-8"><title>Page keys</title><style>body { margin: 0 } .gap { height: 900px }</style></head><body>
<nav><a id="nav_link" href="https://example.org/nav">Navigation link</a><p id="nav_text">This paragraph of the navigation is long enough to count, but sits in a nav.</p></nav>
<h1 id="h1">Top of the page</h1>
<button id="b0">First button</button>
<input id="f1" type="text" placeholder="first field">
<p id="p1">A paragraph of running text that is long enough for the block walk to stop at it.</p>
<div class="gap"></div>
<h2 id="h2">Second heading</h2>
<a id="l1" href="https://example.org/one">One</a> <a id="l2" href="https://example.org/two">Two</a>
<div class="gap"></div>
<h2 id="h3">Third heading</h2>
<textarea id="f2"></textarea>
<div class="gap"></div>
<div class="gap"></div>
</body></html>`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, on_teardown } = context;
  const steps = module_steps(context);
  const panel = panel_steps(context, steps);
  const { chrome, open_tab, focus_page, in_selected_page, close_selected_tab, home, session_value } = steps;

  const server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(keys_page));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  on_teardown(() => new Promise((resolve) => server.close(resolve)));
  const page_url = `http://${HOST}:${server.address().port}/keys`;

  await setup("turn the module on and restrict the test host", async () => {
    const saved = await chrome(`(async () => Object.fromEntries(${JSON.stringify(TEST_PREFS)}.map((name) => [name, Services.prefs.prefHasUserValue(name) ? Services.prefs.getPrefType(name) === Services.prefs.PREF_BOOL ? Services.prefs.getBoolPref(name) : Services.prefs.getStringPref(name) : null])))()`);
    on_teardown(() =>
      chrome(`(async () => {
        for (const [name, value] of Object.entries(${JSON.stringify(saved)})) {
          if (value === null) Services.prefs.clearUserPref(name);
          else if (typeof value === "boolean") Services.prefs.setBoolPref(name, value);
          else Services.prefs.setStringPref(name, value);
        }
      })()`),
    );
    await chrome(`(async () => {
      Services.prefs.setStringPref("network.dns.localDomains", "${HOST}");
      Services.prefs.setStringPref("${RESTRICTED_PREF}", Services.prefs.getStringPref("${RESTRICTED_PREF}", "") + ",${HOST}");
      Services.prefs.setBoolPref("dom.security.https_first", false);
    })()`);
    await steps.turn_on_module();
    await poll_until("the tree to hold the page keys", async () => {
      const state = await session_value(STATE_KEY);
      return state?.tree?.children?.["]"]?.children?.h?.native === "page.heading" && state.insert_keys?.some((row) => row.id === "register.paste");
    }, { timeout_ms: 8000 });
  });

  const element_top = (id) => in_selected_page(`(win) => Math.round(win.document.getElementById(${JSON.stringify(id)}).getBoundingClientRect().top)`);
  const active_id = () => in_selected_page(`(win) => win.document.activeElement?.id ?? ""`);
  const near_top = async (id, what) => {
    await poll_until(`${what}: #${id} at the top of the view`, async () => Math.abs(await element_top(id)) <= 2, { timeout_ms: 4000 });
  };
  // The page's own listener, so a key that reached it shows.
  const watch_page_keys = () => in_selected_page(`(win) => { win.document.documentElement.dataset.seen = ""; win.addEventListener("keydown", (event) => { win.document.documentElement.dataset.seen += event.key; }, true); return true; }`);
  // The modifier keys themselves reach the page, so a typed capital shows "Shift".
  const seen_keys = async () => (await in_selected_page(`(win) => win.document.documentElement.dataset.seen`)).replaceAll("Shift", "");

  await run_case("on a restricted host ]h [h ]H [H move between headings, and the page sees none of the keys", async () => {
    try {
      await open_tab(page_url, { loaded: (spec) => spec.includes(HOST) });
      await focus_page();
      await sleep(500);
      await watch_page_keys();
      await press_keys("]", "h");
      await near_top("h1", "]h from the top, under the navigation");
      await press_keys("]", "h");
      await near_top("h2", "]h again");
      await press_keys("]", "h");
      await near_top("h3", "]h a third time");
      await press_keys("[", "h");
      await near_top("h2", "[h");
      await press_keys("]", "H");
      await near_top("h3", "]H");
      await press_keys("[", "H");
      await near_top("h1", "[H");
      await press_keys("2", "]", "h");
      await near_top("h3", "2]h skips one heading");
      expect((await seen_keys()) === "", `the page saw ${JSON.stringify(await seen_keys())}`);
    } finally {
      await close_selected_tab();
    }
  });

  await run_case("} and { stop at paragraphs and headings and skip the navigation", async () => {
    try {
      await open_tab(page_url, { loaded: (spec) => spec.includes(HOST) });
      await focus_page();
      await sleep(500);
      await press_keys("}");
      await poll_until("} to reach the paragraph or the heading after the navigation", async () => {
        const [paragraph, heading] = [await element_top("p1"), await element_top("h1")];
        return Math.abs(paragraph) <= 2 || Math.abs(heading) <= 2;
      }, { timeout_ms: 4000 });
      await press_keys("}", "}");
      await near_top("h2", "}} past the paragraph");
      await press_keys("{");
      await near_top("p1", "{ back to the paragraph");
    } finally {
      await close_selected_tab();
    }
  });

  await run_case("zt, zz and zb align the heading a jump reached", async () => {
    try {
      await open_tab(page_url, { loaded: (spec) => spec.includes(HOST) });
      await focus_page();
      await sleep(500);
      await press_keys("]", "h");
      await near_top("h1", "]h");
      await press_keys("]", "h");
      await near_top("h2", "]h again");
      await press_keys("z", "z");
      await poll_until("zz to center the heading", async () => {
        const [top, height] = [await element_top("h2"), await in_selected_page(`(win) => win.innerHeight`)];
        return Math.abs(top - height / 2) <= 30;
      }, { timeout_ms: 4000 });
      await press_keys("z", "b");
      await poll_until("zb to put the heading at the bottom", async () => {
        const [top, height] = [await element_top("h2"), await in_selected_page(`(win) => win.innerHeight`)];
        return top > height - 60 && top <= height;
      }, { timeout_ms: 4000 });
      await press_keys("z", "t");
      await near_top("h2", "zt");
    } finally {
      await close_selected_tab();
    }
  });

  await run_case("]i walks the controls and a text field takes the typing, [i goes back, ]l and [l walk the links, and ,b drops the focus", async () => {
    try {
      await open_tab(page_url, { loaded: (spec) => spec.includes(HOST) });
      await focus_page();
      await sleep(500);
      await press_keys("]", "i");
      await poll_until("]i to focus the first control", async () => (await active_id()) === "b0", { timeout_ms: 4000 });
      await press_keys(",", "b");
      await poll_until(",b to drop the focus", async () => (await active_id()) === "", { timeout_ms: 4000 });
      await press_keys("]", "i");
      await poll_until("]i to go on from the button the focus left", async () => (await active_id()) === "f1", { timeout_ms: 4000 });
      await press_keys("a", "b");
      await poll_until("the text field to take the typing", async () => (await in_selected_page(`(win) => win.document.getElementById("f1").value`)) === "ab", { timeout_ms: 4000 });
      await press_keys("-k", "Escape");
      await poll_until("Escape to blur the field", async () => (await active_id()) === "", { timeout_ms: 4000 });
      await press_keys("[", "i");
      await poll_until("[i to go back to the button", async () => (await active_id()) === "b0", { timeout_ms: 4000 });
      await press_keys("-k", "Escape");
      await press_keys("]", "l");
      await poll_until("]l to focus the first link, the one in the navigation", async () => (await active_id()) === "nav_link", { timeout_ms: 4000 });
      await press_keys("2", "]", "l");
      await poll_until("2]l to focus the second link after it", async () => (await active_id()) === "l2", { timeout_ms: 4000 });
      await press_keys("[", "l");
      await poll_until("[l to go back to the first", async () => (await active_id()) === "l1", { timeout_ms: 4000 });
    } finally {
      await close_selected_tab();
    }
  });

  await run_case("gi focuses the first text field, and a key typed there reaches it", async () => {
    try {
      await open_tab(page_url, { loaded: (spec) => spec.includes(HOST) });
      await focus_page();
      await sleep(500);
      await press_keys("g", "i");
      await poll_until("gi to focus the first text field", async () => (await active_id()) === "f1", { timeout_ms: 4000 });
      await press_keys("x");
      await poll_until("the field to take x", async () => (await in_selected_page(`(win) => win.document.getElementById("f1").value`)) === "x", { timeout_ms: 4000 });
    } finally {
      await close_selected_tab();
    }
  });

  await run_case("sh lists the headings of a restricted host in the command line, and a typed pick scrolls to it", async () => {
    try {
      await home("bmpk_home");
      await open_tab(page_url, { loaded: (spec) => spec.includes(HOST) });
      await focus_page();
      await sleep(500);
      await press_keys("s", "h");
      await panel.wait_open("sh");
      await poll_until("the line to start with heading", async () => (await panel.line_text())?.startsWith("heading ") === true);
      await poll_until("the list to hold the page's headings", async () => {
        const rows = await panel.in_panel(`(win) => [...win.document.querySelectorAll("#list *")].map((node) => node.textContent).join("|")`);
        return typeof rows === "string" && rows.includes("Second heading") && rows.includes("Third heading") && rows.includes("Top of the page");
      }, { timeout_ms: 8000 });
      await press_keys("T", "h", "i", "r", "d");
      await poll_until("the line to hold the typed word", async () => (await panel.line_text()) === "heading Third");
      await press_keys("-k", "Return");
      await poll_until("the panel to close", async () => (await panel.state()).state === "none", { timeout_ms: 5000 });
      await near_top("h3", "the pick");
    } finally {
      await close_selected_tab();
    }
  });

  await run_case("on about:preferences ]i focuses a control of the page", async () => {
    try {
      await home("bmpk_prefs");
      await open_tab("about:preferences");
      await poll_until("about:preferences to draw", async () => (await in_selected_page(`(win) => win.document.readyState === "complete" && (win.document.body?.textContent?.length ?? 0) > 20`)) === true, { timeout_ms: 8000 });
      await focus_page();
      await press_keys("]", "i");
      await poll_until("]i to focus a control of about:preferences", async () => (await in_selected_page(`(win) => !!win.document.activeElement && win.document.activeElement !== win.document.body`)) === true, { timeout_ms: 5000 });
    } finally {
      await close_selected_tab();
    }
  });
}
