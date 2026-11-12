import { command_help_url, PAGES } from "../help/route.ts";
import { create_matcher, type MatchResult } from "../shared/keys/matcher.ts";
import { parse_sequence } from "../shared/keys/notation.ts";
import { ANY_KEY, type CompiledKeymap } from "../shared/prefix_tree.ts";

export type OpenHelpDeps = {
  is_opener: (tab_id: number, frame_id: number) => Promise<boolean>;
  is_command: (command_id: string) => boolean;
  help_page_url: string;
  open_tab: (tab: { url: string; openerTabId: number; active: true }) => Promise<unknown>;
};

const COMMANDS_PAGE_HASH = PAGES.find((page) => page.id === "commands")!.hash;

// Opens the help page in the foreground next to the asking tab. An id without a help card opens the Commands page
// at its top, because a snippet or alias can name a card that does not exist. A sender without a redeemed ticket gets nothing.
export function create_open_help(deps: OpenHelpDeps) {
  return {
    open: async (command_id: unknown, tab_id: number | undefined, frame_id: number | undefined): Promise<void> => {
      if (tab_id === undefined || frame_id === undefined || typeof command_id !== "string" || !(await deps.is_opener(tab_id, frame_id))) return;
      const url = deps.is_command(command_id) ? command_help_url(deps.help_page_url, command_id) : deps.help_page_url + COMMANDS_PAGE_HASH;
      await deps.open_tab({ url, openerTabId: tab_id, active: true });
    },
  };
}

// A page is named by its id with underscores, like every other lowercase name (`quick_start`). The title is only what the sidebar shows.
const page_name = (page: (typeof PAGES)[number]): string => page.id.replaceAll("-", "_");

// What `:help <name>` resolves to: a help page by its name, or a built-in command by its id. Anything else has no target.
export function help_name_url(help_page_url: string, name: string, command_ids: ReadonlySet<string>): string | undefined {
  if (name === "") return help_page_url + PAGES[0].hash;
  const page = PAGES.find((candidate) => page_name(candidate) === name);
  if (page) return help_page_url + page.hash;
  return command_ids.has(name) ? command_help_url(help_page_url, name) : undefined;
}

// What `:helpkey <keys>` resolves to: the first step's command id of the normal mode binding the keys end on. The matcher reads
// a count or register prefix as the page does. A key that waits for one more key press (`m`) names its capture leaf.
export function key_command_id(keymap: CompiledKeymap | undefined, sequence: string): { id: string; error?: undefined } | { id?: undefined; error: string } {
  const tokens = parse_sequence(sequence).tokens ?? [];
  const none = { error: `${sequence} has no normal-mode binding` };
  if (!keymap) return none;
  const matcher = create_matcher(keymap);
  let result: MatchResult = { kind: "no_match" };
  for (const token of tokens) {
    result = matcher.feed("normal", token);
    if (result.kind !== "pending") break;
  }
  if (result.kind === "match") return { id: result.leaf.steps[0]!.invocation.id };
  const capture = result.kind === "pending" ? result.node.children[ANY_KEY] : undefined;
  if (capture?.kind === "leaf") return { id: capture.steps[0]!.invocation.id };
  return result.kind === "pending" ? { error: `${sequence} is the start of longer keys, not a command` } : none;
}

// The names `:help` completes: the help pages, then every command id.
export const help_name_choices = (command_ids: Iterable<string>): string[] => [...PAGES.map(page_name), ...command_ids];

export type HelpTabPlan = { kind: "update"; tab_id: number; url: string } | { kind: "create"; url: string; opener?: { openerTabId: number; windowId?: number | undefined } };

// A tab already on the help page navigates by hash, which its hashchange handler routes. Any other tab opens a new one beside it.
export function plan_help_tab(
  help_page_url: string,
  target_url: string,
  asking_tab: { id: number | undefined; window_id: number | undefined; url: string | undefined },
): HelpTabPlan {
  if (asking_tab.id === undefined) return { kind: "create", url: target_url };
  const on_help_page = asking_tab.url !== undefined && asking_tab.url.split("#")[0] === help_page_url;
  if (on_help_page) return { kind: "update", tab_id: asking_tab.id, url: target_url };
  return { kind: "create", url: target_url, opener: { openerTabId: asking_tab.id, windowId: asking_tab.window_id } };
}
