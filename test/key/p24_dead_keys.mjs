// blur_on_load with pages that fight for their field's focus: a held Shift+J and Shift+K over such tabs must leave every DesertFox key working.
// The pages refocus their field on load, on each show, on window focus, in the field's blur handler or in a loop after a blur (`/refocus` in server.mjs).
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate_in_chrome } from "./rdp.mjs";
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["keys", "config", "tabs"];

export async function run_cases(context) {
  const { config_copy, load_config_dir, setup, run_case, open_page, send_keys, press_keys, in_background, in_active_tab, wait_event, tab_switch_mark, tabs_shown_since, poll_until, settle_focus, events, expect, sleep, rdp, close_tabs_with } = context;
  const log = (line) => console.log(`[p24_dead_keys] ${line}`);
  const badge_of = (page_id) => events.filter((event) => event.type === "indicator" && event.page_id === page_id).at(-1)?.label;
  const page_id_now = () => in_background(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => new URL(tab.url).searchParams.get("id"))`);
  const tab_order = () => in_background(`browser.tabs.query({ currentWindow: true }).then((tabs) => tabs.map((tab) => URL.canParse(tab.url) ? new URL(tab.url).searchParams.get("id") : tab.url))`);
  const tab_id_of = (page_id) => in_background(`browser.tabs.query({}).then((tabs) => tabs.find((tab) => URL.canParse(tab.url) && new URL(tab.url).searchParams.get("id") === ${JSON.stringify(page_id)})?.id)`);
  const chrome_focus = () =>
    evaluate_in_chrome(rdp, `(() => { const fm = Services.focus; const w = Services.wm.getMostRecentWindow("navigator:browser"); const el = fm.focusedElement; return { focused_window_is_browser: fm.focusedWindow === w, focused: el ? el.localName + "#" + (el.id || "") : null, active: fm.activeWindow === w }; })()`).catch((error) => `error ${error.message}`);
  const page_state = async () =>
    in_active_tab(`JSON.stringify({ id: new URLSearchParams(location.search).get("id"), focus: document.activeElement?.id || document.activeElement?.localName, has_focus: document.hasFocus(), refocus_count: window.wrappedJSObject?.refocus_count, typed: [...document.querySelectorAll("input")].map((f) => f.value).join(""), mode: document.documentElement.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null })`).catch((error) => `error ${error.message}`);
  const typed_anywhere = () => in_background(`(async () => { let text = ""; for (const tab of await browser.tabs.query({ currentWindow: true })) text += (await browser.tabs.executeScript(tab.id, { code: '[...document.querySelectorAll("input")].map((field) => field.value).join("")' }).catch(() => [""]))[0]; return text; })()`);

  // Whether DesertFox still takes keys in the active tab: j scrolls it, or a J switches away from it. Each try is logged.
  const keys_work = async () => {
    const page_id = await page_id_now();
    for (let attempt = 0; attempt < 3; attempt++) {
      const mark = events.length;
      await press_keys("j");
      if (await wait_event(mark, (event) => event.type === "scroll" && event.page_id === page_id, "a scroll from j", 700).then(() => true, () => false)) return true;
    }
    const switch_mark = await tab_switch_mark();
    await press_keys("J");
    await sleep(600);
    return (await tabs_shown_since(switch_mark)).length > 0;
  };
  const hold = async (key, ms) => {
    const switch_mark = await tab_switch_mark();
    await send_keys("-M", "shift", "-P", key, "-s", String(ms), "-p", key, "-m", "shift");
    await sleep(400);
    return tabs_shown_since(switch_mark);
  };
  const hold_rounds = async (rounds) => {
    for (let round = 0; round < rounds; round++) {
      const forward = await hold("j", 2000);
      log(`round ${round} J switched ${forward.length}: ${forward.join(",")}`);
      const back = await hold("k", 2000);
      log(`round ${round} K switched ${back.length}: ${back.join(",")}`);
    }
  };
  // Every tab in turn by the tab bar (the background), so a dead tab is found without DesertFox's own keys.
  const dead_tabs = async (prefix) => {
    const dead = [];
    for (const page_id of (await tab_order()).filter((id) => id?.startsWith(prefix))) {
      await in_background(`browser.tabs.update(${await tab_id_of(page_id)}, { active: true }).then(() => true)`);
      await poll_until(`tab ${page_id} active`, async () => (await page_id_now()) === page_id);
      await sleep(1100);
      const before = await page_state();
      const works = await keys_work();
      log(`${page_id}: ${works ? "alive" : "DEAD"} badge ${badge_of(page_id)} before ${before} after ${await page_state()} chrome ${JSON.stringify(await chrome_focus())}`);
      if (!works) dead.push(page_id);
    }
    return dead;
  };
  const open_row = async (prefix, kinds) => {
    for (const [kind, id] of kinds) await open_page(kind, `${prefix}${id}`, { new_tab: true });
  };
  const ROW = [
    ["page", "a"],
    ["refocus", "auto_vis"],
    ["refocus", "login_auto"],
    ["refocus", "auto_blur"],
    ["refocus", "auto_blurt"],
    ["refocus", "auto_loop"],
    ["refocus", "login_auto_vis_blurt"],
    ["page", "z"],
  ];

  await setup("load a config with a blur_on_load row for the dk pages", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), '\n[[site_rules]]\nsite = "*://127.0.0.1/*?id=dk*"\nblur_on_load = true\n');
    await load_config_dir(dir);
  });

  const row_cases = async (prefix, what, { discard = false } = {}) => {
    await setup(`open the ${prefix} row`, async () => {
      await open_row(prefix, ROW);
      if (discard) {
        await in_background(`browser.tabs.update(${await tab_id_of(`${prefix}a`)}, { active: true }).then(() => true)`);
        await settle_focus();
        for (const [, id] of ROW.slice(1)) await in_background(`browser.tabs.discard(${await tab_id_of(`${prefix}${id}`)})`);
      }
      await settle_focus().catch((error) => log(`settle failed: ${error.message}`));
    });
    let typed = "";
    await run_case(`${what}: held Shift+J and Shift+K switch on and type nothing`, async () => {
      await hold_rounds(2);
      typed = await typed_anywhere();
      expect(typed === "", `held Shift+J/K typed "${typed}"`);
    });
    await run_case(`${what}: DesertFox keys work in every tab after`, async () => {
      const dead = await dead_tabs(prefix);
      expect(dead.length === 0, `dead keys in [${dead.join(", ")}]`);
    });
    await setup(`close the ${prefix} row`, async () => {
      await close_tabs_with(prefix);
      await settle_focus().catch(() => {});
    });
  };

  // A page that refocuses its field a tick after each blur and on each show and window focus, as a chat page does: what holds the keys, and what brings them back.
  const msg_count_start = () => in_background(`(() => { globalThis.dk_counts = {}; if (!globalThis.dk_listening) { globalThis.dk_listening = true; browser.runtime.onMessage.addListener((message) => { if (globalThis.dk_counts) globalThis.dk_counts[message?.type] = (globalThis.dk_counts[message?.type] ?? 0) + 1; }); } return true; })()`);
  const msg_counts = () => in_background(`JSON.stringify(globalThis.dk_counts)`);
  const ping_ms = async () => { const start = Date.now(); await in_background("1"); return Date.now() - start; };
  const dead_now = async () => JSON.parse(await page_state());
  const make_dead = async () => {
    await in_background(`browser.tabs.update(${await tab_id_of("dkr_next")}, { active: true }).then(() => true)`);
    await poll_until("dkr_next active", async () => (await page_id_now()) === "dkr_next");
    await sleep(300);
    await press_keys("K");
    await poll_until("dkr back", async () => (await page_id_now()) === "dkr_login_auto_vis_blurt");
    await msg_count_start();
    await sleep(1500);
    const state = await dead_now();
    log(`dead state: ${JSON.stringify(state)} messages in 1.5 s ${await msg_counts()} background ping ${await ping_ms()} ms`);
    return state.focus === "field";
  };
  const click_page = () => evaluate_in_chrome(rdp, `(async () => {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    const browser = win.gBrowser.selectedBrowser;
    const box = browser.getBoundingClientRect();
    const at = [(win.mozInnerScreenX + box.left + 400) * win.devicePixelRatio, (win.mozInnerScreenY + box.top + 300) * win.devicePixelRatio];
    for (const message of [win.windowUtils.NATIVE_MOUSE_MESSAGE_MOVE, win.windowUtils.NATIVE_MOUSE_MESSAGE_BUTTON_DOWN, win.windowUtils.NATIVE_MOUSE_MESSAGE_BUTTON_UP]) {
      win.windowUtils.sendNativeMouseEvent(at[0], at[1], message, 0, 0, browser, null);
      await new Promise((resolve) => win.setTimeout(resolve, 20));
    }
  })()`);
  const revive_with = async (what, act) => {
    const dead = await make_dead();
    await act();
    const soon = await keys_work_quick();
    await sleep(1500);
    const later = await keys_work_quick();
    log(`revive ${what}: dead before ${dead}, keys right after ${soon}, keys 1.5 s later ${later}, state ${await page_state()}`);
  };
  const keys_work_quick = async () => {
    const page_id = await page_id_now();
    const mark = events.length;
    await press_keys("j");
    const scrolled = await wait_event(mark, (event) => event.type === "scroll" && event.page_id === page_id, "a scroll from j", 600).then(() => true, () => false);
    await in_active_tab(`for (const f of document.querySelectorAll("input")) f.value = ""; true`).catch(() => {});
    return scrolled;
  };
  await setup("open the revive pages", async () => {
    await open_page("refocus", "dkr_login_auto_vis_blurt", { new_tab: true });
    await open_page("page", "dkr_next", { new_tab: true });
  });
  await run_case("revive: Escape", () => revive_with("Escape", () => press_keys("-k", "Escape")));
  await run_case("revive: click in the page", () => revive_with("click", click_page));
  await run_case("revive: switch away and back from chrome", () => revive_with("switch away and back", async () => {
    await evaluate_in_chrome(rdp, `(async () => { const g = Services.wm.getMostRecentWindow("navigator:browser").gBrowser; const here = g.selectedTab; g.selectedTab = here.nextElementSibling ?? g.tabs[0]; await new Promise((r) => setTimeout(r, 300)); g.selectedTab = here; })()`);
    await sleep(200);
  }));
  await run_case("revive: reload", () => revive_with("reload", async () => {
    const mark = events.length;
    await in_background(`browser.tabs.reload(${await tab_id_of("dkr_login_auto_vis_blurt")}).then(() => true)`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "dkr_login_auto_vis_blurt", "reloaded", 6000);
    await sleep(200);
  }));
  await setup("close the revive pages", () => close_tabs_with("dkr_"));

  await row_cases("dk1_", "refocusing pages");
  await row_cases("dk2_", "discarded refocusing pages", { discard: true });

  const { turn_on_module } = module_steps(context);
  await setup("turn on the browser module", turn_on_module);
  await row_cases("dk3_", "module on, refocusing pages");
  await row_cases("dk4_", "module on, discarded refocusing pages", { discard: true });
}
