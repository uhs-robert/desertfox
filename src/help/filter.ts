// The Commands page filter, as plain functions so tests need no DOM.

import type { CommandRow } from "./model.ts";

// Case-insensitive substring over the command line name, id, label, description and the key sequences.
export function command_matches(command: CommandRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const haystacks = [command.name, command.id, command.label, command.intent, ...command.keys.map((key) => key.keys)];
  return haystacks.some((text) => text.toLowerCase().includes(needle));
}

export const count_line = (shown: number, total: number): string => `${shown} of ${total} commands`;
