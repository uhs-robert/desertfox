// Hints on Firefox's error pages (the error_page row of browser_module/desertfox-content-hints.js), where no content script runs: about:neterror on a port that refuses, and about:certerror on a local self-signed https server.
// f labels the buttons in the window's layer. Try Again and Accept the Risk and Continue wait for the user's own Enter: a pick only marks, and the page changes after Enter alone. The certerror case checks that the server sees no request before that Enter.
import { execFileSync } from "node:child_process";
import { createServer as create_http_server } from "node:http";
import { createServer as create_https_server } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { module_steps, NO_EFFECT_MS } from "./browser_module_steps.mjs";

export const areas = ["hints", "keys"];

const W = `Services.wm.getMostRecentWindow("navigator:browser")`;
// LABELS_SEEN_MS and the grant's dwell of the module, with a margin.
const LABELS_SEEN_MS = 400;
const DWELL_MS = 700;

const label_count = `(async () => [...${W}.document.querySelectorAll(".desertfox-page-hints")].reduce((sum, host) => sum + host.openOrClosedShadowRoot.querySelectorAll(".desertfox-hint").length, 0))()`;
const page_layers = `(async () => ${W}.document.querySelectorAll(".desertfox-page-hints").length)()`;
const confirm_shown = `(async () => [...${W}.document.querySelectorAll(".desertfox-page-hints")].some((host) => host.openOrClosedShadowRoot.querySelector(".desertfox-confirm")))()`;
const inner_window_id = `(async () => ${W}.gBrowser.selectedBrowser.innerWindowID)()`;
// The control of the error card by its id, in the open shadow root of net-error-card.
const in_card = (id) => `(win) => win.document.querySelector("net-error-card")?.shadowRoot?.getElementById(${JSON.stringify(id)})`;

