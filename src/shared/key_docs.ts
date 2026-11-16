// Fills the `{key:name}` marks in the Settings prose with the key the keymap binds to that action, so a rebind never leaves a doc naming the old key.

import type { CommandMeta } from "./command.ts";
import { BINDINGS, bound_key } from "./bound_keys.ts";
import type { Binding, BindingName } from "./bound_keys.ts";
import type { CompiledKeymap } from "./prefix_tree.ts";
import { print_command } from "./registry/print_command.ts";

const NO_KEY = "(no key bound)";
const KEY_MARK = /\{key:([a-z_]+)\}/g;

// The command line that does the same as the binding, or undefined when the command has no name to type.
export function command_line_of(commands: CommandMeta[], binding: Binding): string | undefined {
  const command = commands.find((candidate) => candidate.id === binding.id);
  return command?.name === undefined ? undefined : `:${print_command(command, binding.args, { flags: "long" })}`;
}

// An unbound action shows its command line, so the sentence still names a way in. `by_default` marks the first key of the text as the shipped one, for a reader without the live keymap.
export function resolve_key_docs(text: string, compiled: CompiledKeymap | undefined, commands: CommandMeta[], by_default = false): string {
  let marked = false;
  return text.replace(KEY_MARK, (_mark, name: string) => {
    if (!(name in BINDINGS)) throw new Error(`settings prose names the unknown key action ${name}`);
    const key = bound_key(compiled, commands, name as BindingName);
    const shown = key ?? command_line_of(commands, BINDINGS[name as BindingName]);
    if (shown === undefined) return NO_KEY;
    const note = by_default && key !== undefined && !marked ? " by default" : "";
    marked = true;
    return `\`${shown}\`${note}`;
  });
}

// Every mark in the prose, for the test that none survives resolution.
export const has_key_mark = (text: string): boolean => /\{key:/.test(text);
