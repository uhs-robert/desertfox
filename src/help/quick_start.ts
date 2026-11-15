// The Quick Start page text. Every key comes from the compiled keymap, so a rebind or an unbind changes the page.
// A key with no binding shows the command line that does the same thing, so no sentence loses its key.

import type { KeymapMode } from "../shared/keymap.ts";
import type { CommandMeta } from "../shared/command.ts";
import { default_of } from "../shared/registry/params.ts";
import { print_command } from "../shared/registry/print_command.ts";
import { LIVE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, TreeNode } from "../shared/prefix_tree.ts";
import type { Block, Inline } from "./blocks.ts";

type Args = Record<string, unknown>;

// `args` is the canonical form the command line fallback prints. A key fits when its args, with the registry defaults filled in, equal the defaulted `args`.
// `test` replaces that equality where a step accepts more than one form. It gets both defaulted sides.
type Binding = { mode: KeymapMode; id: string; args: Args; test?: (args: Args, expected: Args) => boolean; prefer?: string };

// A user binding that spells out a default (`direction = "forward"`) and one that leaves it out mean the same, so both sides read the defaults.
function with_defaults(commands: CommandMeta[], id: string, args: Args | undefined): Args {
  const command = commands.find((candidate) => candidate.id === id);
  const filled: Args = { ...args };
  for (const param of command?.params ?? []) {
    const resolved = default_of(command!, param, filled);
    if (filled[param.name] === undefined && resolved !== undefined && typeof resolved !== "object") filled[param.name] = resolved;
  }
  return filled;
}

// A key that runs several steps does more than the sentence says, so only a single step can fit.
function fits(commands: CommandMeta[], binding: Binding, steps: { invocation: { id: string; args?: Args } }[]): boolean {
  const [step] = steps;
  if (steps.length !== 1 || step!.invocation.id !== binding.id) return false;
  const args = with_defaults(commands, binding.id, step!.invocation.args);
  const expected = with_defaults(commands, binding.id, binding.args);
  return binding.test ? binding.test(args, expected) : same_args(args, expected);
}

function same_args(args: Args, expected: Args, ignored?: string): boolean {
  const names = new Set([...Object.keys(args), ...Object.keys(expected)]);
  names.delete(ignored ?? "");
  return [...names].every((name) => args[name] === expected[name]);
}

// The token paths of every key that runs a matching invocation, shortest first. A `prefer` key wins when it is bound.
function key_paths(compiled: CompiledKeymap | undefined, commands: CommandMeta[], binding: Binding): string[][] {
  const found: string[][] = [];
  const walk = (node: TreeNode, path: string[]): void => {
    if (node.kind === "branch") {
      for (const [token, child] of Object.entries(node.children)) if (token !== LIVE_KEY) walk(child, [...path, token]);
    } else if (fits(commands, binding, node.steps)) {
      found.push(path);
    }
  };
  const root = compiled?.modes[binding.mode];
  if (root) walk(root, []);
  const preferred = found.filter((path) => path.join("") === binding.prefer);
  return preferred.length > 0 ? preferred : found.sort((a, b) => a.join("").length - b.join("").length);
}

// Any count of the right sign scrolls the way the sentence says.
const scrolls = (positive: boolean): NonNullable<Binding["test"]> => (args, expected) => typeof args.count === "number" && (positive ? args.count > 0 : args.count < 0) && same_args(args, expected, "count");
const move = (unit: string, back: boolean): Pick<Binding, "id" | "args"> => ({ id: "caret.move", args: { unit, ...(back ? { direction: "back" } : {}) } });

