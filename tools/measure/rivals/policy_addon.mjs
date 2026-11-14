// A system policy (/etc/firefox/policies) can force-install the release DesertFox into every profile. It would bias every run.mjs row and sit beside the rival in a compare window.
// `run_in_chrome(block)` runs a `{ ... return value; }` block in Firefox's parent process, with chrome privileges, and gives back its value.
import { DESERTFOX_ID } from "./tools.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const policy_addon_state = (run_in_chrome) => run_in_chrome(`{ const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs"); const addon = await AddonManager.getAddonByID("${DESERTFOX_ID}"); if (addon && !addon.temporarilyInstalled) { await addon.uninstall(); return "removed"; } return addon ? "temporary" : "absent"; }`);

export async function remove_policy_addon(run_in_chrome) {
  // The policy installs after startup, so "absent" counts only after a wait that covers a late install.
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = await policy_addon_state(run_in_chrome);
    if (state === "removed" || (state === "absent" && attempt >= 12)) return state;
    await sleep(500);
  }
  throw new Error("the policy-installed DesertFox is still present: the run would be biased");
}