export async function run_cases(context) {
  const { run_case, setup, expect, poll_until, press_keys, sleep, on_teardown } = context;
  const steps = module_steps(context);
  const { chrome, session_value, open_tab, focus_page, close_selected_tab, home, in_selected_page } = steps;
  const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

  const tab_case = (name, body) =>
    run_case(name, async () => {
      try {
        await body();
      } finally {
        await press_keys("-k", "Escape");
        await close_selected_tab();
      }
    });
  async function start_hints() {
    await press_keys("f");
    await poll_until("f: the labels to show", async () => (await chrome(label_count)) > 0, { timeout_ms: 5000 });
    await sleep(LABELS_SEEN_MS);
  }
  // The label over the card's control: its box in the page, placed in the tab's area. Firefox's own numbers on both sides.
  async function label_on(id) {
    const where = await in_selected_page(`(win) => { const rect = (${in_card(id)})(win)?.getBoundingClientRect(); return rect ? { left: rect.left, top: rect.top, dpr: win.devicePixelRatio } : null; }`);
    if (!where) return null;
    return chrome(`(async () => {
      const w = ${W};
      const area = w.gBrowser.selectedBrowser.getBoundingClientRect();
      const scale = ${where.dpr} / w.devicePixelRatio;
      const x = Math.max(area.left, area.left + ${where.left} * scale), y = Math.max(area.top, area.top + ${where.top} * scale);
      let best = null, best_distance = Infinity;
      for (const host of w.document.querySelectorAll(".desertfox-page-hints")) for (const node of host.openOrClosedShadowRoot.querySelectorAll(".desertfox-hint")) {
        const box = node.getBoundingClientRect();
        const distance = Math.abs(box.left - x) + Math.abs(box.top - y);
        if (distance < best_distance) [best, best_distance] = [node.textContent, distance];
      }
      return best_distance <= 12 ? best : null;
    })()`);
  }
  async function pick(id) {
    const label = await label_on(id);
    expect(label !== null, `${id} got no label`);
    await press_keys(...label.split(""));
  }
  // A label drawn while the control still moves marks a place it left, and the pick then refuses it as moved.
  async function still(id) {
    let last = null;
    await poll_until(`${id} to stop moving`, async () => {
      const now = await in_selected_page(`(win) => { const rect = (${in_card(id)})(win)?.getBoundingClientRect(); return rect ? JSON.stringify([rect.left, rect.top, win.scrollY]) : null; }`);
      const same = now !== null && now === last;
      last = now;
      return same;
    }, { timeout_ms: 8000, step_ms: 400 });
  }
  // A pick of a control that waits: the mark shows, the page does not change, then the user's Enter acts.
  async function pick_and_confirm(id, what) {
    // A control below the fold has no label, and a scroll after the labels show would end the session.
    await in_selected_page(`(win) => ((${in_card(id)})(win)?.scrollIntoView({ block: "center", behavior: "instant" }), true)`);
    await still(id);
    await start_hints();
    await pick(id);
    await poll_until(`the Enter mark on ${what}`, () => chrome(confirm_shown), { timeout_ms: 3000 });
    await sleep(NO_EFFECT_MS);
  }
  async function enter() {
    await sleep(DWELL_MS);
    await press_keys("-k", "Return");
    await poll_until("the Enter mark to go", async () => !(await chrome(confirm_shown)), { timeout_ms: 3000 });
  }

  await setup("turn the module on", async () => {
    await steps.turn_on_module();
    await poll_until("the state to say the extension answers page hints", async () => (await session_value("desertfox_browser_module_state"))?.page_hints === true, { timeout_ms: 5000 });
  });

  await tab_case("on about:neterror f labels the card's buttons in the window's layer, and Try Again waits for the user's Enter", async () => {
    await home("eh_neterror");
    const probe = create_http_server();
    const closed_port = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));
    await open_tab(`http://127.0.0.1:${closed_port}/`, { loaded: (spec) => spec.includes(String(closed_port)) });
    await poll_until("the error page", () => in_selected_page(`(win) => win.document.documentURI.startsWith("about:neterror") && !!(${in_card("tryAgainButton")})(win)`));
    expect(await in_selected_page(`(win) => win.document.documentElement.hasAttribute("data-desertfox-tree-read-ms")`) === false, "DesertFox's content script runs on the error page");
    await focus_page();
    await start_hints();
    expect((await chrome(label_count)) >= 1, "f labelled nothing on the error page");
    expect((await in_selected_page(`(win) => win.document.querySelectorAll("[class*=desertfox]").length`)) === 0, "a label went into the page's DOM");
    await press_keys("-k", "Escape");
    await focus_page();
    const before = await chrome(inner_window_id);
    await pick_and_confirm("tryAgainButton", "Try Again");
    expect((await chrome(inner_window_id)) === before, "Try Again acted before Enter");
    await enter();
    await poll_until("Try Again to reload the page", async () => (await chrome(inner_window_id)) !== before, { timeout_ms: 10000 });
  });

  await tab_case("on about:certerror Accept the Risk and Continue waits for the user's Enter, and the server hears nothing until then", async () => {
    await home("eh_certerror");
    const files_dir = mkdtempSync(join(tmpdir(), "desertfox-error-hints-"));
    try {
      const key = join(files_dir, "key.pem");
      const cert = join(files_dir, "cert.pem");
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
      let requests = 0;
      const server = create_https_server({ key: readFileSync(key), cert: readFileSync(cert) }, (_request, response) => {
        requests++;
        response.setHeader("content-type", "text/html; charset=utf-8").end("<!doctype html><title>secret</title>secret");
      });
      const port = await listen(server);
      on_teardown(() => new Promise((resolve) => server.close(resolve)));
      await open_tab(`https://127.0.0.1:${port}/`, { loaded: (spec) => spec.includes(String(port)) });
      await poll_until("the certificate error page", () => in_selected_page(`(win) => win.document.documentURI.startsWith("about:certerror") && !!(${in_card("advanced-button")})(win)`));
      await focus_page();
      // The exception button shows only once Advanced is open, and Advanced waits for Enter too.
      await pick_and_confirm("advanced-button", "Advanced");
      await enter();
      // Firefox shows it disabled for a few seconds, so a user cannot click it by reflex, and hints skip a disabled button.
      await poll_until("the exception button to show and enable", () => in_selected_page(`(win) => { const host = (${in_card("exception-button")})(win); return !!host?.checkVisibility() && host.shadowRoot?.querySelector("button")?.disabled === false; }`), { timeout_ms: 15000 });
      await focus_page();
      await pick_and_confirm("exception-button", "Accept the Risk and Continue");
      expect(requests === 0, "the server heard a request before Enter");
      expect(await in_selected_page(`(win) => win.document.documentURI.startsWith("about:certerror")`), "Accept the Risk acted before Enter");
      await enter();
      await poll_until("the page to load after Enter", async () => (await in_selected_page(`(win) => win.document.title`)) === "secret", { timeout_ms: 10000 });
      expect(requests >= 1, "the server heard no request after Enter");
    } finally {
      rmSync(files_dir, { recursive: true, force: true });
    }
  });
}
