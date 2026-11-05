import { help_whichkey } from "../content/handlers/lazy_bundle.ts";
import { help_name_choices, help_name_url } from "../background/open_help.ts";
import { HELP_PAGE_FILE } from "../help/route.ts";
import { define, registry } from "../shared/registry/index.ts";

define("help.whichkey", {
  label: "Which key",
  intent: "List the keys at the top of the keymap.",
  runs_in: "content",
  modes: ["normal", "caret", "visual"],
  run: help_whichkey.run,
});

// Defined after every other command module has run (see command_modules.ts), so the choices cover every command.
const command_ids = new Set([...registry.list().map((command) => command.id), "help.open"]);

define("help.open", {
  name: "help",
  label: "Help",
  intent: "Open the help page in a new tab. Name a command to open its card, or a page such as Commands. It lists every command, its keys and the config warnings.",
  params: [{ name: "name", type: "string", main: true, default: "", values: help_name_choices(command_ids) }],
  runs_in: "background",
  repeatable: false,
  run: async (ctx, args) => {
    const name = args.name as string;
    const url = help_name_url(browser.runtime.getURL(HELP_PAGE_FILE), name, command_ids);
    if (url === undefined) throw new Error(`No help for "${name}". The command line completes the names`);
    await browser.tabs.create({ url, active: true, ...(ctx.tab_id === undefined ? {} : { openerTabId: ctx.tab_id }) });
  },
});
