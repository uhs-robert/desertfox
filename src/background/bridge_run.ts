// What a program outside the browser may run through the bridge, and the one path it takes: parse, the bridge rules,
// the one validator, then the router. The answer is success or a refusal text, never page data.

import type { CommandDef, CommandMeta } from "../shared/command.ts";
import type { Invocation } from "../shared/invocation.ts";
import type { RunResponse } from "../shared/messages.ts";
import { check_args, command_meta, parse_command_line } from "../shared/registry/index.ts";
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
  // The active tab of the focused normal window, undefined when there is none.
  target: () => Promise<BridgeRunTarget | undefined>;
  run: (invocation: Invocation, target: BridgeRunTarget) => Promise<RunResponse>;
};

const refuse = (message: string): BridgeAnswer => ({ ok: false, message });

// The browser's own URL parser decides the scheme, so leading control characters and tabs or newlines inside it cannot hide `javascript:`. Text that does not parse has no scheme and opens as a search or a bare host.
function has_foreign_scheme(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol !== "http:" && protocol !== "https:";
  } catch {
    return false;
  }
}

// The rules that hold before any arg is read.
function refusal_for(command: CommandDef, is_snippet: boolean): string | undefined {
  if (is_snippet || never_listed(command.id)) return `${command.id} never runs through the bridge`;
  if (command.bridge !== true) return `${command.id} is not allowed through the bridge`;
  return undefined;
}

// An address that is not http or https could start a program, read a local file or run script, so it is refused after the validator has filled the args.
function foreign_address(command: CommandDef, args: Record<string, unknown>): boolean {
  const url_params = (command.params ?? []).filter((param) => param.format === "url" || command.id === "open.url");
  return url_params.some((param) => typeof args[param.name] === "string" && has_foreign_scheme(args[param.name] as string));
}

export function create_bridge_run(deps: BridgeRunDeps) {
  async function run(command_text: string): Promise<BridgeAnswer> {
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
    if (foreign_address(command, checked.args)) return refuse(`${command.id} opens only http and https addresses through the bridge`);
    const target = await deps.target();
    if (!target) return refuse("no normal window is open");
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
