// Fills the `{key:name}` marks in the Settings prose with the key the keymap binds to that action, so a rebind never leaves a doc naming the old key.

import type { CommandMeta } from "./command.ts";
import { BINDINGS, bound_key } from "./bound_keys.ts";
import type { Binding, BindingName } from "./bound_keys.ts";
import type { CompiledKeymap } from "./prefix_tree.ts";
import { print_command } from "./registry/print_command.ts";

export const NO_KEY = "(no key bound)";
const KEY_MARK = /\{key:([a-z_]+)(?:\|([^}]*))?\}/g;

// The command line that does the same as the binding, or undefined when the command has no name to type.
export function command_line_of(commands: CommandMeta[], binding: Binding): string | undefined {
  const printed = [binding, ...(binding.then ? [binding.then] : [])].map((step) => {
    const command = commands.find((candidate) => candidate.id === step.id);
    return command?.name === undefined ? undefined : print_command(command, step.args, { flags: "long" });
  });
  // A two-step key keeps both steps, joined as the keys page joins them, so the line does the whole key.
  return printed.includes(undefined) ? undefined : `:${printed.join(" ; ")}`;
}

const SCHEMA_NOTE = " The keys named here are the default keys.";

// A mark is `{key:name}` or `{key:name|phrase}`. An unbound action reads as its phrase, so the sentence still names the action. With no phrase it shows its command line. `by_default` adds a closing note for a reader without the live keymap.
export function resolve_key_docs(text: string, compiled: CompiledKeymap | undefined, commands: CommandMeta[], by_default = false): string {
  let had_mark = false;
  const resolved = text.replace(KEY_MARK, (_mark, name: string, phrase: string | undefined) => {
    if (!(name in BINDINGS)) throw new Error(`settings prose names the unknown key action ${name}`);
    had_mark = true;
    const key = bound_key(compiled, commands, name as BindingName);
    if (key !== undefined) return `\`${key}\``;
    if (phrase !== undefined) return phrase;
    const line = command_line_of(commands, BINDINGS[name as BindingName]);
    return line === undefined ? NO_KEY : `\`${line}\``;
  });
  return by_default && had_mark ? resolved + SCHEMA_NOTE : resolved;
}

// Every mark in the prose, for the test that none survives resolution.
export const has_key_mark = (text: string): boolean => /\{key:/.test(text);
