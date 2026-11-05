import { command_help_url, PAGES } from "../help/route.ts";

export type OpenHelpDeps = {
  is_opener: (tab_id: number) => Promise<boolean>;
  is_command: (command_id: string) => boolean;
  help_page_url: string;
  open_tab: (tab: { url: string; openerTabId: number; active: true }) => Promise<unknown>;
};

const COMMANDS_PAGE_HASH = PAGES.find((page) => page.id === "commands")!.hash;

// Opens the help page in the foreground next to the asking tab. An id without a help card opens the Commands page
// at its top, because a snippet or alias can name a card that does not exist. A sender without a redeemed ticket gets nothing.
export function create_open_help(deps: OpenHelpDeps) {
  return {
    open: async (command_id: unknown, tab_id: number | undefined): Promise<void> => {
      if (tab_id === undefined || typeof command_id !== "string" || !(await deps.is_opener(tab_id))) return;
      const url = deps.is_command(command_id) ? command_help_url(deps.help_page_url, command_id) : deps.help_page_url + COMMANDS_PAGE_HASH;
      await deps.open_tab({ url, openerTabId: tab_id, active: true });
    },
  };
}

// What `:help <name>` resolves to: a help page by its title, or a built-in command by its id. Anything else has no target.
export function help_name_url(help_page_url: string, name: string, command_ids: ReadonlySet<string>): string | undefined {
  if (name === "") return help_page_url + PAGES[0].hash;
  const page = PAGES.find((candidate) => candidate.title.toLowerCase() === name.toLowerCase());
  if (page) return help_page_url + page.hash;
  return command_ids.has(name) ? command_help_url(help_page_url, name) : undefined;
}

// The names `:help` completes: the help pages, then every command id.
export const help_name_choices = (command_ids: Iterable<string>): string[] => [...PAGES.map((page) => page.title), ...command_ids];

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
