// The state of one open command line, apart from the DOM: the text, the inline message, the completion list and the
// history walk. A key from the keymap arrives as a command id and becomes an effect for the page to carry out.

import { FINDER_PARAM } from "../shared/anything_ref.ts";
import type { Invocation } from "../shared/invocation.ts";
import type { ContainerStore, TabItem, TabRowsAction } from "../shared/messages.ts";
import type { ParseResult } from "../shared/registry/index.ts";
import { rank } from "../shared/score.ts";
import { marks_of } from "./completion/sources.ts";
import type { Completion, Row, TabMarks } from "./completion/sources.ts";
import { create_history_cursor } from "./history_cursor.ts";

export type Effect =
  | { kind: "render" }
  | { kind: "close" }
  // The text parsed. `text` is what to put in the history.
  | { kind: "submit"; invocation: Invocation; text: string }
  // Enter on a search line: the search keeps its match.
  | { kind: "find_commit" }
  // Open the help page at this command.
  | { kind: "help"; command_id: string }
  // `list.act` on the selected tabs, or the highlighted one: the page asks the background to run the action on these ids, which the key press fixed.
  // The rows change when the model patch arrives. `reopen` carries the container's store id.
  | { kind: "tab_rows_action"; action: TabRowsAction; tab_ids: number[]; cookie_store_id?: string };

export type SessionDeps = {
  history: readonly string[];
  parse: (text: string) => ParseResult;
  // An error for a parsed command that cannot run yet, for example a required value left out. The line stays open.
  // Undefined when the command is fine. The pre-check must not touch the ticket, the port or `run`.
  precheck?: (invocation: Invocation) => string | undefined;
  // What the list offers for a text and a caret. Without it the line has no list.
  complete?: ((text: string, caret: number) => Completion) | undefined;
  // The line is a page search. Its text is a pattern and no command: Enter commits it, and the history and the list stay off.
  search?: boolean;
  // The tab model's rows, undefined before its first snapshot. The selection is checked against them, hidden tabs included.
  tabs?: () => readonly TabItem[] | undefined;
  // The containers a tab list can reopen tabs in. Empty on a private line, which has none.
  containers?: readonly ContainerStore[];
  // Whether a command takes a param of this name. Shift+Enter sets `where` on the commands that have one.
  has_param?: (command_id: string, name: string) => boolean;
  // The id of the command a typed word names, for help when no row is selected.
  command_id_of?: (word: string) => string | undefined;
  // Whether the help page has a card for a command. Snippets have none. Without it every command has one.
  has_help?: (command_id: string) => boolean;
};

const NO_ROWS: Completion["rows"] = [];

