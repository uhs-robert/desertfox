// blur_on_load with pages that fight for their field's focus: a held Shift+J and Shift+K over such tabs must leave every DesertFox key working.
// The pages refocus their field on load, on each show, on window focus or in the field's blur handler (`/refocus` in server.mjs).
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate_in_chrome } from "./rdp.mjs";
import { module_steps } from "./browser_module_steps.mjs";

export const areas = ["keys", "config", "tabs"];

export async function run_cases(context) {
  const { config_copy, load_config_dir, setup, run_case, on_teardown, open_page, send_keys, press_keys, in_background, in_active_tab, wait_event, tab_switch_mark, tabs_shown_since, poll_until, settle_focus, events, expect, sleep, rdp, close_tabs_with } = context;
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
  // Pages that focus their field on load, on each show and on window focus, but never fight a blur.
  const ROW = [
    ["page", "a"],
    ["refocus", "auto"],
    ["refocus", "login_auto"],
    ["refocus", "auto_vis"],
    ["refocus", "login_auto_vis"],
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
        await poll_until("the row to be discarded", () => in_background(`browser.tabs.query({ discarded: true }).then((tabs) => tabs.length === ${ROW.length - 1})`));
      }
      await settle_focus().catch((error) => log(`settle failed: ${error.message}`));
    });
    await run_case(`${what}: held Shift+J and Shift+K keep switching and type nothing`, async () => {
      const order = await tab_order();
      const forward = await hold("j", 1500);
      log(`J switched ${forward.length}: ${forward.join(",")}`);
      const back = await hold("k", 1500);
      log(`K switched ${back.length}: ${back.join(",")}`);
      const typed = await typed_anywhere();
      expect(typed === "", `held Shift+J/K typed "${typed}"`);
      expect(forward.length >= order.length && back.length >= order.length, `held Shift+J/K stopped: J ${forward.length}, K ${back.length} switches over ${order.length} tabs`);
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

  // A page that refocuses its field after every blur, in its blur handler or a tick later: a few blurs, then the page keeps the field and the frame is in insert mode, as with the setting off.
  for (const id of ["dkf_auto_vis_blurt", "dkf_auto_vis_blur", "dkf_ce_auto_vis_blurt_heavy"]) {
    await run_case(`a page that refocuses after each blur (${id}) gets a few blurs per show, then keeps its field`, async () => {
      on_teardown(() => close_tabs_with(id));
      await open_page("refocus", id, { new_tab: true });
      await open_page("page", `${id}_next`, { new_tab: true });
      const before = await in_background(`browser.tabs.executeScript(${await tab_id_of(id)}, { code: "window.wrappedJSObject.refocus_count" }).then((answers) => answers[0])`);
      await press_keys("K");
      await poll_until(`${id} active`, async () => (await page_id_now()) === id);
      await sleep(1300);
      const state = JSON.parse(await page_state());
      log(`${id}: ${JSON.stringify(state)}, focus calls before the show ${before}`);
      // The show focus and the window focus each refocus once, and each of the few blurs of the window gives one more.
      expect(state.refocus_count - before <= 8, `the page refocused ${state.refocus_count - before} times in one show: a blur and refocus loop`);
      expect(state.focus === "field" && badge_of(id) === "INSERT", `the page did not keep its field: ${JSON.stringify(state)}, badge ${badge_of(id)}`);
      await close_tabs_with(id);
      await settle_focus().catch(() => {});
    });
  }

  await row_cases("dk1_", "refocusing pages");
  await row_cases("dk2_", "discarded refocusing pages", { discard: true });

  const { turn_on_module } = module_steps(context);
  await setup("turn on the browser module", turn_on_module);
  await row_cases("dk4_", "module on, discarded refocusing pages", { discard: true });
}
