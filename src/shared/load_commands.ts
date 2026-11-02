// Fetches commands.json for the extension pages (help and status). Not for the content script.

import type { CommandsFile } from "./command.ts";

export async function load_commands_file(): Promise<CommandsFile> {
  return (await (await fetch(browser.runtime.getURL("commands.json"))).json()) as CommandsFile;
}
