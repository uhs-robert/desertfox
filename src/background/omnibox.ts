// The address bar keyword: `df tab.next` runs a command on a page where keys never reach DesertFox (about: pages, the PDF
// viewer, reader view, addons.mozilla.org). The text takes the path of the command line: parse, then the router, whose
// check is the one validator. Nobody can type a missing value into a prompt here, so a command that needs one refuses with its usage.

import type { Mode } from "../shared/command.ts";
import type { RunResponse, Refusal } from "../shared/messages.ts";
import { parse_command_line } from "../shared/registry/index.ts";
import type { CommandLookup, EnumSources } from "../shared/registry/index.ts";
import type { RouteRequest, ActiveTab } from "./router.ts";
import { create_completer } from "../cmdline/completion/sources.ts";
import type { Completion } from "../cmdline/completion/sources.ts";
import type { LiveKind, LiveRead, LiveItems } from "../cmdline/completion/live.ts";
import { key_labels } from "../cmdline/completion/keys.ts";
import { create_word_lookup } from "../cmdline/word_lookup.ts";
import type { CommandMeta } from "../shared/command.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import type { SearchEngine } from "../shared/config.ts";
import { engine_items } from "./complete_items.ts";

export type OmniboxSuggestion = { content: string; description: string };

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
  // The command line's completer over the loaded config, and the keys column. It has no live source, so no tab, bookmark or history rows appear, in any window.
  completer: () => Promise<{ complete: (text: string, caret: number) => Completion; keys: ReadonlyMap<string, string> }>;
  record_history: (text: string, from_private_window: boolean) => Promise<unknown>;
};

export const OMNIBOX_HINT = "Type a DesertFox command, for example tab.next";

// Enter opens in this tab, so only a modified Enter changes where a command that has a `where` param opens.
const WHERE_OF: Record<OmniboxDisposition, string | undefined> = { currentTab: undefined, newForegroundTab: "tab", newBackgroundTab: "background" };

// The address bar shows 10 rows and the default suggestion takes one (measured by `test/key/p31_omnibox.mjs`).
export const MAX_SUGGESTIONS = 9;

// The completer's live source for the address bar: the search engines of the config and nothing else. Tabs, bookmarks and history read empty, so no
// page title, address or private-window item reaches the address bar. A kind that lists nothing is answered, never left loading.
export function engines_only_live(engines: Record<string, SearchEngine>) {
  return {
    read: <Kind extends LiveKind>(kind: Kind): LiveRead<Kind> => {
      if (kind === "engines") return { loading: false, items: engine_items(engines, undefined) } as LiveRead<Kind>;
      if (kind === "anything") return { loading: true };
      const empty: Partial<{ [Kind in LiveKind]: LiveItems[Kind] }> = { open: { rows: [], history_max: 0, sites: [] }, history: { rows: [], max: 0 }, bookmarks: { rows: [], folders: [] } };
      return { loading: false, items: empty[kind] ?? [] } as LiveRead<Kind>;
    },
  };
}

// The completer and keys column over what the background loaded.
export type CompleterInput = {
  commands: readonly CommandMeta[];
  command_aliases: Readonly<Record<string, string>>;
  sources: Parameters<typeof create_completer>[3];
  search_engines: Record<string, SearchEngine>;
  keymap: CompiledKeymap | undefined;
};
export function build_completer(input: CompleterInput) {
  const lookup = create_word_lookup(input.commands, input.command_aliases);
  return { complete: create_completer(lookup, input.commands, input.command_aliases, input.sources, "normal", engines_only_live(input.search_engines)), keys: key_labels(input.keymap, input.commands, "normal") };
}

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

  // An answer that finishes after a newer keystroke is dropped, because Firefox shows whatever `suggest` was last called with.
  let latest_input = 0;
  async function changed(text: string, suggest: (results: OmniboxSuggestion[]) => void): Promise<void> {
    const input = ++latest_input;
    const { complete, keys } = await deps.completer();
    if (input !== latest_input) return;
    const completion = complete(text, text.length);
    suggest(
      completion.rows.slice(0, MAX_SUGGESTIONS).map((row) => {
        const key_text = row.id === undefined ? "" : (keys.get(row.id) ?? "");
        const detail = [row.description, key_text].filter((part) => part !== "").join("  ");
        // Plain text: Firefox 160 shows the description as written, so markup or an entity would appear literally.
        return { content: text.slice(0, completion.start) + row.insert, description: detail === "" ? row.name : `${row.name}  ${detail}` };
      }),
    );
  }

  return { entered, changed };
}
