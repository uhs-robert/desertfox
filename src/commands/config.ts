import { show_toast_on_tab } from "../background/browser_deps.ts";
import { ConfigRefusal, KEPT_CURRENT } from "../background/config_reload.ts";
import { mark_reload_pending } from "../background/reload.ts";
import { reload_config } from "../background/startup.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";

define("config.reload", {
  label: "Reload config",
  intent: "Read the config files again and apply them in place. The native host reads them. Browser edits and modes stay. On a problem the current config stays.",
  bridge: false,
  advanced: true,
  runs_in: "background",
  repeatable: false,
  run: async (ctx) => {
    let reloaded: Awaited<ReturnType<typeof reload_config>>;
    try {
      reloaded = await reload_config();
    } catch (error) {
      if (error instanceof ConfigRefusal) throw new RuntimeRefusal(error.message);
      // Any other failure: a browser call, the host or the build. A failed swap already put the old config back.
      const reason = error instanceof Error ? error.message : String(error);
      throw new RuntimeRefusal(`${KEPT_CURRENT.reload.replace(/\.$/, "")}: ${reason}. Run config.reload again, and debug.restart if it keeps failing.`);
    }
    const warned = reloaded.warnings === 0 ? "" : `, with ${reloaded.warnings} warning(s) on the Help page`;
    await show_toast_on_tab(ctx, "config", `Config reloaded from ${reloaded.config_dir}${warned}`, reloaded.warnings === 0 ? "success" : "warning");
  },
});

define("debug.restart", {
  label: "Restart extension",
  intent: "Restart the whole extension. Temp edits and modes are lost. For debugging only: config.reload applies config changes without a restart.",
  bridge: false,
  advanced: true,
  runs_in: "background",
  repeatable: false,
  run: async () => {
    await mark_reload_pending();
    browser.runtime.reload();
  },
});
