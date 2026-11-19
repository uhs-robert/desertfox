// Which key runs a command, read from the compiled keymap. The Quick Start page, the Settings docs and the new tab hint all name keys through it, so a rebind or an unbind reaches each of them.

import type { KeymapMode } from "./keymap.ts";
import type { CommandMeta } from "./command.ts";
import { default_of } from "./registry/params.ts";
import { LIVE_KEY } from "./prefix_tree.ts";
import type { CompiledKeymap, TreeNode } from "./prefix_tree.ts";

export type Args = Record<string, unknown>;

// `args` is the canonical form the command line fallback prints. A key fits when its args, with the registry defaults filled in, equal the defaulted `args`.
// `test` replaces that equality where a step accepts more than one form. It gets both defaulted sides.
export type Binding = { mode: KeymapMode; id: string; args: Args; test?: (args: Args, expected: Args) => boolean; prefer?: string };

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
export function key_paths(compiled: CompiledKeymap | undefined, commands: CommandMeta[], binding: Binding): string[][] {
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
const caret_move = (unit: string, back: boolean): Binding => ({ mode: "caret", id: "caret.move", args: { unit, ...(back ? { direction: "back" } : {}) } });

// Its own constant, so the new tab page can look up this one key without carrying the table.
export const CMDLINE_BINDING: Binding = { mode: "normal", id: "cmdline.open", args: {} };

export const BINDINGS = {
  down: { mode: "normal", id: "scroll.lines", args: { count: 10 }, test: /* @__PURE__ */ scrolls(true) },
  up: { mode: "normal", id: "scroll.lines", args: { count: -10 }, test: /* @__PURE__ */ scrolls(false) },
  top: { mode: "normal", id: "scroll.to", args: { percent: 0 } },
  bottom: { mode: "normal", id: "scroll.to", args: { percent: 100 } },
  half_page: { mode: "normal", id: "scroll.pages", args: { fraction: 0.5 } },
  hint: { mode: "normal", id: "hint.run", args: { action: "here" } },
  hint_copy: { mode: "normal", id: "hint.run", args: { action: "copy", filter: "links" } },
  cmdline: CMDLINE_BINDING,
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
  caret_left: /* @__PURE__ */ caret_move("char", true),
  caret_right: /* @__PURE__ */ caret_move("char", false),
  caret_down: /* @__PURE__ */ caret_move("line", false),
  caret_up: /* @__PURE__ */ caret_move("line", true),
  caret_word: /* @__PURE__ */ caret_move("word", false),
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
  jump_back: { mode: "normal", id: "page.jump", args: { direction: "older" }, prefer: "<C-o>" },
  ignore: { mode: "normal", id: "mode.set", args: { mode: "ignore" }, prefer: "<S-Escape>" },
  pass_next: { mode: "normal", id: "mode.pass_next", args: {} },
  // Named for the Settings docs.
  repeat: { mode: "normal", id: "command.repeat", args: {} },
  grab_finer: { mode: "grab", id: "grab.step", args: { scale: "finer" } },
  grab_coarser: { mode: "grab", id: "grab.step", args: { scale: "coarser" } },
  next_page: { mode: "normal", id: "page.follow", args: { direction: "next" } },
  previous_page: { mode: "normal", id: "page.follow", args: { direction: "prev" } },
  hint_space: { mode: "hint", id: "hint.key", args: { key: "space" } },
  hint_every: { mode: "normal", id: "hint.run", args: { filter: "every" } },
  home: { mode: "normal", id: "page.home", args: {} },
  home_in_tab: { mode: "normal", id: "page.home", args: { where: "tab" } },
  paste_open: { mode: "normal", id: "open.clipboard", args: { where: "here" } },
  open_url: { mode: "normal", id: "open.url", args: { where: "here" } },
  firefox_settings: { mode: "normal", id: "browser.open_firefox_page", args: { page: "settings" } },
} satisfies Record<string, Binding>;

export type BindingName = keyof typeof BINDINGS;

// The shortest key for a binding as the reader typed it, or undefined when none is bound.
export function bound_key(compiled: CompiledKeymap | undefined, commands: CommandMeta[], name: BindingName): string | undefined {
  return key_paths(compiled, commands, BINDINGS[name])[0]?.join("");
}
