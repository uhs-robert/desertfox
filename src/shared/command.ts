// Command definition: the one shape the registry stores, the validator checks
// and `commands.json` is cut from. Types, plus the list of runtime modes.

export type ParamType = "int" | "float" | "string" | "bool" | "enum";

// Runtime modes. `browser` is not here: it is a keymap section, see KeymapMode.
export const MODES = ["normal", "insert", "ignore", "hint", "cmdline", "caret", "visual"] as const;
export type Mode = (typeof MODES)[number];

export type RunsIn = "background" | "content";

export type ContextSourceName = "current_url" | "selection" | "clipboard";

export type ContextSource = { from: ContextSourceName };

export type ParamValue = string | number | boolean;

export type ParamDefault = ParamValue | ContextSource;

// Value lists filled at run time from the user's config or from Firefox.
export type DynamicValues = { from: "search_engines" | "containers" };

// The param is valid only if the named sibling param has one of these values.
export type ParamWhen = Record<string, readonly ParamValue[]>;

export type ParamDef = {
  name: string;
  type: ParamType;
  // Allowed values. Required for `enum`. A `string` param may use it for completion only.
  values?: readonly string[] | DynamicValues;
  // Which-key phrase per enum value, added to the command label when a binding sets that value. The default value has none. A value missing here reads as the raw value with spaces for underscores.
  value_labels?: Readonly<Record<string, string>>;
  // A `string` param that takes all remaining words.
  rest?: boolean;
  // The one free-text param that config and the command line take as a bare word. At most one per command, `string` only.
  main?: boolean;
  // A param with no default and no `when` is required.
  default?: ParamDefault;
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

// Args reach `run` after the one validator has checked them and filled defaults.
export type CheckedArgs = Record<string, unknown>;

export type CommandRun = (ctx: CommandContext, args: CheckedArgs) => Promise<void> | void;

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
  run: CommandRun;
};

// A `commands.json` entry: the definition without the handler and the router fields.
export type CommandMeta = Pick<
  CommandDef,
  "id" | "name" | "aliases" | "label" | "intent" | "params" | "count" | "modes"
>;

export type CommandsFile = {
  format_version: 1;
  commands: CommandMeta[];
};
