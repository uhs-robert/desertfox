import { help_name_choices, help_name_url, key_command_id } from "../background/open_help.ts";
import { command_help_url, HELP_PAGE_FILE } from "../help/route.ts";
import { open_help_url } from "./help_tab.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap, type CompiledKeymap } from "../shared/prefix_tree.ts";
import { define, registry } from "../shared/registry/builtin.ts";

define("help.whichkey", {
  label: "Which key",
  intent: "List the keys at the top of the keymap.",
  bridge: false,
  runs_in: "content",
  repeatable: false,
  modes: ["normal", "caret", "visual", "visual_line", "media"],
  bundle: "whichkey",
});

// Defined after every other command module has run (see command_modules.ts), so the choices cover every command.
const command_ids = new Set([...registry.list().map((command) => command.id), "help.open", "help.key"]);

define("help.open", {
  name: "help",
  label: "Help",
  intent: "Open the help page. On the help page itself, it goes there in place instead of a new tab. Name a command to open its card, or a page such as commands or quick_start. It lists every command, its keys and the config warnings.",
  params: [{ name: "name", type: "string", rest: true, main: true, optional: true, values: help_name_choices(command_ids), strict: true }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: async (ctx, args) => {
    const name = args.name as string;
    const help_page_url = browser.runtime.getURL(HELP_PAGE_FILE);
    const url = help_name_url(help_page_url, name, command_ids) as string; // `strict` limits name to the choices that resolve
    await open_help_url(ctx, help_page_url, url);
  },
});

define("help.key", {
  name: "helpkey",
  label: "Help for a key",
  intent: "Open the help card of the command a normal mode key runs. Give the keys as in the config, such as gg, <C-d> or ,r. A count or register prefix is ignored. A key bound to several steps shows the first step. Quote a key the command line reads itself, such as a backslash or a quote.",
  params: [{ name: "keys", type: "string", main: true, format: "keys" }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: async (ctx, args) => {
    const keys = args.keys as string;
    const stored = await browser.storage.local.get(COMPILED_KEYMAP_STORAGE_KEY);
    const found = key_command_id(current_keymap(stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined), keys);
    if (found.error !== undefined) throw new RuntimeRefusal(found.error);
    if (!command_ids.has(found.id)) throw new RuntimeRefusal(`${keys} runs ${found.id}, which has no help card`);
    const help_page_url = browser.runtime.getURL(HELP_PAGE_FILE);
    await open_help_url(ctx, help_page_url, command_help_url(help_page_url, found.id));
  },
});
