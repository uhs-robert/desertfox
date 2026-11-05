// The Quick Start page text. Every key comes from the compiled keymap, so a rebind or an unbind changes the page.
// A key with no binding shows the command line that does the same thing, so no sentence loses its key.

import type { KeymapMode } from "../shared/keymap.ts";
import type { CommandMeta } from "../shared/command.ts";
import { is_context_source } from "../shared/registry/params.ts";
import { print_command } from "../shared/registry/print_command.ts";
import type { CompiledKeymap, TreeNode } from "../shared/prefix_tree.ts";
import type { Block, Inline } from "./blocks.ts";

type Args = Record<string, unknown>;

// `args` is the canonical form the command line fallback prints. `test` reads args with the registry defaults filled in.
type Binding = { mode: KeymapMode; id: string; args: Args; test: (args: Args) => boolean; prefer?: string };

// A user binding that spells out a default (`direction = "forward"`) and one that leaves it out mean the same, so both sides read the defaults.
function with_defaults(commands: CommandMeta[], id: string, args: Args | undefined): Args {
  const filled: Args = {};
  for (const param of commands.find((command) => command.id === id)?.params ?? []) {
    if (param.default !== undefined && !is_context_source(param.default)) filled[param.name] = param.default;
  }
  for (const [name, value] of Object.entries(args ?? {})) filled[name] = value;
  return filled;
}

// The token paths of every key that runs a matching invocation, shortest first. A `prefer` key wins when it is bound.
function key_paths(compiled: CompiledKeymap | undefined, commands: CommandMeta[], binding: Binding): string[][] {
  const found: string[][] = [];
  const walk = (node: TreeNode, path: string[]): void => {
    if (node.kind === "branch") {
      for (const [token, child] of Object.entries(node.children)) walk(child, [...path, token]);
    } else if (node.steps.some(({ invocation }) => invocation.id === binding.id && binding.test(with_defaults(commands, invocation.id, invocation.args)))) {
      found.push(path);
    }
  };
  const root = compiled?.modes[binding.mode];
  if (root) walk(root, []);
  const preferred = found.filter((path) => path.join("") === binding.prefer);
  return preferred.length > 0 ? preferred : found.sort((a, b) => a.join("").length - b.join("").length);
}

const arg_is = (name: string, value: unknown) => (args: Args): boolean => args[name] === value;
const all = (...tests: ((args: Args) => boolean)[]) => (args: Args): boolean => tests.every((test) => test(args));
const number_arg = (name: string, test: (value: number) => boolean) => (args: Args): boolean => typeof args[name] === "number" && test(args[name]);
const forward = (args: Args): boolean => args.direction !== "back";
const no_axis = (args: Args): boolean => args.axis === undefined || args.axis === "y";
const move = (unit: string, back: boolean, extra: Args = {}): Pick<Binding, "id" | "args" | "test"> => ({
  id: "caret.move",
  args: { unit, ...(back ? { direction: "back" } : {}), ...extra },
  test: (args) => args.unit === unit && (args.direction === "back") === back && args.big !== true,
});

const BINDINGS = {
  down: { mode: "normal", id: "scroll.lines", args: { count: 10 }, test: number_arg("count", (n) => n > 0) },
  up: { mode: "normal", id: "scroll.lines", args: { count: -10 }, test: number_arg("count", (n) => n < 0) },
  top: { mode: "normal", id: "scroll.to", args: { percent: 0 }, test: all(arg_is("percent", 0), no_axis) },
  bottom: { mode: "normal", id: "scroll.to", args: { percent: 100 }, test: all(arg_is("percent", 100), no_axis) },
  half_page: { mode: "normal", id: "scroll.pages", args: { fraction: 0.5 }, test: arg_is("fraction", 0.5) },
  hint: { mode: "normal", id: "hint.run", args: { action: "here" }, test: arg_is("action", "here") },
  hint_copy: { mode: "normal", id: "hint.run", args: { action: "copy", filter: "links" }, test: arg_is("action", "copy") },
  cmdline: { mode: "normal", id: "cmdline.open", args: {}, test: (args) => args.text === "" || args.text === undefined },
  find: { mode: "normal", id: "find.open", args: {}, test: all(arg_is("direction", "forward"), arg_is("source", "typed")) },
  find_back: { mode: "normal", id: "find.open", args: { direction: "backward" }, test: all(arg_is("direction", "backward"), arg_is("source", "typed")) },
  next: { mode: "normal", id: "find.next", args: {}, test: () => true },
  previous: { mode: "normal", id: "find.prev", args: {}, test: () => true },
  caret: { mode: "normal", id: "mode.set", args: { mode: "caret" }, test: arg_is("mode", "caret") },
  caret_at_element: { mode: "normal", id: "hint.run", args: { action: "caret", filter: "all" }, test: arg_is("action", "caret") },
  visual_at_element: { mode: "normal", id: "hint.run", args: { action: "visual", filter: "all" }, test: arg_is("action", "visual") },
  // Looked up in caret mode, because the sentence follows entering caret mode and `v` there starts visual mode.
  visual: { mode: "caret", id: "mode.set", args: { mode: "visual" }, test: arg_is("mode", "visual") },
  caret_left: { mode: "caret", ...move("char", true) },
  caret_right: { mode: "caret", ...move("char", false) },
  caret_down: { mode: "caret", ...move("line", false) },
  caret_up: { mode: "caret", ...move("line", true) },
  caret_word: { mode: "caret", ...move("word", false) },
  yank: { mode: "visual", id: "visual.act", args: { action: "yank" }, test: arg_is("action", "yank") },
  swap: { mode: "visual", id: "visual.act", args: { action: "swap" }, test: arg_is("action", "swap") },
  // `<C-[>` also escapes, but `<Escape>` is the key a reader knows.
  escape: { mode: "normal", id: "mode.escape", args: {}, test: () => true, prefer: "<Escape>" },
  help: { mode: "normal", id: "help.open", args: {}, test: () => true },
} satisfies Record<string, Binding>;

