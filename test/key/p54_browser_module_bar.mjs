// The status bar the browser module draws under the page area: it shows the mode, the half-typed keys and the scroll place of a locked page, it takes the corner badge's place, and it leaves with its setting.
// Set DESERTFOX_SHOT_DIR to also save screenshots of the bar.
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["ui", "keys"];

const HELLO_KEY = "desertfox_browser_module_hello";
const W = `Services.wm.getMostRecentWindow("navigator:browser")`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, on_teardown, run_line, take_shot, sleep } = context;
  const steps = module_steps(context);
  const { chrome, session_value, open_tab, focus_page, close_selected_tab, home, in_selected_page } = steps;
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  const shot = async (name) => {
    if (!shot_dir) return;
    await sleep(300);
    await take_shot(`${shot_dir}/bar-${name}.png`);
  };
  // What the bar shows in the newest window, or null while it is hidden or absent.
  const bar_now = () =>
    chrome(`(async () => {
      const bar = ${W}.document.getElementById("desertfox-statusbar");
      if (!bar || !bar.hasAttribute("data-on")) return null;
      const side = (name) => [...bar.querySelector(".dfx-" + name).children].map((node) => node.textContent);
      return { left: side("left"), right: side("right"), height: ${W}.document.documentElement.style.getPropertyValue("--desertfox-statusbar-height") };
    })()`);
  const left_is = (first) => async () => (await bar_now())?.left[0] === first;
  // The corner badge lives in the page. The key-test build marks its host.
  const badge_present = () => in_selected_page(`(win) => !!win.document.querySelector("[data-desertfox-mode]")`);

  await setup("turn the module on", () => steps.turn_on_module());
  on_teardown(() => run_line(":unset browser_bar"));
  await run_line(":set browser_bar true");

  await run_case("the bar says in the hello that it is built, and shows NORMAL on a DesertFox page", async () => {
    await home("bm_bar");
    await poll_until("bar true in the hello", async () => (await session_value(HELLO_KEY))?.bar === true);
    await poll_until("the bar to show NORMAL", left_is("NORMAL"), { timeout_ms: 8000 });
    const bar = await bar_now();
    expect(parseFloat(bar.height) > 0, `the height token is ${bar.height}`);
    expect(bar.right.some((text) => /^\[\d+\/\d+\]$/.test(text)), `the tab place is missing: ${bar.right}`);
    await shot("normal");
  });

  await run_case("the bar follows insert mode and shows a half-typed key, and the corner badge is gone", async () => {
    await focus_page();
    await press_keys("i");
    await poll_until("INSERT in the bar", left_is("INSERT"));
    await shot("insert");
    await press_keys("-k", "Escape");
    await poll_until("NORMAL again", left_is("NORMAL"));
    await press_keys("g");
    await poll_until("the pending g in the bar", async () => (await bar_now())?.left.includes("g"));
    await shot("pending");
    await press_keys("-k", "Escape");
    await poll_until("the pending keys to clear", async () => !(await bar_now())?.left.includes("g"));
    expect(!(await badge_present()), "the corner badge is still on the page while the bar is up");
  });

  await run_case("a locked page shows its scroll place, which moves with j", async () => {
    await open_tab("about:support");
    await focus_page();
    await poll_until("Top in the bar", async () => (await bar_now())?.right.includes("Top"), { timeout_ms: 8000 });
    await press_keys("j");
    await poll_until("a percent in the bar", async () => (await bar_now())?.right.some((text) => /^\d+%$/.test(text)));
    await shot("locked-scroll");
    await close_selected_tab();
  });

  await run_case("turning the setting off removes the bar and brings the corner badge back", async () => {
    await run_line(":set browser_bar false");
    await poll_until("the bar to hide", async () => (await bar_now()) === null);
    expect((await chrome(`(async () => ${W}.document.documentElement.style.getPropertyValue("--desertfox-statusbar-height"))()`)) === "0px", "the height token stays up");
    await poll_until("the corner badge", badge_present, { timeout_ms: 8000 });
    await run_line(":set browser_bar true");
    await poll_until("the bar again", left_is("NORMAL"), { timeout_ms: 8000 });
    await poll_until("the badge to leave", async () => !(await badge_present()));
  });

  await run_case("the bar corner draws one shape for each border setting, with and without TextFox variables", async () => {
    const root_vars = (set) =>
      chrome(`(async () => {
        const root = ${W}.document.documentElement;
        const vars = { "--tf-bg": "#1c1c24", "--tf-border": "#7fa3c9", "--tf-border-width": "2px", "--tf-rounding": "0px" };
        for (const [name, value] of Object.entries(vars)) ${set} ? root.style.setProperty(name, value) : root.style.removeProperty(name);
      })()`);
    on_teardown(() => root_vars(false));
    on_teardown(() => run_line(":unset browser_bar_border"));
    const corner_is = (corner) => async () =>
      (await chrome(`(async () => ${W}.document.getElementById("desertfox-statusbar").getAttribute("data-corner"))()`)) === corner;
    for (const [textfox, label] of [[false, "plain"], [true, "textfox"]]) {
      await root_vars(textfox);
      for (const border of ["chamfer", "square", "round"]) {
        await run_line(`:set browser_bar_border ${border}`);
        await poll_until(`the ${border} corner`, corner_is(border), { timeout_ms: 8000 });
        await shot(`corner-${border}-${label}`);
      }
    }
    await root_vars(false);
  });

  await run_case("the bar in a private window with private access", async () => {
    const EXTENSION_ID = "desertfox@uhs-robert";
    // The grant is the add-on manager's own switch. The restore is registered first, so a failure after the grant still puts it back.
    const set_access = (allowed) =>
      chrome(`(async () => {
        const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
        const { extension } = WebExtensionPolicy.getByID("${EXTENSION_ID}");
        const change = { permissions: ["internal:privateBrowsingAllowed"], origins: [] };
        await (${allowed} ? ExtensionPermissions.add("${EXTENSION_ID}", change, extension) : ExtensionPermissions.remove("${EXTENSION_ID}", change, extension));
      })()`);
    const access_before = await chrome(`(async () => WebExtensionPolicy.getByID("${EXTENSION_ID}").privateBrowsingAllowed)()`);
    on_teardown(() => set_access(access_before));
    await set_access(true);
    on_teardown(() =>
      chrome(`(async () => {
        const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
        for (const w of [...Services.wm.getEnumerator("navigator:browser")]) if (PrivateBrowsingUtils.isWindowPrivate(w)) w.close();
      })()`),
    );
    await chrome(`(async () => {
      const w = ${W}.OpenBrowserWindow({ private: true });
      await new Promise((resolve) => Services.obs.addObserver(function seen(subject) { if (subject === w) { Services.obs.removeObserver(seen, "browser-delayed-startup-finished"); resolve(); } }, "browser-delayed-startup-finished"));
    })()`);
    await poll_until("the private window's bar", left_is("NORMAL"), { timeout_ms: 10000 });
    await shot("private");
  });
}
