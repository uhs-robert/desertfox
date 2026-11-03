import { help_whichkey } from "../content/handlers/lazy_bundle.ts";
import { define } from "../shared/registry/index.ts";

// The page is a file of the extension, so `help.html` needs no web-accessible entry for the background to open it.
const HELP_PAGE = "help.html";

define("help.open", {
  name: "help",
  label: "Help",
  intent: "Open the help page in a new tab. It lists every command, its keys and the config warnings.",
  runs_in: "background",
  run: async () => {
    await browser.tabs.create({ url: browser.runtime.getURL(HELP_PAGE) });
  },
});

define("help.whichkey", {
  label: "Which key",
  intent: "List the keys at the top of the keymap.",
  runs_in: "content",
  modes: ["normal", "caret", "visual"],
  run: help_whichkey.run,
});
