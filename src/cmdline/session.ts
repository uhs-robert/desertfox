// The state of one open command line, apart from the DOM: the text, the inline message, the completion list and the
// history walk. A key from the keymap arrives as a command id and becomes an effect for the page to carry out.

import type { Invocation } from "../shared/invocation.ts";
import type { ParseResult } from "../shared/registry/index.ts";
import type { Completion, TabMarks } from "./completion/sources.ts";
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
  // `list.act --action=unload` on a tab row: the page asks the background to flip it, then calls `patch_tab`.
  | { kind: "set_tab_unloaded"; tab_id: number; unloaded: boolean };

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
  // The text and caret the list was ranked for. While a row is previewed, `text` differs from it.
  let saved: { text: string; caret: number } | undefined;

  const replace_text = (next: string) => {
    text = next;
    message = undefined;
  };

  const rows = () => (completion && list_shown ? completion.rows : NO_ROWS);

  // New typed text ends any preview: the list ranks what is now in the line.
  const refresh = () => {
    completion = deps.complete?.(text, caret);
    list_shown = true;
    selected = -1;
    saved = undefined;
  };

  // The line shows the row in place of the span the list was ranked for.
  const preview = (index: number) => {
    const row = completion?.rows[index];
    if (!completion || !row) return;
    const base = (saved ??= { text, caret });
    selected = index;
    replace_text(base.text.slice(0, completion.start) + row.insert + base.text.slice(completion.end));
    caret = completion.start + row.insert.length;
  };

  // Shown under a search line in place of the usage.
  let status = "";

  const submit = (): Effect => {
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
    const problem = deps.precheck?.(parsed.invocation);
    if (problem !== undefined) {
      message = problem;
      return { kind: "render" };
    }
    return { kind: "submit", invocation: parsed.invocation, text: line };
  };

  // Tab and Shift-Tab wrap around. A single match goes into the line at once, and then the list ranks the new text.
  const cycle = (step: 1 | -1): Effect => {
    fresh = false;
    if (!completion) refresh();
    list_shown = true;
    const count = completion?.rows.length ?? 0;
    if (count === 1 && selected < 0) {
      preview(0);
      refresh();
    } else if (count > 0) preview(selected < 0 ? (step === 1 ? 0 : count - 1) : (selected + step + count) % count);
    return { kind: "render" };
  };

  // Up and Down stop at the ends. They never leave the list for the history.
  const step_selection = (direction: unknown): Effect => {
    const count = rows().length;
    preview(direction === "next" ? Math.min(selected + 1, count - 1) : selected < 0 ? count - 1 : Math.max(selected - 1, 0));
    return { kind: "render" };
  };

  // The selected row decides. With none selected, the command word already typed does.
  const help = (): Effect => {
    const row = completion?.rows[selected];
    const word = text.replace(/^[\s:]+/, "").split(/\s/, 1)[0] ?? "";
    // A history recall leaves `selected` set with no row behind it, so the row decides, not the index.
    const command_id = row ? row.id : deps.command_id_of?.(word);
    if (command_id !== undefined && (deps.has_help?.(command_id) ?? true)) return { kind: "help", command_id };
    message = row ? "this row has no command help" : "no command to show help for";
    return { kind: "render" };
  };

  // The highlighted row decides. A history recall leaves `selected` set with no row behind it, so the row is read, not the index.
  const act_on_row = (): Effect => {
    const marks = rows()[selected]?.tab;
    if (!marks) {
      message = "select a tab row first";
      return { kind: "render" };
    }
    return { kind: "set_tab_unloaded", tab_id: marks.id, unloaded: !marks.flags.includes("discarded") };
  };

  const walk_history = (direction: unknown): Effect => {
    if (deps.search) return { kind: "render" };
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
    // The rows to draw: none while the list is closed.
    get_rows: rows,
    get_selected: () => selected,
    // For the note row: the selected row's usage, else "no match" for an empty list, else the typed command's usage.
    get_hint: (): string | undefined => {
      if (deps.search) return status;
      const row = completion?.rows[selected];
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
    // Tabs or bookmarks arrived. The list ranks the typed text again. A closed list stays closed, and a previewed row stays.
    source_ready: () => {
      if (selected >= 0 || !completion) return;
      completion = deps.complete?.(text, caret);
    },
    // The background changed a tab: its row takes the new marks in place, so the selection and the window stay.
    patch_tab: (marks: TabMarks) => {
      for (const row of completion?.rows ?? []) if (row.tab?.id === marks.id) row.tab = marks;
    },
    set_message: (next: string) => {
      message = next;
    },
    set_status: (next: string) => {
      status = next;
    },
    // A click on a row: the same as moving to it and pressing Tab, so the line takes the row and the list ranks the new text.
    // `index` counts from the first ranked row, not the first drawn one.
    pick: (index: number) => {
      if (!completion?.rows[index] || !list_shown) return;
      fresh = false;
      preview(index);
      refresh();
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
          return submit();
        case "cmdline.history":
          return walk_history(args?.direction);
        case "cmdline.next_completion":
          return cycle(1);
        case "cmdline.prev_completion":
          return cycle(-1);
        case "list.act":
          return act_on_row();
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
