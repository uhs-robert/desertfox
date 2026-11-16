// The Quick Start page text. Every key comes from the compiled keymap, so a rebind or an unbind changes the page.
// A key with no binding shows the command line that does the same thing, so no sentence loses its key.

import type { CommandMeta } from "../shared/command.ts";
import { BINDINGS, bound_key, key_paths } from "../shared/bound_keys.ts";
import type { Binding, BindingName } from "../shared/bound_keys.ts";
import { command_line_of, NO_KEY } from "../shared/key_docs.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import type { Block, Inline } from "./blocks.ts";

// Every command line the page can show in place of a key, for the test that each one resolves.
export function quick_start_fallbacks(commands: CommandMeta[]): { id: string; text: string }[] {
  return Object.values<Binding>(BINDINGS).flatMap((binding) => {
    const text = command_line_of(commands, binding);
    return text === undefined ? [] : [{ id: binding.id, text }];
  });
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
