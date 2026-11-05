import { help_whichkey } from "../content/handlers/lazy_bundle.ts";
import { help_name_choices, help_name_url, plan_help_tab } from "../background/open_help.ts";
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
  intent: "Open the help page in a new tab, or go to the page in place when this tab is the help page. Name a command to open its card, or a page such as Commands. It lists every command, its keys and the config warnings.",
  params: [{ name: "name", type: "string", main: true, default: "", values: help_name_choices(command_ids) }],
  runs_in: "background",
  repeatable: false,
  run: async (ctx, args) => {
    const name = args.name as string;
    const help_page_url = browser.runtime.getURL(HELP_PAGE_FILE);
    const url = help_name_url(help_page_url, name, command_ids);
    if (url === undefined) throw new Error(`No help for "${name}". The command line completes the names`);
    const asking_tab = ctx.tab_id === undefined ? undefined : await browser.tabs.get(ctx.tab_id);
    const plan = plan_help_tab(help_page_url, url, { id: ctx.tab_id, window_id: ctx.window_id, url: asking_tab?.url });
    if (plan.kind === "update") {
      await browser.tabs.update(plan.tab_id, { url: plan.url });
      return;
    }
    // Firefox rejects an openerTabId from another window, so the window goes with it.
    await browser.tabs.create({ url: plan.url, active: true, ...plan.opener });
  },
});