type BindingName = keyof typeof BINDINGS;

const NO_KEY = "(no key bound)";

// The command line that does the same as the binding, or undefined when the command has no name to type.
function command_line_of(commands: CommandMeta[], binding: Binding): string | undefined {
  const command = commands.find((candidate) => candidate.id === binding.id);
  return command?.name === undefined ? undefined : `:${print_command(command, binding.args, { flags: "long" })}`;
}

// Every command line the page can show in place of a key, for the test that each one resolves.
export function quick_start_fallbacks(commands: CommandMeta[]): { id: string; text: string }[] {
  return Object.values<Binding>(BINDINGS).flatMap((binding) => {
    const text = command_line_of(commands, binding);
    return text === undefined ? [] : [{ id: binding.id, text }];
  });
}

// Text, with `{name}` marking where a key goes and `[text]` a literal command or setting name.
function sentence(compiled: CompiledKeymap | undefined, commands: CommandMeta[], template: string): Inline[] {
  return template
    .split(/(\{[a-z_]+\}|\[[^\]]+\])/)
    .filter((part) => part !== "")
    .map((part): Inline => {
      if (part.startsWith("[")) return { kind: "code", text: part.slice(1, -1) };
      if (!part.startsWith("{")) return { kind: "text", text: part };
      const binding: Binding = BINDINGS[part.slice(1, -1) as BindingName];
      const [shortest] = key_paths(compiled, commands, binding);
      if (shortest) return { kind: "code", text: shortest.join("") };
      const command_line = command_line_of(commands, binding);
      return command_line === undefined ? { kind: "text", text: NO_KEY } : { kind: "code", text: command_line };
    });
}

// A key that opens a longer sequence, for the which-key example: the help key's own prefix, else the first group in the keymap.
function prefix_key(compiled: CompiledKeymap | undefined, commands: CommandMeta[]): string | undefined {
  const [help_path] = key_paths(compiled, commands, BINDINGS.help);
  if (help_path && help_path.length > 1) return help_path[0];
  const root = compiled?.modes.normal;
  return root?.kind === "branch" ? Object.entries(root.children).find(([, child]) => child.kind === "branch")?.[0] : undefined;
}

// The callout at the top of Home and Commands. The command line key follows the keymap like the Quick Start text.
export function tip_block(compiled: CompiledKeymap | undefined, commands: CommandMeta[] = []): Block {
  return { kind: "tip", inlines: sentence(compiled, commands, "Type [:help <name>] to jump to any command. Press {cmdline} to open the command line.") };
}

export function quick_start_blocks(compiled: CompiledKeymap | undefined, commands: CommandMeta[] = []): Block[] {
  const say = (template: string): Block => ({ kind: "paragraph", inlines: sentence(compiled, commands, template) });
  const prefix = prefix_key(compiled, commands);
  const heading = (text: string): Block => ({ kind: "heading", level: 2, text });
  return [
    say("OasisFox puts the browser on the keyboard. The keys on this page work as they do on any page, so try each one as you read. The key names come from your own keymap."),
    heading("Scroll"),
    say("Press {down} to scroll down and {up} to scroll up. {top} jumps to the top of the page and {bottom} to the bottom. {half_page} moves half a page."),
    heading("Click with hints"),
    say("Press {hint} to label every link and button on the page. Type the letters of a label to click it. Press {escape} to cancel."),
    say("Other hint keys pick other actions. For example, {hint_copy} copies the address of a link."),
    heading("The command line"),
    say("Press {cmdline} to open the command line. Type a command name, such as [open], and press Enter. Tab completes the name and its words. {escape} closes the line."),
    say("The Commands page lists every command and what it takes."),
    heading("Which-key"),
    say(
      prefix === undefined
        ? "Which-key lists the keys that can come next after a key that starts a longer sequence. Your keymap has no such key now. The wait is the [which_key_delay_ms] setting."
        : `Many keys start with a prefix. Press [${prefix}] and wait. A panel lists the keys that can come next, with a name for each. The wait is the [which_key_delay_ms] setting.`,
    ),
    heading("Search the page"),
    say("Press {find} to search forward and {find_back} to search backward. Type the text and press Enter. {next} jumps to the next match and {previous} to the one before."),
    heading("Caret mode and visual mode"),
    say("Caret mode puts a cursor in the page text, so you can move over text with the keyboard and select it. It starts after a search at the match, and otherwise at the first visible text."),
    say("Press {caret} to start caret mode. Move with {caret_left}, {caret_down}, {caret_up} and {caret_right}, or by word with {caret_word}. Press {visual} to start visual mode, which selects the text you move over. In visual mode, {yank} copies the selection and {swap} swaps its ends. {escape} steps back to the mode before."),
    say("To start at a link or another element, press {caret_at_element} for caret mode or {visual_at_element} for visual mode, then type the label of the element."),
    heading("Help"),
    say("Press {help} on any page to open this help. The Commands page lists every key, and the Home page shows your settings and any config warnings."),
  ];
}