const BINDINGS = {
  down: { mode: "normal", id: "scroll.lines", args: { count: 10 }, test: scrolls(true) },
  up: { mode: "normal", id: "scroll.lines", args: { count: -10 }, test: scrolls(false) },
  top: { mode: "normal", id: "scroll.to", args: { percent: 0 } },
  bottom: { mode: "normal", id: "scroll.to", args: { percent: 100 } },
  half_page: { mode: "normal", id: "scroll.pages", args: { fraction: 0.5 } },
  hint: { mode: "normal", id: "hint.run", args: { action: "here" } },
  hint_copy: { mode: "normal", id: "hint.run", args: { action: "copy", filter: "links" } },
  cmdline: { mode: "normal", id: "cmdline.open", args: {} },
  find: { mode: "normal", id: "find.open", args: {} },
  find_back: { mode: "normal", id: "find.open", args: { direction: "backward" } },
  next: { mode: "normal", id: "find.next", args: {}, test: () => true },
  previous: { mode: "normal", id: "find.prev", args: {}, test: () => true },
  caret: { mode: "normal", id: "mode.set", args: { mode: "caret" } },
  caret_at_text: { mode: "normal", id: "hint.run", args: { action: "caret", filter: "prose" } },
  visual_at_text: { mode: "normal", id: "hint.run", args: { action: "visual", filter: "prose" } },
  // Looked up in caret mode, because the sentence follows entering caret mode and `v` there starts visual mode.
  visual: { mode: "caret", id: "mode.set", args: { mode: "visual" } },
  visual_line: { mode: "caret", id: "mode.set", args: { mode: "visual_line" } },
  caret_left: { mode: "caret", ...move("char", true) },
  caret_right: { mode: "caret", ...move("char", false) },
  caret_down: { mode: "caret", ...move("line", false) },
  caret_up: { mode: "caret", ...move("line", true) },
  caret_word: { mode: "caret", ...move("word", false) },
  yank: { mode: "visual", id: "visual.act", args: { action: "yank" } },
  swap: { mode: "visual", id: "visual.act", args: { action: "swap" } },
  // `<C-[>` also escapes, but `<Escape>` is the key a reader knows.
  escape: { mode: "normal", id: "mode.escape", args: {}, test: () => true, prefer: "<Escape>" },
  insert: { mode: "normal", id: "mode.insert", args: {} },
  help: { mode: "normal", id: "help.open", args: {} },
  settings_page: { mode: "normal", id: "help.open", args: { name: "settings" } },
  // Host features: the keys follow the keymap like the rest, so a rebind never leaves this section wrong.
  edit_external: { mode: "insert", id: "text.edit_external", args: {} },
  reload: { mode: "normal", id: "config.reload", args: {} },
  find_anything: { mode: "normal", id: "open.anything", args: {} },
  // The Practice lessons. Each names the fastest key for its task.
  left: { mode: "normal", id: "scroll.pixels", args: { dx: -50 } },
  right: { mode: "normal", id: "scroll.pixels", args: { dx: 50 } },
  half_page_up: { mode: "normal", id: "scroll.pages", args: { fraction: -0.5 } },
  // `,?` is shorter in keymap notation, but the chord works in every mode.
  whichkey: { mode: "normal", id: "help.whichkey", args: {}, prefer: "<A-?>" },
  zoom_in: { mode: "normal", id: "zoom.by", args: { delta: 0.1 }, prefer: "zi" },
  next_heading: { mode: "normal", id: "page.heading", args: { direction: "next" } },
  previous_heading: { mode: "normal", id: "page.heading", args: { direction: "prev" } },
  headings: { mode: "normal", id: "cmdline.open", args: { text: "heading " } },
  hint_text: { mode: "hint", id: "hint.key", args: { key: "slash" } },
  hint_background: { mode: "normal", id: "hint.run", args: { action: "background" } },
  hint_inputs: { mode: "normal", id: "hint.run", args: { filter: "inputs" } },
  hint_inputs_rapid: { mode: "normal", id: "hint.run", args: { filter: "inputs", rapid: true } },
  hint_buttons: { mode: "normal", id: "hint.run", args: { filter: "buttons" } },
  hint_copy_text: { mode: "normal", id: "hint.run", args: { action: "copy_text", filter: "all" } },
  grab_move: { mode: "normal", id: "hint.run", args: { action: "grab_move", filter: "draggable" } },
  grab_drop_on: { mode: "normal", id: "hint.run", args: { action: "grab", filter: "draggable" } },
  grab_left: { mode: "grab", id: "grab.move", args: { direction: "left" } },
  grab_right: { mode: "grab", id: "grab.move", args: { direction: "right" } },
  grab_drop: { mode: "grab", id: "grab.drop", args: {} },
  grab_keys: { mode: "grab", id: "help.whichkey", args: {}, prefer: "?" },
  focus_input: { mode: "normal", id: "page.focus_input", args: {}, prefer: "gi" },
  next_field: { mode: "normal", id: "page.focus_field", args: { direction: "next" } },
  previous_field: { mode: "normal", id: "page.focus_field", args: { direction: "prev" } },
  sentence_object: { mode: "visual", id: "visual.object", args: { object: "sentence" } },
  back: { mode: "normal", id: "page.back", args: {} },
  tab_switch: { mode: "normal", id: "tab.switch", args: {}, prefer: "T" },
  tab_close: { mode: "normal", id: "tab.close", args: {}, prefer: "dd" },
  tab_alternate: { mode: "normal", id: "tab.alternate", args: {}, prefer: "gl" },
  tab_next: { mode: "normal", id: "tab.next", args: {}, prefer: "J" },
  tab_previous: { mode: "normal", id: "tab.prev", args: {}, prefer: "K" },
  list_close: { mode: "cmdline", id: "list.act", args: { action: "close" } },
  media_enter: { mode: "normal", id: "media.act", args: { action: "enter" } },
  media_play: { mode: "media", id: "media.act", args: { action: "play_pause" }, prefer: "<Space>" },
  media_forward: { mode: "media", id: "media.act", args: { action: "seek", value: "up" } },
  media_backward: { mode: "media", id: "media.act", args: { action: "seek", value: "down" } },
  media_louder: { mode: "media", id: "media.act", args: { action: "volume", value: "up" } },
  media_quieter: { mode: "media", id: "media.act", args: { action: "volume", value: "down" } },
  media_faster: { mode: "media", id: "media.act", args: { action: "speed", value: "up" } },
  media_speed_reset: { mode: "media", id: "media.act", args: { action: "speed", value: "reset" } },
  media_mute: { mode: "media", id: "media.act", args: { action: "mute" } },
  media_fullscreen: { mode: "media", id: "media.act", args: { action: "fullscreen" } },
  media_keys: { mode: "media", id: "help.whichkey", args: {}, prefer: "?" },
  mark: { mode: "normal", id: "mark.add", args: {} },
  mark_jump: { mode: "normal", id: "mark.jump", args: {}, prefer: "'" },
  jump_back: { mode: "normal", id: "page.jump", args: { direction: "older" } },
  ignore: { mode: "normal", id: "mode.set", args: { mode: "ignore" }, prefer: "<S-Escape>" },
  pass_next: { mode: "normal", id: "mode.pass_next", args: {} },
  firefox_settings: { mode: "normal", id: "browser.open_firefox_page", args: { page: "settings" } },
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

// The shortest key for a binding as the reader typed it, or undefined when none is bound.
export function bound_key(compiled: CompiledKeymap | undefined, commands: CommandMeta[], name: BindingName): string | undefined {
  return key_paths(compiled, commands, BINDINGS[name])[0]?.join("");
}

// The key text a settings page sentence names, from the same keymap as the Quick Start text.
export function key_text(compiled: CompiledKeymap | undefined, commands: CommandMeta[], name: "reload" | "find_anything"): string {
  return bound_key(compiled, commands, name) ?? "(no key is set for this yet)";
}

// Whether a typed prefix opens the which-key panel after a wait. It follows the gate in `content/whichkey`: a delay of 0 is off, and a prefix that exactly matches a skip entry starts no delayed open. Site rules are not read, as help pages run outside any site.
function opens_panel(compiled: CompiledKeymap | undefined, prefix: string): boolean {
  return (compiled?.which_key_delay_ms ?? 0) > 0 && !(compiled?.which_key_skip ?? []).includes(prefix);
}

// `{name:first}` is the first key of the binding, `{name:wait}` the same but only when a pause on it opens the panel, and `{prefix}` is `prefix_key`.
const TEMPLATE_NAME = /(\{[a-z_]+(?::first|:wait)?\}|\[[^\]]+\])/;

