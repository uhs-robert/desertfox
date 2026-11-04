// The Quick Start page text. Every key comes from the compiled keymap, so a rebind or an unbind changes the page.
// A key with no binding shows the command line that does the same thing, so no sentence loses its key.

import type { KeymapMode } from "../shared/keymap.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import type { CompiledKeymap, TreeNode } from "../shared/prefix_tree.ts";
import type { Block, Inline } from "./blocks.ts";

type Binding = { mode: KeymapMode; matches: (invocation: BoundInvocation) => boolean; fallback: string };

// The token paths of every key that runs a matching invocation, shortest first.
function key_paths(compiled: CompiledKeymap | undefined, binding: Binding): string[][] {
  const found: string[][] = [];
  const walk = (node: TreeNode, path: string[]): void => {
    if (node.kind === "branch") {
      for (const [token, child] of Object.entries(node.children)) walk(child, [...path, token]);
    } else if (node.steps.some((step) => binding.matches(step.invocation))) {
      found.push(path);
    }
  };
  const root = compiled?.modes[binding.mode];
  if (root) walk(root, []);
  return found.sort((a, b) => a.join("").length - b.join("").length);
}

const is = (id: string, args: (args: Record<string, unknown>) => boolean = () => true) =>
  (invocation: BoundInvocation): boolean => invocation.id === id && args(invocation.args ?? {});
const no_args = (args: Record<string, unknown>): boolean => Object.keys(args).length === 0;
const number_arg = (name: string, test: (value: number) => boolean) => (args: Record<string, unknown>): boolean => typeof args[name] === "number" && test(args[name]);
const arg_is = (name: string, value: unknown) => (args: Record<string, unknown>): boolean => args[name] === value;

const BINDINGS = {
  down: { mode: "normal", matches: is("scroll.lines", number_arg("count", (n) => n > 0)), fallback: ":scroll" },
  up: { mode: "normal", matches: is("scroll.lines", number_arg("count", (n) => n < 0)), fallback: ":scroll" },
  top: { mode: "normal", matches: is("scroll.to", (args) => args.percent === 0 && args.axis === undefined), fallback: ":scroll" },
  bottom: { mode: "normal", matches: is("scroll.to", (args) => args.percent === 100 && args.axis === undefined), fallback: ":scroll" },
  half_page: { mode: "normal", matches: is("scroll.pages", number_arg("fraction", (n) => n === 0.5)), fallback: ":scroll" },
  hint: { mode: "normal", matches: is("hint.run", arg_is("action", "here")), fallback: ":hint" },
  hint_copy: { mode: "normal", matches: is("hint.run", arg_is("action", "copy")), fallback: ":hint" },
  cmdline: { mode: "normal", matches: is("cmdline.open", no_args), fallback: "the toolbar" },
  find: { mode: "normal", matches: is("find.open", no_args), fallback: ":find" },
  find_back: { mode: "normal", matches: is("find.open", arg_is("direction", "backward")), fallback: ":find" },
  next: { mode: "normal", matches: is("find.next"), fallback: ":find" },
  previous: { mode: "normal", matches: is("find.prev"), fallback: ":find" },
  caret: { mode: "normal", matches: is("mode.set", arg_is("mode", "caret")), fallback: ":mode caret" },
  visual: { mode: "normal", matches: is("mode.set", arg_is("mode", "visual")), fallback: ":mode visual" },
  caret_at_element: { mode: "normal", matches: is("hint.run", arg_is("action", "caret")), fallback: ":hint" },
  visual_at_element: { mode: "normal", matches: is("hint.run", arg_is("action", "visual")), fallback: ":hint" },
  caret_left: { mode: "caret", matches: is("caret.move", (args) => args.unit === "char" && args.direction === "back"), fallback: ":caret" },
  caret_right: { mode: "caret", matches: is("caret.move", (args) => args.unit === "char" && args.direction === undefined), fallback: ":caret" },
  caret_down: { mode: "caret", matches: is("caret.move", (args) => args.unit === "line" && args.direction === undefined), fallback: ":caret" },
  caret_up: { mode: "caret", matches: is("caret.move", (args) => args.unit === "line" && args.direction === "back"), fallback: ":caret" },
  caret_word: { mode: "caret", matches: is("caret.move", (args) => args.unit === "word" && args.direction === undefined && args.big === undefined), fallback: ":caret" },
  yank: { mode: "visual", matches: is("visual.act", arg_is("action", "yank")), fallback: ":visual" },
  swap: { mode: "visual", matches: is("visual.act", arg_is("action", "swap")), fallback: ":visual" },
  escape: { mode: "normal", matches: is("mode.escape"), fallback: "Escape" },
  help: { mode: "normal", matches: is("help.open"), fallback: ":help" },
} satisfies Record<string, Binding>;

type BindingName = keyof typeof BINDINGS;

// Text, with `{name}` marking where a key goes and `[text]` a literal command or setting name.
function sentence(compiled: CompiledKeymap | undefined, template: string): Inline[] {
  return template
    .split(/(\{[a-z_]+\}|\[[^\]]+\])/)
    .filter((part) => part !== "")
    .map((part): Inline => {
      if (part.startsWith("[")) return { kind: "code", text: part.slice(1, -1) };
      if (!part.startsWith("{")) return { kind: "text", text: part };
      const binding = BINDINGS[part.slice(1, -1) as BindingName];
      const [shortest] = key_paths(compiled, binding);
      return { kind: "code", text: shortest ? shortest.join("") : binding.fallback };
    });
}

// The first key of the help key, for the which-key example. Falls back to `g`, the first key of the usual one.
function prefix_key(compiled: CompiledKeymap | undefined): string {
  const [help_path] = key_paths(compiled, BINDINGS.help);
  return help_path && help_path.length > 1 ? help_path[0]! : "g";
}

export function quick_start_blocks(compiled: CompiledKeymap | undefined): Block[] {
  const say = (template: string): Block => ({ kind: "paragraph", inlines: sentence(compiled, template) });
  const heading = (text: string): Block => ({ kind: "heading", level: 2, text });
  return [
    say("OasisFox puts the browser on the keyboard. The keys on this page work as they do on any page, so try each one as you read. The key names come from your own keymap."),
    heading("Scroll"),
    say("Press {down} to scroll down and {up} to scroll up. {top} jumps to the top of the page and {bottom} to the bottom. {half_page} moves half a page."),
    heading("Click with hints"),
    say("Press {hint} to label every link and button on the page. Type the letters of a label to click it. Press {escape} to cancel."),
    say("Keys that start with [;] pick other actions. For example, {hint_copy} copies the address of a link."),
    heading("The command line"),
    say("Press {cmdline} to open the command line. Type a command name, such as [open], and press Enter. Tab completes the name and its words. {escape} closes the line."),
    say("The Commands page lists every command and what it takes."),
    heading("Which-key"),
    say(`Many keys start with a prefix. Press [${prefix_key(compiled)}] and wait. A panel lists the keys that can come next, with a name for each. The wait is the [which_key_delay_ms] setting.`),
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
