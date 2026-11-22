import { command_help_url, PAGES, site_rules_help_url } from "../shared/page/help_route.ts";
import { create_matcher, type MatchResult } from "../shared/keys/matcher.ts";
import { normal_tree_for, site_columns_for } from "../shared/site/site_columns.ts";
import { parse_sequence } from "../shared/keys/notation.ts";
import { ANY_KEY, is_freed, type CompiledKeymap } from "../shared/prefix_tree.ts";

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
// `address` is the invoking tab's address, which only the Site Rules page reads.
export function help_name_url(help_page_url: string, name: string, command_ids: ReadonlySet<string>, address?: string): string | undefined {
  if (name === "") return help_page_url + PAGES[0].hash;
  const page = PAGES.find((candidate) => page_name(candidate) === name);
  if (page?.id === "site-rules" && address !== undefined) return site_rules_help_url(help_page_url, address);
  if (page) return help_page_url + page.hash;
  return command_ids.has(name) ? command_help_url(help_page_url, name) : undefined;
}

// What `:helpkey <keys>` resolves to: the first step's command id of the normal mode binding the keys end on. The matcher reads
// a count or register prefix as the page does. The caller passes the keymap the page receives, so site rules count. A key that waits for one more key press (`m`) names its capture leaf.
// `frees` is the page's pass rule, which hands a key to the page whatever the tree holds.
export function key_command_id(keymap: CompiledKeymap | undefined, sequence: string, frees?: (token: string) => boolean): { id: string; error?: undefined } | { id?: undefined; error: string } {
  const tokens = parse_sequence(sequence).tokens ?? [];
  const none = { error: `${sequence} has no normal-mode binding` };
  if (!keymap) return none;
  const matcher = create_matcher(keymap, frees);
  let result: MatchResult = { kind_: "no_match" };
  let consumed = 0;
  for (const token of tokens) {
    result = matcher.feed("normal", token);
    consumed += 1;
    if (result.kind_ !== "pending") break;
  }
  // Keys left after a complete binding are no binding, so `jx` is not `j`.
  if (result.kind_ === "match") return consumed === tokens.length ? { id: result.leaf.steps[0]!.invocation.id } : none;
  const capture = result.kind_ === "pending" ? result.node.children[ANY_KEY] : undefined;
  if (capture?.kind === "leaf") return { id: capture.steps[0]!.invocation.id };
  return result.kind_ === "pending" ? { error: `${sequence} is the start of longer keys, not a command` } : none;
}

// The keys as the page at `address` receives them: its site rules bind, free or prune keys. No address gives the global tree.
export function key_command_id_on_page(keymap: CompiledKeymap | undefined, address: string | undefined, sequence: string): ReturnType<typeof key_command_id> {
  if (!keymap) return key_command_id(keymap, sequence);
  const page = normal_tree_for(keymap.modes.normal, site_columns_for(keymap, [address]));
  const frees = "frees" in page ? page.frees : undefined;
  return key_command_id({ ...keymap, modes: { ...keymap.modes, normal: page.tree } } as CompiledKeymap, sequence, frees && ((token) => is_freed(frees, token)));
}

// The names `:help` completes: the help pages, then every command id.
export const help_name_choices = (command_ids: Iterable<string>): string[] => [...PAGES.map(page_name), ...command_ids];
