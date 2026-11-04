import { help_whichkey } from "../content/handlers/lazy_bundle.ts";
import { HELP_PAGE_FILE } from "../help/route.ts";
import { define } from "../shared/registry/index.ts";

define("help.open", {
  name: "help",
  label: "Help",
  intent: "Open the help page in a new tab. It lists every command, its keys and the config warnings.",
  runs_in: "background",
  repeatable: false,
  run: async () => {
    await browser.tabs.create({ url: browser.runtime.getURL(HELP_PAGE_FILE) });
  },
});

define("help.whichkey", {
  label: "Which key",
  intent: "List the keys at the top of the keymap.",
  runs_in: "content",
  modes: ["normal", "caret", "visual"],
  run: help_whichkey.run,
});
