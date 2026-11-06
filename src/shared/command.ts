// Command definition: the one shape the registry stores, the validator checks
// and `commands.json` is cut from. Types, plus the list of runtime modes.

import type { Outcome } from "./messages.ts";

export type ParamType = "int" | "float" | "string" | "bool" | "enum";

// Runtime modes. `browser` is not here: it is a keymap section, see KeymapMode.
export const MODES = ["normal", "insert", "ignore", "hint", "cmdline", "caret", "visual"] as const;
export type Mode = (typeof MODES)[number];

export type RunsIn = "background" | "content";

export type ContextSourceName = "current_url" | "selection" | "clipboard";

export type ContextSource = { from: ContextSourceName };

export type ParamValue = string | number | boolean;

// The param is valid only if the named sibling param has one of these values.
export type ParamWhen = Record<string, readonly ParamValue[]>;

// One arm of a default list: its value is the default while every named sibling param has one of its listed values.
export type DefaultArm = { value: ParamValue; when: ParamWhen };

// A plain value, a context source, or an ordered list of arms with an optional plain value last. The first arm that holds wins, else the last value applies, else the param has no default and is required.
export type ParamDefault = ParamValue | ContextSource | readonly (DefaultArm | ParamValue)[];

// Value lists filled at run time from the user's config or from Firefox. `tabs`, `bookmarks`, `windows` and `headings` go on a string param and
// only feed the completion list. The page asks the background for the first three (`complete_items`) and the host script for the headings, nobody checks a typed value against them.
export type DynamicValues = { from: "search_engines" | "containers" | "tabs" | "bookmarks" | "open" | "windows" | "headings" };

export type ParamDef = {
  name: string;
  type: ParamType;
  // Allowed values. Required for `enum`. A `string` param uses it for completion, and for membership when `strict`.
  values?: readonly string[] | DynamicValues;
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
  // A param with no default that applies, no `optional` and no `when` is required.
  default?: ParamDefault;
  // A `string` or `enum` param that may be left out or empty: it then reads as "". Stands for `default: ""`.
  optional?: boolean;
  // Smallest value of an `int` param.
  min?: number;
  // A `string` param whose text must match this regular expression (source text, so it travels in `commands.json`). An optional param may still be empty.
  pattern?: string;
  // A `string` param with a static `values` list accepts only those values, compared exactly like an enum value. Without it the list is for completion only.
  strict?: boolean;
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

export type CommandDef = {
  // `group.name`, lowercase with underscores.
  id: string;
  // Command line name, set by hand, never derived from the id.
  name?: string;
  aliases?: readonly string[];
  label: string;
  intent: string;
  params?: readonly ParamDef[];
  runs_in: RunsIn;
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
  run: CommandRun;
};

// A `commands.json` entry: the definition without the handler and the router fields.
export type CommandMeta = Pick<
  CommandDef,
  "id" | "name" | "aliases" | "label" | "intent" | "params" | "count" | "modes" | "completion"
>;

export type CommandsFile = {
  format_version: 1;
  commands: CommandMeta[];
};
