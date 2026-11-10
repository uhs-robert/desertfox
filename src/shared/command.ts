// Command definition: the one shape the registry stores, the validator checks
// and `commands.json` is cut from. Types, plus the list of runtime modes.

import type { BundleName } from "./bundles.ts";
import type { Outcome } from "./messages.ts";

// `key` is one key press. A key binding that leaves a required `key` param out captures the next key into it.
export type ParamType = "int" | "float" | "string" | "bool" | "enum" | "key";

// Runtime modes. `browser` is not here: it is a keymap section, see KeymapMode.
export const MODES = ["normal", "insert", "ignore", "hint", "cmdline", "caret", "visual", "visual_line"] as const;
export type Mode = (typeof MODES)[number];

// The reading modes: a caret in the page text, with or without a selection.
const CARET_MODES: readonly Mode[] = ["caret", "visual", "visual_line"];
export const is_caret_mode = (mode: Mode): boolean => CARET_MODES.includes(mode);

export type RunsIn = "background" | "content";

export type ContextSourceName = "current_url" | "selection" | "clipboard" | "bookmark_title";

export type ContextSource = { from: ContextSourceName };

export type ParamValue = string | number | boolean;

// The param is valid only if the named sibling param has one of these values.
export type ParamWhen = Record<string, readonly ParamValue[]>;

// One arm of a default list: its value is the default while every named sibling param has one of its listed values.
export type DefaultArm = { value: ParamValue; when: ParamWhen };

// A plain value, a context source, or an ordered list of arms with an optional plain value last. The first arm that holds wins, else the last value applies, else the param has no default and is required.
export type ParamDefault = ParamValue | ContextSource | readonly (DefaultArm | ParamValue)[];

// Value lists filled at run time from the user's config or from Firefox. `tabs`, `bookmarks`, `history`, `windows`, `headings`, `sessions`, `registers` and `folders` go on a string param and
// only feed the completion list. The page asks the background for the first three (`complete_items`) and the host script for the headings, nobody checks a typed value against them.
export type DynamicValues = { from: "search_engines" | "containers" | "tabs" | "bookmarks" | "history" | "open" | "windows" | "headings" | "sessions" | "registers" | "folders" };

export type ParamDef = {
  name: string;
  type: ParamType;
  // Allowed values. Required for `enum`. A `string` param uses it for completion, and for membership when `strict`.
  values?: readonly string[] | DynamicValues;
  // Per enum value, the sibling values under which that value is allowed, in the syntax of `when` but with several siblings (all must hold). A value with no entry is allowed everywhere. `check_args` checks the final value, explicit or default.
  value_when?: Readonly<Record<string, ParamWhen>>;
  // Which-key phrase per enum value, added to the command label when a binding sets that value. The default value has none. A value missing here reads as the raw value with spaces for underscores.
  value_labels?: Readonly<Record<string, string>>;
  // One-letter flag. A string for a bool or valued param (`-r`, `-c=Work`), a value-to-letter map for a static enum (`{ tab: "t" }` gives `-t`). Never on main, rest or a dynamic enum.
  short?: string | Readonly<Record<string, string>>;
  // What the flag does, one sentence with the verb first (`Close the tabs after this one.`). A string for a bool or valued param, a value-to-sentence map for a static enum. Every flag of a built-in command has one. The completion list shows it.
  description?: string | Readonly<Record<string, string>>;
  // A `string` param that takes all remaining words.
  rest?: boolean;
  // The one free-text param that config and the command line take as a bare word. At most one per command, `string` only.
  main?: boolean;
  // On the `main` param: it takes the raw typed text from its first word to the end of the line, end-trimmed, with quotes and backslashes kept. Flags must come before it, and a value that starts with `-` needs `--` first. For text the shell rules would mangle, such as a CSS selector.
  verbatim?: boolean;
  // A param with no default that applies, no `optional` and no `when` is required.
  default?: ParamDefault;
  // A `string` or `enum` param that may be left out or empty: it then reads as "". Stands for `default: ""`.
  optional?: boolean;
  // Smallest value of an `int` param.
  min?: number;
  // A `string` or `key` param whose text must match this regular expression (source text, so it travels in `commands.json`). An optional param may still be empty.
  pattern?: string;
  // A `string` param with a static `values` list accepts only those values, compared exactly like an enum value. Without it the list is for completion only.
  strict?: boolean;
  // A `string` param whose text must be an absolute address, as `URL.canParse` reads it. An optional param may still be empty.
  format?: "url";
  // A `string` param that holds the value of the setting named by the sibling param of this name. `check_args` checks it with that setting's entry in `SETTING_SPECS`. An empty value passes.
  value_of?: string;
  // Exactly one key, so `{ param: [values] }`.
  when?: ParamWhen;
};

export type CountBehavior =
  | "repeat" // run the command that many times
  | "ignore" // drop the count
  | { param: string }; // fill this param with the count

// "content": a content script must run in the tab. Any other string is an optional permission name.
export type Need = "content" | (string & {});

export type CommandContext = {
  tab_id: number | undefined;
  window_id: number | undefined;
  frame_id: number;
  mode: Mode;
};

// What a handler throws for a failure that depends on the state of the browser or the config, such as a tab that is gone or a search engine the config lacks. A bad argument value is never one of these: the param schema rules it out before the handler runs.
export class RuntimeRefusal extends Error {
  override name = "RuntimeRefusal";
}

// Args reach `run` after the one validator has checked them and filled defaults.
export type CheckedArgs = Record<string, unknown>;

// A content command may answer with an Outcome, or a promise of one that stays pending while it waits on the user. A background command returns nothing.
export type CommandRun = (ctx: CommandContext, args: CheckedArgs) => Promise<void | Outcome> | void | Outcome;

type CommandCommon = {
  // `group.name`, lowercase with underscores.
  id: string;
  // Command line name, set by hand, never derived from the id.
  name?: string;
  aliases?: readonly string[];
  label: string;
  intent: string;
  params?: readonly ParamDef[];
  needs?: readonly Need[];
  // Absent means "ignore". The registry applies this default.
  count?: CountBehavior;
  // Modes where a key can run the command. Default when omitted: ["normal"].
  modes?: readonly Mode[];
  // Where the command line list offers the command. Absent means always. "hidden" means never, for a command that
  // makes no sense typed. A list of modes means only when the line was opened from one of them. Typing the name still runs it.
  completion?: "hidden" | readonly Mode[];
  // Absent means true. `.` replays only a repeatable background command, so false keeps a command out of the memory.
  repeatable?: boolean;
};

export type BackgroundCommandDef = CommandCommon & { runs_in: "background"; run: CommandRun; bundle?: undefined };

// The code of a content command lives in the page: `content_handlers` in the content script, or a lazy bundle named by `bundle`. The definition holds no `run`.
export type ContentCommandDef = CommandCommon & {
  runs_in: "content";
  // The lazy bundle that holds the code. The content script loads it on the first run and asks it for the handler.
  bundle?: BundleName;
  run?: undefined;
};

export type CommandDef = BackgroundCommandDef | ContentCommandDef;

// A `commands.json` entry: the definition without the handler and the router fields.
export type CommandMeta = Pick<
  CommandDef,
  "id" | "name" | "aliases" | "label" | "intent" | "params" | "count" | "modes" | "completion"
>;

export type CommandsFile = {
  format_version: 1;
  commands: CommandMeta[];
};
