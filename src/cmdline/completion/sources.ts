// What the list offers at the caret: command rows, flag rows of the typed command and value rows. Each row carries
// the text to put in the line, the three list columns and the usage the note row shows.

import type { CommandMeta, Mode, ParamDef } from "../../shared/command.ts";
import type { EnumSources } from "../../shared/registry/check_shape.ts";
import { tokenize } from "../../shared/registry/command_line.ts";
import type { CommandLookup } from "../../shared/registry/command_line.ts";
import { first_sentence } from "../../shared/registry/summary.ts";
import { flag_alternatives, usage_line } from "../../shared/registry/usage.ts";
import { always_default, bare_word_param, default_of, flag_params, is_dynamic_values, positional_params, static_values, subject_param } from "../../shared/registry/params.ts";
import { rank } from "../../shared/score.ts";
import { completion_of, is_setting_name, SETTING_COMPLETION, type SettingCompletion } from "../../shared/setting_completion.ts";
import type { Ranked } from "../../shared/score.ts";
import type { BookmarkItem, EngineItem, HeadingItem, HistoryItems, OpenItems, OpenRow, SessionItem, TabContainer, TabItem, WindowItem } from "../../shared/messages.ts";
import type { LiveKind, LiveSource } from "./live.ts";
import { cursor_context } from "./tokenize.ts";
import type { CursorContext } from "./tokenize.ts";

export type TabFlag = "pinned" | "audible" | "muted" | "discarded";

// What a tab row draws before its name. `status` is `%` for the current tab, `#` for the alternate one and empty otherwise.
// `window_number` is present only when the list spans more than one window.
export type TabMarks = { id: number; status: string; flags: TabFlag[]; favicon?: string; container?: TabContainer; window_number?: number };

export type Row = {
  // The command id of a command row, which the keys column looks up. Flag, value and subject rows have none.
  id?: string;
  // Shown in the first column and matched first.
  name: string;
  // Replaces the word under the caret. It ends in a space unless the line goes on at once, as after `--param=`.
  insert: string;
  description: string;
  // The third column: flag names and the subject of a command, or the short form of a flag.
  args: string;
  // Other names typed for the same row, for example the dotted id behind a family word.
  also_named: string[];
  keywords: string[];
  // The note row shows it while this row is selected.
  usage: string;
  // An engine the line's page cannot fill. The list dims the row.
  unavailable?: boolean;
  // Where an `open` row came from, drawn as a dim cell: `bm` or `hist`.
  tag?: string;
  // Set on a tab row only. The list draws the cells before the name from it.
  tab?: TabMarks;
  // Set on a heading row only: how many levels it sits below the shallowest heading of the page. The list pads the name by it.
  indent?: number;
};

export type Completion = {
  rows: Ranked<Row>[];
  // The span of the saved text that a pick replaces.
  start: number;
  end: number;
  // Shown in the note row when no row is selected.
  usage?: string;
  // Whether a source applies here. An empty list then reads "no match".
  listing: boolean;
  // The rows wait for tabs or bookmarks that are still on their way.
  loading?: boolean;
};

const NO_COMPLETION: Completion = { rows: [], start: 0, end: 0, listing: false };

type Command = NonNullable<ReturnType<CommandLookup["find"]>>;

type Flag = { long: string; short: string | undefined; description: string; valued: boolean };

// One flag per `--` form that `flag_alternatives` lists, with the short forms before it.
// The value that is the default given the `typed` flags is the state without a flag, so only it is hidden.
function flags_of(command: Command, typed: Record<string, unknown>): (param: ParamDef) => Flag[] {
  return (param) => flags_for_param(param, default_of(command, param, typed));
}

function flags_for_param(param: ParamDef, resolved_default: unknown): Flag[] {
  const values = param.type === "enum" ? static_values(param)?.filter((value) => !always_default(param, value)) : undefined;
  const flags: Flag[] = [];
  let shorts: string[] = [];
  let form_index = 0;
  for (const form of flag_alternatives(param)) {
    if (!form.startsWith("--")) {
      shorts.push(form);
      continue;
    }
    const value = values?.[form_index++];
    if (value !== undefined && value === resolved_default) {
      shorts = [];
      continue;
    }
    const described = value === undefined ? param.description : typeof param.description === "object" ? param.description[value] : undefined;
    flags.push({
      long: form.split("=")[0] as string,
      short: shorts[0]?.split("=")[0],
      description: typeof described === "string" ? described : "",
      valued: form.includes("="),
    });
    shorts = [];
  }
  return flags;
}

