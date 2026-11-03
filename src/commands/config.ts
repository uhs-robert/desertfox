import { define } from "../shared/registry/index.ts";
import { mark_reload_pending } from "../background/reload.ts";

define("config.reload", {
  label: "Reload config",
  intent: "Reload the extension so it reads the managed config file again.",
  name: "reload-config",
  runs_in: "background",
  run: async () => {
    await mark_reload_pending();
    browser.runtime.reload();
  },
});
