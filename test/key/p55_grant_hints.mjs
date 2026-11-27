// Hints on the surfaces that grant (browser_module/desertfox-chrome-hints.js): a permission prompt, a login prompt in a tab and the downloads panel.
// A pick of a control that denies, closes or only shows something clicks at once. A pick of a control that grants or opens a file marks it, and only Enter typed by the user then clicks it.
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["hints", "toolbar"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
const SESSION_KEY = "desertfox_chrome_hints";
const GEO_PROMPT = `${W}.document.getElementById("geolocation-notification")`;
const BLOCKED_URL_STATE = "Uncommon";

// Chrome code: each label in the browser window's layers (the window's and one inside an open panel), named by the control in `targets` whose top left corner it sits on.
const labels_on = (targets) => `(async () => {
  const w = ${W};
  const targets = Object.entries(${targets}).filter(([, el]) => el).map(([name, el]) => [name, el.getBoundingClientRect()]);
  const out = [];
  for (const host of w.document.querySelectorAll(".desertfox-chrome-hints")) {
    for (const node of host.openOrClosedShadowRoot.querySelectorAll(".desertfox-hint")) {
      const box = node.getBoundingClientRect();
      let best = "", best_distance = Infinity;
      for (const [name, rect] of targets) {
        const distance = Math.abs(rect.left - box.left) + Math.abs(rect.top - box.top);
        if (distance < best_distance) [best, best_distance] = [name, distance];
      }
      out.push({ text: node.textContent, target: best_distance <= 3 ? best : "", off: best_distance });
    }
  }
  return out;
})()`;
const confirm_shown = `(async () => [...${W}.document.querySelectorAll(".desertfox-chrome-hints")].some((host) => host.openOrClosedShadowRoot.querySelector(".desertfox-confirm")))()`;
const held_by = `(async () => Services.desertfox_browser_module.keys_held_by(${W}) ?? null)()`;
const layer_count = `(async () => ${W}.document.querySelectorAll(".desertfox-chrome-hints").length)()`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, take_shot, url_of } = context;
  const steps = module_steps(context);
  const { chrome, session_value, open_tab, close_selected_tab, home, in_selected_page, focus_page } = steps;
  const label_for = (labels, name) => labels.find((label) => label.target === name)?.text;

  async function expect_ended(what) {
    await poll_until(`${what}: the layers to go`, async () => (await chrome(layer_count)) === 0, { timeout_ms: 3000 });
    await poll_until(`${what}: the hold to go`, async () => (await chrome(held_by)) === null, { timeout_ms: 3000 });
    await poll_until(`${what}: the extension to drop its session`, async () => (await session_value(SESSION_KEY)) === null, { timeout_ms: 3000 });
  }
  async function wait_labels(targets, names, what) {
    let labels = [];
    try {
      await poll_until(`${what}: labels on ${names.join(", ")}`, async () => {
        labels = await chrome(labels_on(targets));
        return names.every((name) => label_for(labels, name) !== undefined);
      }, { timeout_ms: 5000 });
    } finally {
      const focus = await chrome(`(async () => { const w = ${W}; const name = (at) => (at ? at.localName + "#" + at.id : String(at)); return JSON.stringify({ dispatcher: name(w.document.commandDispatcher.focusedElement), active: name(w.document.activeElement), core: name(Services.desertfox_browser_module.focused_element(w)), fm_window: String(Services.focus.focusedWindow?.location?.href), fm_element: name(Services.focus.focusedElement), held: Services.desertfox_browser_module.keys_held_by(w) ?? null, ime: w.windowUtils.IMEStatus }); })()`);
      if (labels.length === 0 || names.some((name) => label_for(labels, name) === undefined)) console.log(`${what}: labels ${JSON.stringify(labels)}, focus ${focus}`);
    }
    console.log(`${what} labels: ${labels.map((label) => `${label.text}=${label.target || "?"}`).join(", ")}`);
    return labels;
  }

  await setup("turn the module on", async () => {
    await steps.turn_on_module();
    await poll_until("the state to list the gB binding", async () => JSON.stringify((await session_value("desertfox_browser_module_state"))?.chrome_hint_keys) === JSON.stringify([["g", "B"]]), { timeout_ms: 5000 });
  });

  // ---- The geolocation prompt.

  const PROMPT_TARGETS = `(() => { const p = ${GEO_PROMPT}; return { allow: p?.button, block: p?.secondaryButton, close: p?.closebutton, learn_more: p?.querySelector(".popup-notification-learnmore-link"), checkbox: p?.checkbox }; })()`;
  const geo_answer = () => in_selected_page(`(win) => win.document.title`);
  async function ask_for_location(id) {
    await home(id);
    await open_tab(url_of("page", id));
    await focus_page();
    // A script of the page's own, so the request comes from the page as a site's would. The timeout runs only once the user allowed.
    await in_selected_page(`(win) => {
      const script = win.document.createElement("script");
      script.textContent = 'document.title = "geo:waiting"; navigator.geolocation.getCurrentPosition(() => (document.title = "geo:allowed"), (error) => (document.title = "geo:" + (error.code === 1 ? "denied" : "allowed")), { timeout: 500 });';
      win.document.body.append(script);
      return true;
    }`);
    await poll_until("the geolocation prompt to show", () => chrome(`(async () => ${W}.PopupNotifications.panel.state === "open" && !!${GEO_PROMPT} && !${GEO_PROMPT}.hidden)()`), { timeout_ms: 5000 });
    // The prompt leaves the focus in the page, whose content script hears gB.
    await focus_page();
  }
  const prompt_case = (name, body) =>
    run_case(name, async () => {
      try {
        await body();
      } finally {
        await chrome(`(async () => { const w = ${W}; w.PopupNotifications.getNotification("geolocation", w.gBrowser.selectedBrowser)?.remove(); })()`);
        await close_selected_tab();
      }
    });

  await prompt_case("on a geolocation prompt gB labels Allow and Block, and a pick of Block denies at once", async () => {
    await ask_for_location("gh_geo_block");
    await press_keys("g", "B");
    const labels = await wait_labels(PROMPT_TARGETS, ["allow", "block"], "the prompt");
    await take_shot("/tmp/desertfox-grant-hints-prompt.png");
    await press_keys(...label_for(labels, "block").split(""));
    await poll_until("the page to be denied", async () => (await geo_answer()) === "geo:denied", { timeout_ms: 5000 });
    expect(!(await chrome(confirm_shown)), "a Block pick waited for Enter");
    await expect_ended("a Block pick");
  });

  await prompt_case("a pick of Allow marks it and grants nothing, and Enter then allows", async () => {
    await ask_for_location("gh_geo_allow");
    await press_keys("g", "B");
    const labels = await wait_labels(PROMPT_TARGETS, ["allow"], "the prompt");
    await press_keys(...label_for(labels, "allow").split(""));
    await poll_until("the confirm mark to show", () => chrome(confirm_shown), { timeout_ms: 3000 });
    await take_shot("/tmp/desertfox-grant-hints-allow-mark.png");
    await sleep(800);
    expect((await geo_answer()) === "geo:waiting", `the pick alone answered the page: ${await geo_answer()}`);
    expect((await chrome(held_by)) === "chrome_hints", "the window's keys are free while Allow waits");
    await press_keys("-k", "Return");
    await poll_until("the page to be allowed", async () => (await geo_answer()) === "geo:allowed", { timeout_ms: 5000 });
    expect(!(await chrome(confirm_shown)), "the mark stayed after Enter");
    await expect_ended("an Allow confirmed");
  });

  await prompt_case("Escape on a marked Allow cancels it: the prompt stays and the page has no answer", async () => {
    await ask_for_location("gh_geo_cancel");
    await press_keys("g", "B");
    const labels = await wait_labels(PROMPT_TARGETS, ["allow"], "the prompt");
    await press_keys(...label_for(labels, "allow").split(""));
    await poll_until("the confirm mark to show", () => chrome(confirm_shown), { timeout_ms: 3000 });
    await press_keys("-k", "Escape");
    await expect_ended("an Allow cancelled");
    await press_keys("-k", "Return");
    await sleep(800);
    expect((await geo_answer()) === "geo:waiting", `Enter after Escape answered the page: ${await geo_answer()}`);
    expect(await chrome(`(async () => ${W}.PopupNotifications.panel.state === "open")()`), "Escape closed the prompt");
  });

  // ---- A login prompt in a tab: its OK sends the login to the site, so it waits for Enter. The key lands in the prompt's own frame.

  // Chrome code: the label in the browser window's layer on the login prompt's OK, placed in the window, and whether the prompt is open.
  const LOGIN_FRAME = `[...${W}.document.querySelectorAll("browser.dialogFrame")].find((frame) => frame.contentDocument?.getElementById("commonDialog")?.getAttribute("windowtype") === "prompt:promptUserAndPass")`;
  const login_ok_label = `(async () => {
    const w = ${W};
    const frame = ${LOGIN_FRAME};
    if (!frame) return null;
    const outer = frame.getBoundingClientRect();
    const ok = frame.contentDocument.getElementById("commonDialog").getButton("accept").getBoundingClientRect();
    const [left, top] = [outer.left + frame.clientLeft + ok.left, outer.top + frame.clientTop + ok.top];
    for (const host of w.document.querySelectorAll(".desertfox-chrome-hints")) {
      for (const node of host.openOrClosedShadowRoot.querySelectorAll(".desertfox-hint")) {
        const box = node.getBoundingClientRect();
        if (Math.abs(box.left - left) + Math.abs(box.top - top) <= 3) return node.textContent;
      }
    }
    return null;
  })()`;
  const login_answer = () => chrome(`(async () => Services.desertfox_key_test_login ?? null)()`);

  await prompt_case("on a login prompt a pick of OK marks it and sends nothing, and Enter typed in the prompt then sends the login", async () => {
    await home("gh_login");
    await open_tab(url_of("page", "gh_login"));
    await chrome(`(async () => {
      const w = ${W};
      Services.desertfox_key_test_login = "waiting";
      Services.prompt.asyncPromptUsernameAndPassword(w.gBrowser.selectedBrowser.browsingContext, Services.prompt.MODAL_TYPE_TAB, "DesertFox", "DesertFox asks", "user", "secret").then((bag) => { Services.desertfox_key_test_login = bag.getProperty("ok") ? "sent" : "cancelled"; });
    })()`);
    await poll_until("the login prompt to open", () => chrome(`(async () => !!${LOGIN_FRAME}?.contentDocument.getElementById("commonDialog").getButton("accept").checkVisibility())()`), { timeout_ms: 5000 });
    await sleep(300);
    // The prompt puts the focus in its user name field, where gB would type, so the focus moves to OK.
    await chrome(`(async () => { ${LOGIN_FRAME}.contentDocument.getElementById("commonDialog").getButton("accept").focus(); })()`);
    await sleep(200);
    await press_keys("g", "B");
    let ok = null;
    await poll_until("a label on OK", async () => (ok = await chrome(login_ok_label)) !== null, { timeout_ms: 5000 });
    await take_shot("/tmp/desertfox-grant-hints-login.png");
    await press_keys(...ok.split(""));
    await poll_until("the confirm mark to show", () => chrome(confirm_shown), { timeout_ms: 3000 });
    await sleep(800);
    expect((await login_answer()) === "waiting", `the pick alone answered the prompt: ${await login_answer()}`);
    await press_keys("-k", "Return");
    await poll_until("the login to be sent", async () => (await login_answer()) === "sent", { timeout_ms: 5000 });
    await expect_ended("an OK confirmed");
  });

  // ---- The downloads panel.

  // Chrome code: a download of a page of the test server, saved to a scratch file and finished, or held back as Firefox's reputation check holds a file back.
  const add_download = (name, { blocked }) => `(async () => {
    const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
    const dir = PathUtils.join(PathUtils.tempDir, "desertfox-grant-hints");
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    const path = PathUtils.join(dir, "${name}.txt");
    const part = path + ".part";
    await IOUtils.writeUTF8(${blocked} ? part : path, "a file");
    const download = await Downloads.createDownload({
      source: { url: ${JSON.stringify(url_of("page", name))} },
      target: ${blocked} ? { path, partFilePath: part } : { path },
      ...(${blocked} ? { hasBlockedData: true, errorObj: { becauseBlockedByReputationCheck: true, reputationCheckVerdict: "${BLOCKED_URL_STATE}" } } : { succeeded: true }),
      startTime: new Date(),
    });
    await download.refresh();
    await (await Downloads.getList(Downloads.ALL)).add(download);
    return true;
  })()`;
  const download_state = (name) => `(async () => {
    const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
    const download = (await (await Downloads.getList(Downloads.ALL)).getAll()).find((each) => each.target.path.endsWith("/${name}.txt"));
    return download ? { succeeded: download.succeeded, blocked: download.hasBlockedData } : null;
  })()`;
  const ROW_TARGETS = (name) => `(() => { const w = ${W}; const row = [...w.document.querySelectorAll("#downloadsListBox > richlistitem")].find((each) => each._shell?.download?.target.path.endsWith("/${name}.txt")); return { row, row_button: row?.querySelector(".downloadButton"), history: w.document.getElementById("downloadsHistory"), unblock: w.document.getElementById("downloadsPanel-blockedSubview-unblockButton"), remove: w.document.getElementById("downloadsPanel-blockedSubview-deleteButton") }; })()`;
  async function open_downloads_panel() {
    await chrome(`(async () => { const w = ${W}; w.focus(); w.DownloadsPanel.showPanel(); })()`);
    await poll_until("the downloads panel to open with the focus in it", () => chrome(`(async () => { const w = ${W}; const panel = w.document.getElementById("downloadsPanel"); let at = w.document.commandDispatcher.focusedElement; return panel.state === "open" && !!at && panel.contains(at); })()`), { timeout_ms: 5000 });
    await sleep(300);
  }
  const downloads_case = (name, body) =>
    run_case(name, async () => {
      try {
        await body();
      } finally {
        await chrome(`(async () => {
          const w = ${W};
          w.DownloadsPanel.hidePanel();
          const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
          const list = await Downloads.getList(Downloads.ALL);
          for (const download of await list.getAll()) { await list.remove(download); await download.finalize(true); }
          await IOUtils.remove(PathUtils.join(PathUtils.tempDir, "desertfox-grant-hints"), { recursive: true, ignoreAbsent: true });
          if (Services.desertfox_key_test_restore_open) Services.desertfox_key_test_restore_open();
        })()`);
      }
    });

  await downloads_case("in the downloads panel gB labels the rows, and a row pick opens its download only after Enter, through Firefox's own click", async () => {
    await home("gh_downloads_open");
    // The open is recorded here, not run: the nested session must not start another application.
    await chrome(`(async () => {
      const { DownloadsCommon } = ChromeUtils.importESModule("moz-src:///browser/components/downloads/DownloadsCommon.sys.mjs");
      const original = DownloadsCommon.openDownload;
      Services.desertfox_key_test_opened = [];
      DownloadsCommon.openDownload = (download) => void Services.desertfox_key_test_opened.push(download.target.path);
      Services.desertfox_key_test_restore_open = () => { DownloadsCommon.openDownload = original; delete Services.desertfox_key_test_restore_open; };
    })()`);
    await chrome(add_download("finished", { blocked: false }));
    await open_downloads_panel();
    await press_keys("g", "B");
    const labels = await wait_labels(ROW_TARGETS("finished"), ["row", "history"], "the downloads panel");
    await take_shot("/tmp/desertfox-grant-hints-downloads.png");
    const opened = () => chrome(`(async () => Services.desertfox_key_test_opened.length)()`);
    await press_keys(...label_for(labels, "row").split(""));
    await poll_until("the confirm mark to show", () => chrome(confirm_shown), { timeout_ms: 3000 });
    await sleep(600);
    expect((await opened()) === 0, "the pick alone opened the download");
    await press_keys("-k", "Return");
    await poll_until("the row's download to open", async () => (await opened()) === 1, { timeout_ms: 5000 });
    expect(!(await chrome(confirm_shown)), "the mark stayed after Enter");
    await expect_ended("a row pick");
  });

  await downloads_case("a held-back download: its row opens the blocked view at once, and Allow download there waits for Enter", async () => {
    await home("gh_downloads_blocked");
    await chrome(add_download("held", { blocked: true }));
    await open_downloads_panel();
    await press_keys("g", "B");
    let labels = await wait_labels(ROW_TARGETS("held"), ["row"], "the downloads panel");
    await press_keys(...label_for(labels, "row").split(""));
    await poll_until("the blocked-download view to show", () => chrome(`(async () => ${W}.document.getElementById("downloadsPanel-blockedSubview").hasAttribute("visible"))()`), { timeout_ms: 5000 });
    await expect_ended("the row pick");
    await sleep(400);
    // The view keeps the focus in the panel, so gB typed there starts.
    await press_keys("g", "B");
    labels = await wait_labels(ROW_TARGETS("held"), ["unblock", "remove"], "the blocked-download view");
    await take_shot("/tmp/desertfox-grant-hints-blocked.png");
    await press_keys(...label_for(labels, "unblock").split(""));
    await poll_until("the confirm mark to show", () => chrome(confirm_shown), { timeout_ms: 3000 });
    await take_shot("/tmp/desertfox-grant-hints-unblock-mark.png");
    await sleep(600);
    expect((await chrome(download_state("held")))?.blocked === true, "the pick alone unblocked the download");
    await press_keys("-k", "Return");
    await poll_until("the download to be unblocked", async () => (await chrome(download_state("held")))?.blocked === false, { timeout_ms: 5000 });
    await expect_ended("an unblock confirmed");
  });
}
