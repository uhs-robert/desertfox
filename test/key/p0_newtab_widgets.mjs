// The new tab page widgets: the analog clock and the date.
// It swaps the config and reloads. The reload once hung when this file ran last; that did not reproduce in one filtered run with this file last. Shots go to DESERTFOX_SHOT_DIR when it is set.
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate_in_background } from "./rdp.mjs";

const test_config_dir = join(dirname(fileURLToPath(import.meta.url)), "config");
const NEWTAB_VIEW = `(browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/newtab.html"))`;

export const areas = ["newtab", "config"];

export async function run_cases({ config_dir, load_config_dir, take_shot, run_case, expect, poll_until, open_page, rdp, extension_id }) {
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  const in_background = (script) => evaluate_in_background(rdp, extension_id, script);

  const open_new_tab = async (selector) => {
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("newtab.html") })`);
    return poll_until(`the new tab page to render ${selector}`, () => in_background(`!!${NEWTAB_VIEW}?.document.querySelector(${JSON.stringify(selector)})`).catch(() => false), { timeout_ms: 10000 }).then(() => true, () => false);
  };
  const close_new_tabs = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.endsWith("/newtab.html")) await browser.tabs.remove(tab.id); })()`);
  const parts_of_page = () => in_background(`(() => { const page = ${NEWTAB_VIEW}.document; return { clock: !!page.querySelector("svg.clock"), ticks: page.querySelectorAll("svg.clock line").length, second_hand: page.querySelector("svg.clock .second")?.style.transform ?? "", date: page.querySelector(".date")?.textContent ?? "" }; })()`);

  try {
    await run_case("the new tab page shows the 12 hour clock without ticks, and the date", async () => {
      expect(await open_new_tab("svg.clock"), "the clock never rendered");
      // The hands and the date fill in after the clock element exists.
      await poll_until("the hands and the date to render", async () => { const shown = await parts_of_page(); return shown.ticks === 3 && shown.second_hand !== "" && shown.date !== ""; });
      const parts = await parts_of_page();
      expect(parts.ticks === 3, `expected only the three hands as lines, found ${parts.ticks}`);
      expect(parts.second_hand.startsWith("rotate("), `the seconds hand had no angle: ${parts.second_hand}`);
      expect(parts.date !== "" && !/\d{4}/.test(parts.date), `the date line was ${parts.date}`);
      if (shot_dir) await take_shot(`${shot_dir}/newtab-clock.png`);
    });

    const hidden_config = mkdtempSync(join(tmpdir(), "desertfox-widgets-"));
    cpSync(test_config_dir, hidden_config, { recursive: true });
    writeFileSync(join(hidden_config, "settings.toml"), "newtab_clock = false\n");
    await close_new_tabs();
    // load_config_dir types <Space>r, so a normal page must hold the keys.
    await open_page("page", "widgets_config", { new_tab: true });
    await load_config_dir(hidden_config);

    await run_case("newtab_clock = false hides the clock and keeps the date", async () => {
      expect(await open_new_tab(".date"), "the date never rendered");
      const parts = await parts_of_page();
      expect(!parts.clock, "the clock showed with newtab_clock = false");
    });
  } finally {
    await close_new_tabs().catch(() => undefined);
    await open_page("page", "widgets_restore", { new_tab: true });
    await load_config_dir(config_dir);
  }
}
