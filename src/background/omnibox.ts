// The address bar keyword: `df tab.next` runs a command on a page where keys never reach DesertFox (about: pages, the PDF
// viewer, reader view, addons.mozilla.org). The text takes the path of the command line: parse, then the router, whose
// check is the one validator. Nobody can type a missing value into a prompt here, so a command that needs one refuses with its usage.

import type { Mode } from "../shared/command.ts";
import type { RunResponse, Refusal } from "../shared/messages.ts";
import { parse_command_line } from "../shared/registry/index.ts";
import type { CommandLookup, EnumSources } from "../shared/registry/index.ts";
import type { RouteRequest, ActiveTab } from "./router.ts";

export type OmniboxDisposition = "currentTab" | "newForegroundTab" | "newBackgroundTab";

export type OmniboxDeps = {
  // The words the command line accepts, configured aliases included, read once the config has loaded.
  lookup: () => Promise<CommandLookup>;
  registry: { get: (command_id: string) => { params?: readonly { name: string }[] } | undefined };
  get_enum_sources: () => Promise<EnumSources>;
  active_tab: () => Promise<ActiveTab | undefined>;
  mode_of: (tab_id: number | undefined) => Promise<Mode>;
  run: (request: RouteRequest) => Promise<RunResponse>;
  show_refusal: (tab_id: number | undefined, refusal: Refusal) => Promise<unknown>;
  record_history: (text: string, from_private_window: boolean) => Promise<unknown>;
};

export const OMNIBOX_HINT = "Type a DesertFox command, for example tab.next";

// Enter opens in this tab, so only a modified Enter changes where a command that has a `where` param opens.
const WHERE_OF: Record<OmniboxDisposition, string | undefined> = { currentTab: undefined, newForegroundTab: "tab", newBackgroundTab: "background" };

export function create_omnibox(deps: OmniboxDeps) {
  async function entered(text: string, disposition: OmniboxDisposition): Promise<void> {
    const line = text.trim();
    const active = await deps.active_tab();
    const refuse = (id: string, message: string) => deps.show_refusal(active?.tab_id, { id, message });
    if (line === "") return void (await refuse("omnibox", OMNIBOX_HINT));
    const parsed = parse_command_line(await deps.lookup(), line, await deps.get_enum_sources());
    if (parsed.kind === "error") return void (await refuse("omnibox", parsed.error));
    if (parsed.kind === "help") return void (await refuse("omnibox", parsed.usage));
    let { invocation } = parsed;
    const where = WHERE_OF[disposition];
    if (where !== undefined && deps.registry.get(invocation.id)?.params?.some((param) => param.name === "where")) invocation = { ...invocation, args: { ...invocation.args, where } };
    const response = await deps.run({
      invocations: [invocation],
      mode: await deps.mode_of(active?.tab_id),
      ...(active === undefined ? {} : { sender_tab_id: active.tab_id }),
    });
    // The router delivers every refusal itself except this one, and a line typed while off is not history.
    if (!response.ok && response.refusal.id === "desertfox.off") return void (await deps.show_refusal(active?.tab_id, response.refusal));
    // Recorded as the command line records: what the user typed, from a normal window only.
    await deps.record_history(line, active?.incognito === true);
  }

  return { entered };
}
