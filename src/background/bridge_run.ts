// What a program outside the browser may run through the bridge, and the one path it takes: parse, the bridge rules,
// the one validator, then the router. The answer is success or a refusal text, never page data.

import type { CommandDef, CommandMeta } from "../shared/command.ts";
import type { Invocation } from "../shared/invocation.ts";
import type { RunResponse } from "../shared/messages.ts";
import { check_args, command_meta, parse_command_line } from "../shared/registry/index.ts";
import { is_context_source } from "../shared/registry/params.ts";
import type { EnumSources, Registry } from "../shared/registry/index.ts";

export type BridgeAnswer = { ok: true } | { ok: false; message: string };

// Whole groups that never run through the bridge, whatever a command's `bridge` field says: the config and its settings, saved sessions,
// the clipboard (`copy`, `register`), debugging, the native hosts and permission grants.
const NEVER_GROUPS: readonly string[] = ["config", "settings", "session", "copy", "register", "debug", "native", "permissions"];
// Single commands that never run: `page.reload` can clear cookies and site data, `page.save_pdf` and the hint picker can download or copy.
// `visual.act` copies the selection and `open.clipboard` reads the clipboard. `command.repeat` and `macro.play` replay stored steps through the main router, so they could run a never-listed command.
const NEVER_IDS: readonly string[] = ["page.reload", "page.save_pdf", "hint.run", "hint.key", "visual.act", "open.clipboard", "command.repeat", "macro.play"];
// Commands that open an address. A private window gets none of them from outside, because the page would join a private session without the user asking.
const OPENS_URL_IDS: readonly string[] = [
  "open.url", "open.search", "open.anything", "open.clipboard", "tab.load", "bookmark.open", "bookmark.open_folder", "history.open", "quickmark.open", "tab.reopen_in_container", "window.new", "url.increment", "url.parent", "url.root",
];

export const never_listed = (id: string): boolean => NEVER_GROUPS.includes(id.split(".")[0] ?? "") || NEVER_IDS.includes(id);
export const opens_url = (id: string): boolean => OPENS_URL_IDS.includes(id);

export type BridgeRunTarget = { tab_id: number; window_id: number; url: string | undefined; incognito: boolean };

export type BridgeRunDeps = {
  registry: Pick<Registry, "find" | "get" | "list">;
  // A snippet from the user's own config is code the owner wrote for the page, so it never runs from outside.
  is_snippet: (command_id: string) => boolean;
  get_enum_sources: () => Promise<EnumSources>;
  // Turns typed address text into the address the open command opens, as that command does (`typed_url_target`). It throws when the text opens nothing.
  resolve_url: (text: string) => Promise<string>;
  // The tab the command runs in: the one `--tab` names, which must be a normal-window tab, or else the active tab of the focused normal window. Undefined when there is none.
  target: (tab_id: number | undefined) => Promise<BridgeRunTarget | undefined>;
  run: (invocation: Invocation, target: BridgeRunTarget) => Promise<RunResponse>;
};

const refuse = (message: string): BridgeAnswer => ({ ok: false, message });

// The rules that hold before any arg is read.
function refusal_for(command: CommandDef, is_snippet: boolean): string | undefined {
  if (is_snippet || never_listed(command.id)) return `${command.id} never runs through the bridge`;
  if (command.bridge !== true) return `${command.id} is not allowed through the bridge`;
  return undefined;
}

// The address the handler will open, found the way the handler finds it (trim, scheme, bare host, search), must be http or https. Checking the typed text instead would read it differently from the handler: `trim` strips Unicode spaces that the URL parser keeps. A blank address opens DesertFox's own new tab page, so it is left to the handler.
async function foreign_address(command: CommandDef, args: Record<string, unknown>, resolve_url: (text: string) => Promise<string>): Promise<boolean> {
  const url_params = (command.params ?? []).filter((param) => param.format === "url" || (command.id === "open.url" && param.name === "url"));
  for (const param of url_params) {
    const text = args[param.name];
    if (typeof text !== "string" || text.trim() === "") continue;
    try {
      const { protocol } = new URL(await resolve_url(text));
      if (protocol !== "http:" && protocol !== "https:") return true;
    } catch {
      return true;
    }
  }
  return false;
}

export function create_bridge_run(deps: BridgeRunDeps) {
  async function run(command_text: string, tab_id?: number): Promise<BridgeAnswer> {
    const sources = await deps.get_enum_sources();
    const parsed = parse_command_line(deps.registry, command_text, sources);
    if (parsed.kind === "error") return refuse(parsed.error);
    if (parsed.kind === "help") return refuse("help is not available through the bridge");
    const command = deps.registry.get(parsed.invocation.id);
    if (!command) return refuse(`unknown command "${parsed.invocation.id}"`);
    const refusal = refusal_for(command, deps.is_snippet(command.id));
    if (refusal) return refuse(refusal);
    // No may_prompt below, so a missing value is this failure and never an open command line.
    const checked = check_args(command, parsed.invocation.args, sources);
    if (!checked.ok) return refuse(checked.error);
    // An unquoted `@clipboard` or `@selection` is read by the router after this check, so a caller could open or probe text the bridge never saw. Quoted text stays plain text.
    if (Object.values(checked.args).some(is_context_source)) return refuse(`${command.id} does not take @clipboard or @selection through the bridge`);
    if (await foreign_address(command, checked.args, deps.resolve_url)) return refuse(`${command.id} opens only http and https addresses through the bridge`);
    const target = await deps.target(tab_id);
    if (!target) return refuse(tab_id === undefined ? "no normal window is open" : "no such tab");
    if (target.incognito && opens_url(command.id)) return refuse("the focused window is private, so nothing opens an address there from outside");
    const response = await deps.run(parsed.invocation, target);
    // A handler refusal can hold page data such as a tab title, so the caller gets fixed text. Only the parse, rule and validator refusals above echo the caller's own text.
    return response.ok ? { ok: true } : refuse(`${command.id} failed`);
  }

  // The commands the bridge allows, with their params, for completion in the CLI.
  function list(): CommandMeta[] {
    return deps.registry.list().filter((command) => refusal_for(command, deps.is_snippet(command.id)) === undefined).map(command_meta);
  }

  return { run, list };
}