export function create_session(deps: SessionDeps) {
  const cursor = create_history_cursor(deps.history);
  let text = "";
  let caret = 0;
  // Shown under the line: a parse error or a warning. Any edit clears it.
  let message: string | undefined;
  // The list for the text the user typed. It stays the same while a row is previewed. Undefined after a history step.
  let completion: Completion | undefined;
  // Escape closes the list and keeps the line. Typing opens it again.
  let list_shown = true;
  // The previewed row, or -1 before the first Tab, Up or Down.
  let selected = -1;
  // True until the user types, clears or uses a completion key. A fresh line keeps Up and Down for the history, so `:` then Up still recalls the last command.
  let fresh = true;
  // The tabs marked with `list.select`, by id. Filtering does not touch them. A tab that leaves the model drops out.
  const selection = new Set<number>();
  // After a close, the tab the highlight moves to once the closed rows are gone from the list.
  let cursor_after_close: number | undefined;
  // The container prompt, open over a tab list. It keeps what the list held, so Esc brings it back, and the tab that `<A-c>` found highlighted.
  let picking: { back: { text: string; caret: number }; highlighted_tab: number | undefined; marked: boolean } | undefined;
  // The text and caret the list was ranked for. While a row is previewed, `text` differs from it.
  let saved: { text: string; caret: number } | undefined;

  const replace_text = (next: string) => {
    text = next;
    message = undefined;
  };

  // The container prompt ranks the containers by name. Any other line ranks as the page's completer does.
  const complete = (at_text: string, at_caret: number): Completion | undefined =>
    picking
      ? { rows: rank(at_text, container_rows()), start: 0, end: at_text.length, usage: "Enter reopens the tabs in this container, Esc goes back", listing: true }
      : deps.complete?.(at_text, at_caret);
  // Each row carries its store id, because names can repeat.
  const container_rows = (): Row[] =>
    (deps.containers ?? []).map((container) => ({ name: container.name, insert: container.name, description: "", args: "", also_named: [], keywords: [], usage: `reopen in ${container.name}`, cookie_store_id: container.cookie_store_id }));

  const rows = () => (completion && list_shown ? completion.rows : NO_ROWS);

  // The previewed row, else the finder's first row while a query is typed. -1 when no row is highlighted.
  const highlighted = () => (selected >= 0 ? selected : completion?.highlight_first && rows().length > 0 ? 0 : -1);

  // New typed text ends any preview: the list ranks what is now in the line.
  const refresh = () => {
    completion = complete(text, caret);
    list_shown = true;
    selected = -1;
    saved = undefined;
    accepted = undefined;
    cursor_after_close = undefined;
  };

  // The tab row the user accepted (a click, or Tab with one match) and the text before it. The line holds the tab's number, so a model change renumbers it.
  let accepted: { tab_id: number; base: { text: string; caret: number } } | undefined;

  // Takes the previewed row into the line for good and ranks the new text.
  const accept = () => {
    const tab_id = completion?.rows[selected]?.tab?.id;
    const base = saved;
    refresh();
    if (tab_id !== undefined && base) accepted = { tab_id, base };
  };

  // The line shows the row in place of the span the list was ranked for.
  const preview = (index: number) => {
    const row = completion?.rows[index];
    if (!completion || !row) return;
    const base = (saved ??= { text, caret });
    // A new preview replaces the accepted row, so a model change follows the preview.
    accepted = undefined;
    selected = index;
    replace_text(base.text.slice(0, completion.start) + row.insert + base.text.slice(completion.end));
    caret = completion.start + row.insert.length;
  };

  // The accepted tab's row, found again by id in the list ranked for the text before the accept. Its new number goes into the line, or the typed text returns when the tab is gone.
  const follow_accepted = ({ tab_id, base }: NonNullable<typeof accepted>) => {
    const kept_message = message;
    const ranked = complete(base.text, base.caret);
    const row = ranked?.rows.find((candidate) => candidate.tab?.id === tab_id);
    if (ranked && row) {
      replace_text(base.text.slice(0, ranked.start) + row.insert + base.text.slice(ranked.end));
      caret = ranked.start + row.insert.length;
    } else {
      replace_text(base.text);
      caret = base.caret;
    }
    refresh();
    if (row) accepted = { tab_id, base };
    message = kept_message;
  };

  // Shown under a search line in place of the usage.
  let status = "";

  const submit = (where?: unknown): Effect => {
    if (picking) return choose_container();
    if (deps.search) return text === "" ? { kind: "close" } : { kind: "find_commit" };
    const line = text.replace(/^[\s:]+/, "").trim();
    if (line === "") return { kind: "close" };
    const parsed = deps.parse(line);
    if (parsed.kind === "error") {
      message = parsed.error;
      return { kind: "render" };
    }
    if (parsed.kind === "help") {
      message = parsed.usage;
      return { kind: "render" };
    }
    let invocation = parsed.invocation;
    // The finder acts on the highlighted row, not on the text: a repeated title or address cannot pick the wrong one.
    const finder_row = completion?.highlight_first ? rows()[highlighted()] : undefined;
    if (finder_row?.ref !== undefined) invocation = { ...invocation, args: { ...invocation.args, [FINDER_PARAM]: finder_row.ref } };
    // Shift+Enter: where the page opens replaces the command's own, on a command that has one.
    if (typeof where === "string" && deps.has_param?.(invocation.id, "where")) invocation = { ...invocation, args: { ...invocation.args, where } };
    const problem = deps.precheck?.(invocation);
    if (problem !== undefined) {
      message = problem;
      return { kind: "render" };
    }
    return { kind: "submit", invocation, text: line };
  };

  // Tab and Shift-Tab wrap around. A single match goes into the line at once, and then the list ranks the new text.
  const cycle = (step: 1 | -1): Effect => {
    fresh = false;
    cursor_after_close = undefined;
    if (!completion) refresh();
    list_shown = true;
    const count = completion?.rows.length ?? 0;
    if (count === 1 && selected < 0) {
      preview(0);
      accept();
    } else if (count > 0) preview(selected < 0 ? (step === 1 ? 0 : count - 1) : (selected + step + count) % count);
    return { kind: "render" };
  };

  // Up and Down stop at the ends. They never leave the list for the history.
  const step_selection = (direction: unknown): Effect => {
    cursor_after_close = undefined;
    const count = rows().length;
    const at = highlighted();
    preview(direction === "next" ? Math.min(at + 1, count - 1) : at < 0 ? count - 1 : Math.max(at - 1, 0));
    return { kind: "render" };
  };

  // The selected row decides. With none selected, the command word already typed does.
  const help = (): Effect => {
    const row = completion?.rows[highlighted()];
    const word = text.replace(/^[\s:]+/, "").split(/\s/, 1)[0] ?? "";
    // A history recall leaves `selected` set with no row behind it, so the row decides, not the index.
    const command_id = row ? row.id : deps.command_id_of?.(word);
    if (command_id !== undefined && (deps.has_help?.(command_id) ?? true)) return { kind: "help", command_id };
    message = row ? "this row has no command help" : "no command to show help for";
    return { kind: "render" };
  };

  // The selection, else the highlighted row. A history recall leaves `selected` set with no row behind it, so the row is read, not the index.
  // The marks belong to a tab list. Any other list hides them, so they neither act nor clear there.
  const on_tab_list = () => rows().some((row) => row.tab);

  const acted_tabs = (): TabMarks[] => {
    if (selection.size > 0 && on_tab_list()) return (deps.tabs?.() ?? []).filter((tab) => selection.has(tab.id)).map(marks_of);
    const marks = rows()[highlighted()]?.tab;
    return marks ? [marks] : [];
  };

  // The first row below the highlight that stays, else the first one above it.
  const row_to_keep = (closing: ReadonlySet<number>): number | undefined => {
    const stays = (index: number) => rows()[index]?.tab && !closing.has(rows()[index]!.tab!.id);
    const at = highlighted();
    if (at < 0) return undefined;
    const indexes = rows().map((_, index) => index);
    const kept = indexes.slice(at).find(stays) ?? indexes.slice(0, at).findLast(stays);
    return kept === undefined ? undefined : rows()[kept]!.tab!.id;
  };

  const open_container_prompt = (): Effect => {
    if (!deps.containers?.length) {
      message = "this line has no containers";
      return { kind: "render" };
    }
    picking = { back: saved ?? { text, caret }, highlighted_tab: rows()[highlighted()]?.tab?.id, marked: selection.size > 0 };
    fresh = false;
    replace_text("");
    caret = 0;
    refresh();
    return { kind: "render" };
  };

  // Back to the tab list as it was: its text and highlighted tab. The marks never left.
  const leave_container_prompt = () => {
    const { back, highlighted_tab } = picking!;
    picking = undefined;
    replace_text(back.text);
    caret = back.caret;
    refresh();
    const index = completion?.rows.findIndex((row) => row.tab?.id === highlighted_tab) ?? -1;
    if (index >= 0) preview(index);
  };

  // The previewed container, else the one named exactly. The tab ids are read now: the marks, else the highlighted tab if it is still there.
  const choose_container = (): Effect => {
    const typed = completion?.rows.filter((row) => row.name === text.trim()) ?? [];
    if (selected < 0 && typed.length > 1) {
      message = "several containers have that name, pick a row";
      return { kind: "render" };
    }
    const chosen = completion?.rows[selected] ?? typed[0];
    const cookie_store_id = (chosen as Partial<{ cookie_store_id: string }> | undefined)?.cookie_store_id;
    if (cookie_store_id === undefined) {
      message = "pick a container";
      return { kind: "render" };
    }
    const { highlighted_tab, marked } = picking!;
    // Marks that all closed leave nothing to reopen: the highlighted tab was never the choice.
    const highlighted_present = !marked && highlighted_tab !== undefined && (deps.tabs?.()?.some((tab) => tab.id === highlighted_tab) ?? true);
    const tab_ids = selection.size > 0 ? [...selection] : highlighted_present ? [highlighted_tab] : [];
    leave_container_prompt();
    if (tab_ids.length === 0) message = "no tab to reopen";
    return tab_ids.length === 0 ? { kind: "render" } : { kind: "tab_rows_action", action: "reopen", tab_ids, cookie_store_id };
  };

  // Mute and pin: any tab off turns all on, else all off. Unload: the loaded tabs unload, or all load when none is loaded.
  const act_on_rows = (action: unknown): Effect => {
    const tabs = acted_tabs();
    if (tabs.length === 0) {
      message = "select a tab row first";
      return { kind: "render" };
    }
    if (action === "reopen") return open_container_prompt();
    const ids = (chosen: readonly TabMarks[]) => chosen.map((tab) => tab.id);
    const without = (flag: "muted" | "pinned") => tabs.some((tab) => !tab.flags.includes(flag));
    if (action === "close") {
      const closing = new Set(ids(tabs));
      const highlighted_tab = rows()[highlighted()]?.tab?.id;
      cursor_after_close = highlighted_tab !== undefined && closing.has(highlighted_tab) ? row_to_keep(closing) : undefined;
      return { kind: "tab_rows_action", action, tab_ids: ids(tabs) };
    }
    if (action === "mute") return { kind: "tab_rows_action", action: without("muted") ? "mute" : "unmute", tab_ids: ids(tabs) };
    if (action === "pin") return { kind: "tab_rows_action", action: without("pinned") ? "pin" : "unpin", tab_ids: ids(tabs) };
    // The active tab is the line's own and cannot unload, so it must not keep `<A-u>` from loading the others.
    const loaded = tabs.filter((tab) => !tab.flags.includes("discarded") && tab.status !== "%");
    return loaded.length > 0 ? { kind: "tab_rows_action", action: "unload", tab_ids: ids(loaded) } : { kind: "tab_rows_action", action: "load", tab_ids: ids(tabs) };
  };

  // Marks or unmarks the highlighted tab row, then moves down so a run of keys marks a run of rows.
  const toggle_selected = (): Effect => {
    const id = rows()[highlighted()]?.tab?.id;
    if (id === undefined) {
      message = "select a tab row first";
      return { kind: "render" };
    }
    if (!selection.delete(id)) selection.add(id);
    return step_selection("next");
  };

  const walk_history = (direction: unknown): Effect => {
    if (deps.search) return { kind: "render" };
    // The container prompt has no history, so Up and Down with no row to step to must not replace the typed name.
    if (picking && rows().length === 0) return { kind: "render" };
    if (!fresh && rows().length > 0) return step_selection(direction);
    const next = direction === "next" ? cursor.next() : cursor.prev(text);
    if (next !== undefined) {
      replace_text(next);
      caret = next.length;
      completion = undefined;
    }
    return { kind: "render" };
  };

  return {
    get_text: () => text,
    get_caret: () => caret,
    get_message: () => message,
    // The prompt text while the container prompt is open, else undefined and the page keeps its own.
    get_prompt: (): string | undefined => (picking ? "container: " : undefined),
    // The rows to draw: none while the list is closed.
    get_rows: rows,
    get_selected: highlighted,
    // The ids of the marked tabs, which the list draws on their rows.
    get_marked: (): ReadonlySet<number> => selection,
    // For the note row: the selected row's usage, else "no match" for an empty list, else the typed command's usage.
    get_hint: (): string | undefined => {
      if (deps.search) return status;
      const row = completion?.rows[highlighted()];
      if (row) return row.usage;
      if (completion?.loading) return "loading";
      return completion?.listing && completion.rows.length === 0 ? "no match" : completion?.usage;
    },
    // The user typed or the page inserted a key: the history walk and any preview start over.
    edit: (next: string, next_caret = next.length) => {
      fresh = false;
      replace_text(next);
      caret = next_caret;
      cursor.reset();
      refresh();
    },
    // The text the line opens with, as opposed to typing. The line stays fresh.
    open: (initial: string) => {
      replace_text(initial);
      caret = initial.length;
      refresh();
    },
    // Tabs or bookmarks arrived or changed. The list ranks again. A closed list stays closed.
    // A previewed tab row stays on the same tab by id: its number in the line follows the tab, and a tab that is gone ends the preview.
    // Any other previewed row stays as it is.
    source_ready: () => {
      const present = deps.tabs?.();
      if (present) {
        const ids = new Set(present.map((tab) => tab.id));
        for (const id of selection) if (!ids.has(id)) selection.delete(id);
      }
      if (!completion) return;
      if (accepted) return follow_accepted(accepted);
      if (selected < 0) {
        completion = complete(text, caret);
        return;
      }
      const tab_id = completion.rows[selected]?.tab?.id;
      if (tab_id === undefined || !saved) return;
      const base = saved;
      // The inline note belongs to the last action, not to the text, so the rebuild keeps it.
      const kept_message = message;
      completion = complete(base.text, base.caret);
      const index = completion?.rows.findIndex((row) => row.tab?.id === tab_id) ?? -1;
      const next = index < 0 && cursor_after_close !== undefined ? completion?.rows.findIndex((row) => row.tab?.id === cursor_after_close) ?? -1 : -1;
      if (index < 0) cursor_after_close = undefined;
      if (index >= 0 || next >= 0) preview(index >= 0 ? index : next);
      else {
        selected = -1;
        saved = undefined;
        replace_text(base.text);
        caret = base.caret;
      }
      message = kept_message;
    },
    set_message: (next: string | undefined) => {
      message = next;
    },
    set_status: (next: string) => {
      status = next;
    },
    // A click on a row: the same as moving to it and pressing Tab, so the line takes the row and the list ranks the new text.
    // `index` counts from the first ranked row, not the first drawn one.
    pick: (index: number) => {
      if (!completion?.rows[index] || !list_shown) return;
      // A container row stays selected, so Enter reads its store id and not its name, which can repeat.
      if (picking) return preview(index);
      fresh = false;
      cursor_after_close = undefined;
      preview(index);
      accept();
    },
    // The caret moved without a change to the text, for example by an arrow key or a click.
    set_caret: (next_caret: number) => {
      if (next_caret === caret) return;
      caret = next_caret;
      refresh();
    },
    // `command_id` is a leaf of the `cmdline` keymap. Ids this piece does not own do nothing.
    run: (command_id: string, args: Record<string, unknown> | undefined): Effect => {
      switch (command_id) {
        case "cmdline.submit":
          return submit(args?.where);
        case "cmdline.history":
          return walk_history(args?.direction);
        case "cmdline.next_completion":
          return cycle(1);
        case "cmdline.prev_completion":
          return cycle(-1);
        case "list.act":
          return act_on_rows(args?.action);
        case "list.select":
          if (args?.action !== "clear") return toggle_selected();
          selection.clear();
          return { kind: "render" };
        case "cmdline.help":
          return deps.search ? { kind: "render" } : help();
        case "cmdline.clear":
          fresh = false;
          replace_text("");
          caret = 0;
          cursor.reset();
          refresh();
          return { kind: "render" };
        case "mode.escape":
          if (picking) {
            leave_container_prompt();
            return { kind: "render" };
          }
          if (selection.size > 0 && on_tab_list()) {
            selection.clear();
            return { kind: "render" };
          }
          if (rows().length === 0) return { kind: "close" };
          list_shown = false;
          return { kind: "render" };
        default:
          return { kind: "render" };
      }
    },
  };
}

export type Session = ReturnType<typeof create_session>;
