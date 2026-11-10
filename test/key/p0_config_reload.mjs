// config.reload and debug.restart on open tabs. The reduced keymap lives in a config copy, and the harness links the base config back and unsets the temp edit when the piece ends.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["config", "keys"];

export async function run_cases({ config_copy, load_config_dir, run_case, setup, expect, open_page, press_keys, settle_focus, poll_until, wait_cmdline, events, wait_event, scroll_delta_by_press, scroll_of, in_background, read_local, wait_reinject_report, expect_exactly_one_visible, record, run_line, wait_active_tab, tab_switch_mark }) {
  let single_j_pixels = 0;
  // Tabs a and b with a active. j on a page moves one fixed distance, which every case below compares against.
  await setup("open pages a and b and measure one j", async () => {
    await open_page("page", "reload_a", { new_tab: false });
    await open_page("page", "reload_b", { new_tab: true });
    await press_keys("K");
    await wait_active_tab("reload_a", "tab a after K");
    await settle_focus();
    single_j_pixels = await scroll_delta_by_press("reload_a", ["j"]);
    expect(single_j_pixels > 0, "j did not scroll down");
    await scroll_delta_by_press("reload_a", ["gg"]);
  });

  await run_case("config.reload applies the files in place, keeps a temp edit and keeps keys working in open tabs", async () => {
    // The reduced keymap goes into a copy, so config_dir stays the base. The cleanup after the piece links it back.
    const reduced_config = config_copy();
    writeFileSync(join(reduced_config, "keymap.toml"), [
      "[normal]",
      'm = "scroll.to 50"',
      'go = ":open"',
      "[browser]",
      '"<A-,>" = "browser.focus_page"',
      '"<A-.>" = "cmdline.open"',
      "",
    ].join("\n"));
    await run_line(":set -t which_key_delay_ms 777");
    const temp_edit = () => in_background(`(async () => (await browser.storage.session.get("desertfox_temp_settings")).desertfox_temp_settings)()`);
    await poll_until("the temp edit to land", async () => (await temp_edit())?.which_key_delay_ms === 777);
    await wait_cmdline((line) => !line.open, "the command line to close");
    await settle_focus();

    await in_background(`browser.storage.local.remove("desertfox_reinject_report")`);
    await load_config_dir(reduced_config);
    expect((await read_local("desertfox_reinject_report")) == null, ",r restarted the extension: a tab repair report was written");
    const status = await read_local("desertfox_config_status");
    expect(status?.source === "files", `the config source is ${status?.source}, expected files`);
    expect(status?.temp?.includes("which_key_delay_ms") && status?.settings?.which_key_delay_ms === 777, `the temp edit did not survive the reload: ${JSON.stringify(status?.temp)} ${status?.settings?.which_key_delay_ms}`);

    const one_j = await scroll_delta_by_press("reload_a", ["j"]);
    expect(one_j === single_j_pixels, `after reload j moved ${one_j}px, before it moved ${single_j_pixels}px (double or missing action)`);
    const mark = events.length;
    await press_keys("m");
    const halfway = await wait_event(mark, scroll_of("reload_a"), "scroll to 50 percent");
    expect(Math.abs(halfway.y - halfway.max_y / 2) <= 2, `m stopped at ${halfway.y} of ${halfway.max_y}`);
    const switch_mark = await tab_switch_mark();
    await press_keys("J");
    await expect_exactly_one_visible(switch_mark, "reload_b");
    const other_tab_delta = await scroll_delta_by_press("reload_b", ["j"]);
    expect(other_tab_delta === single_j_pixels, `in an untouched tab j moved ${other_tab_delta}px, expected ${single_j_pixels}px`);
  }, { setup: true });

  await run_case("debug.restart restarts the extension, keeps keys working in open tabs and keeps the reloaded files", async () => {
    await in_background(`browser.storage.local.remove("desertfox_reinject_report")`);
    await run_line(":debug.restart");
    const report = await wait_reinject_report();
    record("reinject_report", report);
    console.log(`reinject report ${JSON.stringify(report)}`);
    await poll_until("the config source to be the files after the restart", async () => (await read_local("desertfox_config_status"))?.source === "files", { timeout_ms: 8000 });
    await settle_focus();
    const one_j = await scroll_delta_by_press("reload_b", ["j"]);
    expect(one_j === single_j_pixels, `after the restart j moved ${one_j}px, expected ${single_j_pixels}px`);
    const mark = events.length;
    await press_keys("m");
    const halfway = await wait_event(mark, scroll_of("reload_b"), "scroll to 50 percent after the restart");
    expect(Math.abs(halfway.y - halfway.max_y / 2) <= 2, `m stopped at ${halfway.y} of ${halfway.max_y}`);
  }, { setup: true });

  await run_case("keys work on a fresh load after the reload", async () => {
    await open_page("page", "after_reload", { new_tab: true });
    expect((await scroll_delta_by_press("after_reload", ["j"])) === single_j_pixels, "j moved a different distance");
  });
}