function args_of(command: Command): string {
  const bare = bare_word_param(command);
  const subject = subject_param(command);
  const engine = bare && is_dynamic_values(bare.values) ? [`<${bare.name}>`] : [];
  return [...engine, ...flag_params(command).flatMap(flags_of(command, {})).map((flag) => flag.long), ...positional_params(command).map((param) => `<${param.name}>`), ...(subject ? [`<${subject.name}>`] : [])].join(" ");
}

// Whether the list offers the command on a line opened from `opened_from`.
export const is_listed = (command: Pick<CommandMeta, "completion">, opened_from: string): boolean =>
  command.completion === undefined || (command.completion !== "hidden" && command.completion.some((mode: Mode) => mode === opened_from));

export function command_rows(commands: readonly CommandMeta[], command_aliases: Readonly<Record<string, string>> = {}, opened_from = "normal"): Row[] {
  const configured = new Map<string, string[]>();
  for (const [alias, id] of Object.entries(command_aliases)) configured.set(id, [...(configured.get(id) ?? []), alias]);
  return commands
    .filter((command) => is_listed(command, opened_from))
    .map((command): Row => {
      const name = command.name ?? command.id;
      return {
        id: command.id,
        name,
        insert: command.params?.length ? `${name} ` : name,
        description: first_sentence(command.intent),
        args: args_of(command),
        also_named: command.name ? [command.id] : [],
        keywords: [...(command.aliases ?? []), ...(configured.get(command.id) ?? []), command.label],
        usage: usage_line(command),
      };
    })
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

function flag_rows(command: Command, typed: Record<string, unknown>): Row[] {
  const usage = usage_line(command);
  return flag_params(command).flatMap(flags_of(command, typed)).map((flag) => {
    const equals = flag.valued ? "=" : "";
    const long = `${flag.long}${equals}`;
    const short = flag.short ? `${flag.short}${equals}` : undefined;
    return {
      // Both forms are the name, so a typed short flag finds its row and an exact one ranks first.
      name: short ? `${long} ${short}` : long,
      insert: flag.valued ? long : `${long} `,
      description: flag.description,
      args: "",
      also_named: short ? [long, short] : [],
      keywords: [],
      usage,
    };
  });
}

// A value with a space or a quote would split into two words, so it goes in double quotes.
const quote_word = (value: string) => (/[\s"'\\]/.test(value) ? `"${value.replace(/(["\\$`])/g, "\\$1")}"` : value);

function value_rows(command: Command, param: ParamDef, sources: EnumSources): Row[] {
  const values = is_dynamic_values(param.values) ? (param.values.from === "containers" ? (sources.containers ?? []) : []) : (static_values(param) ?? []);
  const usage = usage_line(command);
  return values.map((value) => ({
    name: value,
    insert: `${quote_word(value)} `,
    description: param.value_labels?.[value] ?? "",
    args: "",
    also_named: [],
    keywords: [],
    usage,
  }));
}

// `set`, `toggle` and `unset` take setting names first. The words after the name of a setting that lists values offer those values.
function setting_rows(context: Extract<CursorContext, { kind: "subject" }>, text: string, usage: string): Row[] | undefined {
  const command_id = context.command.id;
  if (command_id !== "settings.set" && command_id !== "settings.unset" && command_id !== "settings.toggle") return undefined;
  const row = (name: string, insert: string, description: string): Row => ({ name, insert, description, args: "", also_named: [], keywords: [], usage });
  if (context.position === 0) {
    const wanted = (setting: SettingCompletion) => setting.settable && (command_id !== "settings.toggle" || setting.is_toggle);
    const names = SETTING_COMPLETION.filter(wanted).map((setting) => row(setting.name, `${setting.name} `, setting.expectation));
    return command_id === "settings.unset" ? [row("all", "all ", "Drop every live change."), ...names] : names;
  }
  const typed = tokenize(text.slice(0, context.start));
  const setting = Array.isArray(typed) ? typed[1]?.text : undefined;
  if (command_id !== "settings.set" || setting === undefined || !is_setting_name(setting)) return [];
  const spec = completion_of(setting);
  if (context.position > 1 && !spec.is_list) return [];
  const after = tokenize(text.slice(context.end));
  const other_words = [...(Array.isArray(typed) ? typed.slice(2) : []), ...(Array.isArray(after) ? after : [])];
  // Split on whitespace as `parse_setting_text` does: a quoted token can hold several items.
  const already_typed = new Set(other_words.flatMap((token) => token.text.split(/\s+/)));
  return spec.values.filter((value) => !already_typed.has(value)).map((value) => row(value, `${quote_word(value)} `, ""));
}

// With no word typed, the bookmark list shows this many of the newest.
const RECENT_BOOKMARKS = 20;

function open_rows(rows: readonly OpenRow[], usage: string): Row[] {
  return rows.map((row) => ({ name: row.title, insert: `${quote_word(row.url)} `, description: row.url, args: "", also_named: [], keywords: [], usage, tag: row.tag }));
}

// With no word, each group keeps its newest rows: 20 bookmarks and the history cap that came with the rows.
// The background sends the groups in setting order. A typed word ranks by score, so a stable sort on the group puts the groups back in that order.
function open_ranked(word: string, rows: Row[], items: OpenItems): Ranked<Row>[] {
  const group_order = [...new Set(rows.map((row) => row.tag))];
  if (word.trim() !== "") return rank(word, rows).sort((left, right) => group_order.indexOf(left.tag) - group_order.indexOf(right.tag));
  const caps: Record<string, number> = { bm: RECENT_BOOKMARKS, hist: items.history_max };
  const shown: Record<string, number> = {};
  return rank(word, rows).filter((row) => (shown[row.tag as string] = (shown[row.tag as string] ?? 0) + 1) <= (caps[row.tag as string] ?? Infinity));
}

const FLAGS: TabFlag[] = ["pinned", "audible", "muted", "discarded"];

const omit_window = ({ window_number, ...marks }: TabMarks): TabMarks => marks;

export const marks_of = (tab: TabItem): TabMarks => ({
  id: tab.id,
  status: tab.active ? "%" : tab.alternate ? "#" : "",
  flags: FLAGS.filter((flag) => tab[flag]),
  ...(tab.favicon ? { favicon: tab.favicon } : {}),
  ...(tab.container ? { container: tab.container } : {}),
  ...(tab.window_number === undefined ? {} : { window_number: tab.window_number }),
});

// The number first, so a typed `3` finds the tab at place 3 of the tab bar. The pick puts the number and title in the
// line and the handler reads the leading number. A title with a quote is quoted whole, or the line would not parse.
function tab_rows(tabs: readonly TabItem[], usage: string): Row[] {
  const spans_windows = new Set(tabs.map((tab) => tab.window_number)).size > 1;
  return tabs.map((tab) => ({
    name: `${tab.number}: ${tab.title}`,
    tab: spans_windows ? marks_of(tab) : omit_window(marks_of(tab)),
    insert: `${tab.number} ${/["'\\]/.test(tab.title) ? quote_word(tab.title) : tab.title} `,
    description: tab.url,
    args: "",
    also_named: [],
    keywords: [],
    usage,
  }));
}

// The number first, as in a tab row, so the handler reads the leading number and a typed `2` finds window 2.
function window_rows(windows: readonly WindowItem[], usage: string): Row[] {
  return windows.map((window) => ({
    name: `${window.number} ${window.title}`,
    insert: `${window.number} ${/["'\\]/.test(window.title) ? quote_word(window.title) : window.title} `,
    description: "",
    args: "",
    also_named: [],
    keywords: [],
    usage,
  }));
}

// The name is the whole subject, so the handler matches it as typed. Newest first is the order the background sends, and an empty word keeps it.
function session_rows(sessions: readonly SessionItem[], usage: string): Row[] {
  return sessions.map((session) => ({
    name: session.name,
    insert: `${/["'\\]/.test(session.name) ? quote_word(session.name) : session.name} `,
    description: session.description,
    args: "",
    also_named: [],
    keywords: [],
    usage,
  }));
}

// The place first, as in a tab row, so the handler reads the leading number and the pick still finds the heading after the page changed its text.
// The name is the plain text, because the highlight positions count its letters. Indent counts from the shallowest level on the page, so a page without an h1 loses no width.
function heading_rows(headings: readonly HeadingItem[], usage: string): Row[] {
  const top_level = Math.min(...headings.map((heading) => heading.level));
  return headings.map((heading, index) => ({
    name: heading.text,
    insert: `${index + 1} ${/["'\\]/.test(heading.text) ? quote_word(heading.text) : heading.text} `,
    description: `h${heading.level}`,
    args: "",
    also_named: [],
    keywords: [],
    usage,
    indent: heading.level - top_level,
  }));
}

function bookmark_rows(bookmarks: readonly BookmarkItem[], usage: string): Row[] {
  return bookmarks.map((bookmark) => ({ name: bookmark.title, insert: `${quote_word(bookmark.url)} `, description: bookmark.url, args: "", also_named: [], keywords: [], usage }));
}

// `engine.show` works on any engine, so only a search marks the ones the page cannot fill.
function engine_rows(engines: readonly EngineItem[], usage: string, marks_unavailable: boolean, word: string): Row[] {
  // A word that ends in a dot names a family, so only its engines are ranked.
  const family = word.endsWith(".") ? engines.filter((engine) => engine.name.startsWith(word)) : engines;
  return family.map((engine) => {
    const unavailable = marks_unavailable && !engine.available;
    return {
      name: engine.name,
      insert: `${quote_word(engine.name)} `,
      description: engine.label,
      args: unavailable ? "unavailable" : "",
      also_named: [],
      keywords: [],
      usage,
      ...(unavailable ? { unavailable } : {}),
    };
  });
}

const live_kind_of = (param: ParamDef | undefined): LiveKind | undefined => {
  if (!param || !is_dynamic_values(param.values)) return undefined;
  const from = param.values.from;
  return from === "tabs" || from === "bookmarks" || from === "history" || from === "open" || from === "windows" || from === "headings" || from === "sessions" ? from : from === "search_engines" ? "engines" : undefined;
};

// The engine takes the first word of `search`, ahead of the query that follows it.
function first_word_param(command: Command, engine_settled: boolean): ParamDef | undefined {
  const bare = bare_word_param(command);
  return !engine_settled && bare && is_dynamic_values(bare.values) && bare.values.from === "search_engines" ? bare : (subject_param(command) ?? bare);
}

// The completer reads the commands once, so each keystroke only ranks.
// `live` supplies the tabs, bookmarks and engines. Without it those subjects list nothing.
export function create_completer(
  lookup: CommandLookup,
  commands: readonly CommandMeta[],
  command_aliases: Readonly<Record<string, string>>,
  sources: EnumSources,
  opened_from = "normal",
  live?: Pick<LiveSource, "read">,
) {
  const all_commands = command_rows(commands, command_aliases, opened_from);
  return (text: string, caret: number): Completion => {
    const context = cursor_context(text, caret, lookup.find);
    if (context.kind === "none") return NO_COMPLETION;
    const span = { start: context.start, end: context.end };
    if (context.kind === "command") return { ...span, rows: rank(context.word, all_commands), listing: true };
    const usage = usage_line(context.command);
    if (context.kind === "flag") return { ...span, usage, rows: rank(context.word, flag_rows(context.command, context.typed)), listing: true };
    const settings = context.kind === "subject" ? setting_rows(context, text, usage) : undefined;
    if (settings) return { ...span, usage, rows: rank(context.word, settings), listing: settings.length > 0 };
    const param = context.kind === "flag_value" ? context.param : context.position === 0 ? first_word_param(context.command, context.engine_settled) : undefined;
    const kind = live_kind_of(param);
    if (kind && live) {
      const read = live.read(kind);
      if (read.loading) return { ...span, usage, rows: [], listing: true, loading: true };
      if (kind === "open") {
        const items = read.items as OpenItems;
        return { ...span, usage, rows: open_ranked(context.word, open_rows(items.rows, usage), items), listing: true };
      }
      if (kind === "history") {
        const items = read.items as HistoryItems;
        const ranked = rank(context.word, bookmark_rows(items.rows, usage));
        return { ...span, usage, rows: context.word.trim() === "" ? ranked.slice(0, items.max) : ranked, listing: true };
      }
      const rows =
        kind === "tabs"
          ? tab_rows(read.items as TabItem[], usage)
          : kind === "engines"
            ? engine_rows(read.items as EngineItem[], usage, context.command.id !== "engine.show", context.word)
            : kind === "windows"
              ? window_rows(read.items as WindowItem[], usage)
              : kind === "headings"
                ? heading_rows(read.items as HeadingItem[], usage)
                : kind === "sessions"
                  ? session_rows(read.items as SessionItem[], usage)
                  : bookmark_rows(read.items as BookmarkItem[], usage);
      const ranked = rank(context.word, rows);
      return { ...span, usage, rows: kind === "bookmarks" && context.word.trim() === "" ? ranked.slice(0, RECENT_BOOKMARKS) : ranked, listing: true };
    }
    const rows = param ? value_rows(context.command, param, sources) : [];
    return { ...span, usage, rows: rank(context.word, rows), listing: rows.length > 0 };
  };
}