// The first key a `{...}` part names for the which-key panel, or undefined when a pause on it opens no panel.
function wait_key(compiled: CompiledKeymap | undefined, commands: CommandMeta[], part: string): string | undefined {
  const [name, modifier] = part.slice(1, -1).split(":");
  if (name === "prefix") return prefix_key(compiled, commands);
  if (modifier !== "wait") return undefined;
  const path = key_paths(compiled, commands, BINDINGS[name as BindingName])[0];
  // A one-key binding runs at once, so no prefix is pending and no panel opens.
  return path !== undefined && path.length > 1 && opens_panel(compiled, path[0]!) ? path[0] : undefined;
}

const is_wait_part = (part: string): boolean => part === "{prefix}" || part.endsWith(":wait}");

// Whether every "and wait" key in the template opens the panel, so a note that promises it can be dropped when it does not.
export function wait_holds(compiled: CompiledKeymap | undefined, commands: CommandMeta[], template: string): boolean {
  return template.split(TEMPLATE_NAME).filter(is_wait_part).every((part) => wait_key(compiled, commands, part) !== undefined);
}

// Text, with `{name}` marking where a key goes and `[text]` a literal command or setting name.
export function sentence(compiled: CompiledKeymap | undefined, commands: CommandMeta[], template: string): Inline[] {
  return template
    .split(TEMPLATE_NAME)
    .filter((part) => part !== "")
    .map((part): Inline => {
      if (part.startsWith("[")) return { kind: "code", text: part.slice(1, -1) };
      if (!part.startsWith("{")) return { kind: "text", text: part };
      if (is_wait_part(part)) {
        const key = wait_key(compiled, commands, part);
        return key === undefined ? { kind: "text", text: NO_KEY } : { kind: "keys", text: key };
      }
      const [name, only_first] = part.slice(1, -1).split(":");
      const binding: Binding = BINDINGS[name as BindingName];
      const [shortest] = key_paths(compiled, commands, binding);
      if (shortest) return { kind: "keys", text: only_first ? shortest[0]! : shortest.join("") };
      const command_line = command_line_of(commands, binding);
      return command_line === undefined ? { kind: "text", text: NO_KEY } : { kind: "code", text: command_line };
    });
}

