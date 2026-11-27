// An add-on update while tabs are open. Firefox loads the new content script into the open tab itself, and the old script takes no key.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["keys"];

// Runs ahead of the new script's own listener, but after any listener the old script left, so it sees a key only when no old script cancelled it.
const NEW_SCRIPT_PROBE = `window.addEventListener("keydown", () => { const root = document.documentElement; root.dataset.ktNewSaw = String(Number(root.dataset.ktNewSaw || 0) + 1); }, true);\n`;

export async function run_cases({ rdp, extension_id, run_case, setup, on_teardown, expect, open_page, press_keys, settle_focus, poll_until, in_background, in_active_tab, read_local, scroll_delta_by_press, record }) {
  let single_j_pixels = 0;
  await setup("open page upd_a and measure one j", async () => {
    await open_page("page", "upd_a", { new_tab: true });
    await settle_focus();
    single_j_pixels = await scroll_delta_by_press("upd_a", ["j"]);
    expect(single_j_pixels > 0, "j did not scroll down");
  });

  await run_case("after an add-on update, j in a tab opened before it scrolls once", async () => {
    await in_background(`browser.storage.local.remove("desertfox_reinject_report")`);
    const started = await in_background(`String(performance.timeOrigin)`);
    const folder = await evaluate_in_chrome(rdp, `(async () => {
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      return (await AddonManager.getAddonByID("${extension_id}")).getResourceURI().QueryInterface(Ci.nsIFileURL).file.path;
    })()`);
    const content_path = join(folder, "content.js");
    const content_text = readFileSync(content_path, "utf8");
    on_teardown(() => writeFileSync(content_path, content_text));
    writeFileSync(content_path, NEW_SCRIPT_PROBE + content_text);
    await in_active_tab(`delete document.documentElement.dataset.ktNewSaw; document.documentElement.removeAttribute("data-desertfox-tree-read-ms")`);
    // Installing the same folder again is an upgrade, so the new background hears onInstalled with reason update, as after a store update.
    const update = await evaluate_in_chrome(rdp, `(async () => {
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      const addon = await AddonManager.getAddonByID("${extension_id}");
      const folder = addon.getResourceURI().QueryInterface(Ci.nsIFileURL).file;
      await AddonManager.installTemporaryAddon(folder);
      return true;
    })()`);
    expect(update === true, `the update failed: ${JSON.stringify(update)}`);
    await poll_until("the new background to start", async () => {
      const now = await in_background(`String(performance.timeOrigin)`);
      return now != null && now !== started;
    }, { timeout_ms: 10000 });
    await poll_until("the new background to read its config", async () => (await read_local("desertfox_config_status")) != null, { timeout_ms: 10000 });
    record("reinject_report", await read_local("desertfox_reinject_report"));
    await poll_until("the new script to start in the open tab", async () => (await in_active_tab(`document.documentElement.hasAttribute("data-desertfox-tree-read-ms")`)) === true, { timeout_ms: 10000 });
    await settle_focus();
    // The focus check presses a key of its own.
    await in_active_tab(`delete document.documentElement.dataset.ktNewSaw`);
    const one_j = await scroll_delta_by_press("upd_a", ["j"]);
    expect(one_j === single_j_pixels, `after the update j moved ${one_j}px, before it moved ${single_j_pixels}px`);
    const new_saw = await in_active_tab(`document.documentElement.dataset.ktNewSaw ?? "0"`);
    expect(new_saw === "1", `the new script's window saw ${new_saw} keydowns of j, expected 1 (an old listener took it)`);
  });
}
