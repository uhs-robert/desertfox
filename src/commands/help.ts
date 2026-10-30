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
