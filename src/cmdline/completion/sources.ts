// What the list offers at the caret: command rows, flag rows of the typed command and value rows. Each row carries
// the text to put in the line, the three list columns and the usage the note row shows.

import type { CommandMeta, Mode, ParamDef } from "../../shared/command.ts";
import { first_sentence, flag_alternatives, usage_line } from "../../shared/registry/index.ts";
import type { CommandLookup, EnumSources } from "../../shared/registry/index.ts";
import { bare_word_param, flag_params, is_dynamic_values, static_values, subject_param } from "../../shared/registry/params.ts";
import { rank } from "../../shared/score.ts";
import type { Ranked } from "../../shared/score.ts";
import type { BookmarkItem, EngineItem, TabItem } from "../../shared/messages.ts";
import type { LiveKind, LiveSource } from "./live.ts";
import { cursor_context } from "./tokenize.ts";

export type Row = {
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
function flags_of(param: ParamDef): Flag[] {
  const values = param.type === "enum" ? static_values(param)?.filter((value) => value !== param.default) : undefined;
  const flags: Flag[] = [];
  let shorts: string[] = [];
  for (const form of flag_alternatives(param)) {
    if (!form.startsWith("--")) {
      shorts.push(form);
      continue;
    }
    const value = values?.[flags.length];
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
  return [...engine, ...flag_params(command).flatMap(flags_of).map((flag) => flag.long), ...(subject ? [`<${subject.name}>`] : [])].join(" ");
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

function flag_rows(command: Command): Row[] {
  const usage = usage_line(command);
  return flag_params(command).flatMap(flags_of).map((flag) => {
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

// With no word typed, the bookmark list shows this many of the newest.
const RECENT_BOOKMARKS = 20;

// The number first, so a typed `3` finds the tab at place 3 of the tab bar. The pick puts the number and title in the
// line and the handler reads the leading number. A title with a quote is quoted whole, or the line would not parse.
function tab_rows(tabs: readonly TabItem[], usage: string): Row[] {
  return tabs.map((tab) => ({
    name: `${tab.number} ${tab.title}`,
    insert: `${tab.number} ${/["'\\]/.test(tab.title) ? quote_word(tab.title) : tab.title} `,
    description: tab.url,
    args: "",
    also_named: [],
    keywords: [],
    usage,
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
  return from === "tabs" || from === "bookmarks" ? from : from === "search_engines" ? "engines" : undefined;
};

// The engine takes the first word of `search`, ahead of the query that follows it.
function first_word_param(command: Command): ParamDef | undefined {
  const bare = bare_word_param(command);
  return bare && is_dynamic_values(bare.values) && bare.values.from === "search_engines" ? bare : (subject_param(command) ?? bare);
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
    if (context.kind === "flag") return { ...span, usage, rows: rank(context.word, flag_rows(context.command)), listing: true };
    const param = context.kind === "flag_value" ? context.param : context.position === 0 ? first_word_param(context.command) : undefined;
    const kind = live_kind_of(param);
    if (kind && live) {
      const read = live.read(kind);
      if (read.loading) return { ...span, usage, rows: [], listing: true, loading: true };
      const rows =
        kind === "tabs"
          ? tab_rows(read.items as TabItem[], usage)
          : kind === "engines"
            ? engine_rows(read.items as EngineItem[], usage, context.command.id !== "engine.show", context.word)
            : bookmark_rows(read.items as BookmarkItem[], usage);
      const ranked = rank(context.word, rows);
      return { ...span, usage, rows: kind === "bookmarks" && context.word.trim() === "" ? ranked.slice(0, RECENT_BOOKMARKS) : ranked, listing: true };
    }
    const rows = param ? value_rows(context.command, param, sources) : [];
    return { ...span, usage, rows: rank(context.word, rows), listing: rows.length > 0 };
  };
}