// A key that opens a longer sequence, for the which-key example: the help key's own prefix, else the first group in the keymap, in either case only one whose pause opens the panel.
function prefix_key(compiled: CompiledKeymap | undefined, commands: CommandMeta[]): string | undefined {
  const [help_path] = key_paths(compiled, commands, BINDINGS.help);
  if (help_path && help_path.length > 1 && opens_panel(compiled, help_path[0]!)) return help_path[0];
  const root = compiled?.modes.normal;
  if (root?.kind !== "branch") return undefined;
  return Object.entries(root.children).find(([key, child]) => child.kind === "branch" && opens_panel(compiled, key))?.[0];
}

// The callout at the top of Home and Commands. The command line key follows the keymap like the Quick Start text.
export function tip_block(compiled: CompiledKeymap | undefined, commands: CommandMeta[] = []): Block {
  return { kind: "tip", inlines: sentence(compiled, commands, "Press {cmdline} to open the command line, a box at the bottom of the page where you type commands. Type [help] and a page name, such as [help settings], to open that page.") };
}

export function quick_start_blocks(compiled: CompiledKeymap | undefined, commands: CommandMeta[] = []): Block[] {
  const say = (template: string): Block => ({ kind: "paragraph", inlines: sentence(compiled, commands, template) });
  const bullets = (templates: string[]): Block => ({ kind: "list", items: templates.map((template) => sentence(compiled, commands, template)) });
  const prefix = prefix_key(compiled, commands);
  const heading = (text: string): Block => ({ kind: "heading", level: 2, text });
  return [
    // The first line a new install shows: the way to the lessons, by the key they start with.
    { kind: "paragraph", inlines: [...sentence(compiled, commands, "New here? Press {hint}. Letters appear on every link. Type the letters on the "), { kind: "link", text: "Practice page", href: "#/practice" }, { kind: "text", text: " to learn the keys in short lessons." }] },
    say("DesertFox puts the browser on the keyboard. The keys on this page work as they do on any page, so try each one as you read. The keys shown are the ones set up for you."),
    heading("Scroll"),
    say("Press {down} to scroll down and {up} to scroll up. {top} jumps to the top of the page and {bottom} to the bottom. {half_page} moves half a page."),
    heading("Click with hints"),
    say("Press {hint} to label every link and button on the page. Type the letters of a label to click it. Press {escape} to cancel."),
    say("Other hint keys pick other actions. For example, {hint_copy} copies the address of a link."),
    heading("The command line"),
    say("Press {cmdline} to open the command line. Type a command name, such as [open], and press Enter. Tab completes the name and its words. {escape} closes the line."),
    say("The Commands page lists every command and what it takes. Press {find_anything} to open Find anything, a box that searches your open tabs, bookmarks and history."),
    heading("Which-key"),
    say(
      prefix === undefined
        ? "The which-key panel lists the keys that can come next after a key that starts a longer sequence. No key opens it by itself after a wait now. {whichkey} opens it on request. You can change the wait and the skipped keys on the Settings page."
        : "Many keys start with a prefix. Press {prefix} and wait. The which-key panel lists the keys that can come next, with a name for each. You can change the wait and the skipped keys on the Settings page.",
    ),
    heading("Modes"),
    say("DesertFox has modes. In normal mode, keys run commands. In insert mode, keys go to the page, so you can type in a text field. A small badge on the page shows the mode. {escape} returns to normal mode."),
    heading("Search the page"),
    say("Press {find} to search forward and {find_back} to search backward. Type the text and press Enter. {next} jumps to the next match and {previous} to the one before."),
    heading("Caret mode and visual mode"),
    say("Caret mode puts a cursor in the page text, so you can move over text with the keyboard and select it. It starts after a search at the match, and otherwise at the first visible text."),
    say("Press {caret} to start caret mode. Move with {caret_left}, {caret_down}, {caret_up} and {caret_right}, or by word with {caret_word}. Press {visual} to start visual mode, which selects the text you move over. Press {visual_line} instead to select whole lines. In visual mode, {yank} copies the selection and {swap} moves the cursor to the other end of it. {escape} steps back to the mode before."),
    say("To start at a piece of text, press {caret_at_text} for caret mode or {visual_at_text} for visual mode, then type the label of the text."),
    heading("Help"),
    say("Press {help} on any page to open this help. The Commands page lists every key. Press {settings_page} to open Settings, where you change colors, keys and search engines."),
    heading("Advanced: the native host"),
    say("DesertFox works fully without it. The native host is a small helper program that DesertFox installs on Linux. It adds three things."),
    bullets([
      "Press {edit_external} in a text field to edit the text in your own editor.",
      "{firefox_settings} opens the Firefox settings page, and the keys beside it open other Firefox pages.",
      "You can keep your settings in files in [~/.config/desertfox/] and load them with [config.reload].",
    ]),
    say("To install it, run [:native.install]."),
  ];
}
