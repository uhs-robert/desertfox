import { define } from "../shared/registry/builtin.ts";
import { mark_reload_pending } from "../background/reload.ts";

define("config.reload", {
  label: "Reload config",
  intent: "Reload the extension and its config. It reads the managed config file again.",
  runs_in: "background",
  repeatable: false,
  run: async () => {
    await mark_reload_pending();
    browser.runtime.reload();
  },
});
